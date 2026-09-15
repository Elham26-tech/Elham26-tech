'use strict';

const store = require('./store');
const recipeLib = require('./recipe');
const { Browser } = require('./browser');

const MAX_LOG = 400;

class Engine {
  constructor() {
    this.settings = store.loadSettings();
    this.session = store.loadSession();
    this.learned = store.loadLearned();
    this.browser = new Browser();
    this.pendingRequests = new Map();
    this.armTimer = null;
    this.fireTimer = null;
    this.stopTimer = null;
    this.inFlight = 0;
    this.listeners = new Set();

    this.browser.on('event', (msg) => this.onBrowserEvent(msg));
    this.browser.on('disconnected', () => this.log('ارتباط با مرورگر قطع شد.', 'warn'));
  }

  // ---- گزارش ----------------------------------------------------------
  onLog(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  log(message, level = 'info') {
    const entry = { at: new Date().toISOString(), level, message };
    this.session.log.push(entry);
    if (this.session.log.length > MAX_LOG) this.session.log = this.session.log.slice(-MAX_LOG);
    for (const fn of this.listeners) {
      try { fn(entry); } catch { /* یک شنونده نباید موتور را بخواباند */ }
    }
    return entry;
  }

  persist() {
    store.saveSession(this.session);
  }

  // ---- ساعت (باگ ۳) ---------------------------------------------------
  now() {
    return new Date(Date.now() + (Number(this.settings.clockOffsetMs) || 0));
  }

  targetTimestamp(now = this.now()) {
    const [h = 0, m = 0, s = 0] = String(this.settings.targetTime || '00:00:00')
      .split(':').map((n) => Number(n) || 0);
    const target = new Date(now);
    target.setHours(h, m, s, 0);
    return target.getTime();
  }

  /**
   * کارگزاری‌ها گاهی تا یک دقیقه زودتر باز می‌کنند، پس شلیک از
   * preArmSeconds ثانیه قبلِ ساعت هدف شروع می‌شود.
   */
  fireStartTimestamp(now = this.now()) {
    const pre = Math.max(0, Number(this.settings.preArmSeconds) || 0);
    return this.targetTimestamp(now) - pre * 1000;
  }

  async syncClock() {
    try {
      const sessionId = this.browser.anySession();
      if (!sessionId) throw new Error('اول ایزی‌تریدر را باز کنید.');
      const sentAt = Date.now();
      const result = await this.browser.send('Runtime.evaluate', {
        expression: `(async () => {
          const res = await fetch(location.origin, { method: 'HEAD', cache: 'no-store' });
          return res.headers.get('date') || '';
        })()`,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      const receivedAt = Date.now();
      const header = result.result && result.result.value;
      if (!header) throw new Error('سرور کارگزاری هدر Date نفرستاد.');
      const roundTrip = receivedAt - sentAt;
      const offsetMs = Math.round(new Date(header).getTime() + roundTrip / 2 - receivedAt);
      this.settings = store.saveSettings({ clockOffsetMs: offsetMs });
      this.log(`ساعت با سرور کارگزاری همگام شد: اختلاف ${offsetMs} ms.`, 'ok');
      this.persist();
      return { ok: true, offsetMs };
    } catch (err) {
      this.log(`همگام‌سازی ساعت ناموفق: ${err.message}`, 'error');
      this.persist();
      return { ok: false, error: err.message };
    }
  }

  // ---- مرورگر و یادگیری (باگ ۲) --------------------------------------
  async openEasyTrader() {
    try {
      const info = await this.browser.open(this.settings.easyTraderUrl, store.PROFILE_DIR);
      this.session.learning = true;
      this.log(
        info.reused
          ? 'پنجرهٔ کارگزاری از قبل باز بود؛ حالت یادگیری روشن است.'
          : 'ایزی‌تریدر باز شد. داخل همان پنجره وارد حساب شوید، نماد را جست‌وجو کنید و یک بار دستی سفارش بزنید.',
        'ok',
      );
      this.persist();
      return { ok: true };
    } catch (err) {
      this.log(`باز کردن مرورگر ناموفق: ${err.message}`, 'error');
      this.persist();
      return { ok: false, error: err.message };
    }
  }

  onBrowserEvent(msg) {
    if (msg.method === 'Network.requestWillBeSent') {
      const { requestId, request } = msg.params;
      if (request && (request.method === 'POST' || request.method === 'PUT')) {
        this.pendingRequests.set(requestId, request);
        if (this.pendingRequests.size > 60) {
          this.pendingRequests.delete(this.pendingRequests.keys().next().value);
        }
      }
      return;
    }

    if (msg.method === 'Network.responseReceived') {
      const { requestId, response } = msg.params;
      const request = this.pendingRequests.get(requestId);
      this.pendingRequests.delete(requestId);
      if (!request || !this.session.learning) return;
      if (response.status < 200 || response.status >= 300) return;
      if (!recipeLib.looksLikeOrder(request)) return;

      const recipe = recipeLib.fromRequest(request, response);
      this.learned = store.saveRecipe(recipe);
      this.session.learning = false;
      this.log(`سفارش یاد گرفته شد — ${recipe.label}`, 'ok');
      this.log('حالا فقط ساعت هدف را تنظیم و «مسلح کردن» را بزنید.', 'info');
      this.persist();
    }
  }

  setLearning(on) {
    this.session.learning = Boolean(on);
    this.log(on ? 'حالت یادگیری روشن شد؛ یک سفارش دستی ثبت کنید.' : 'حالت یادگیری خاموش شد.', 'info');
    this.persist();
    return this.status();
  }

  overrides() {
    return {
      symbol: this.settings.symbol || undefined,
      quantity: this.settings.quantity ?? undefined,
      price: this.settings.price ?? undefined,
    };
  }

  // ---- بررسی ----------------------------------------------------------
  validate() {
    const check = recipeLib.validate(this.learned.recipe, this.overrides());
    if (!check.ok) {
      for (const problem of check.problems) this.log(`بررسی: ${problem}`, 'error');
      this.persist();
      return { ...check };
    }
    const prepared = recipeLib.build(this.learned.recipe, this.overrides());
    this.log(`بررسی: آماده است — ${prepared.method} ${prepared.url}`, 'ok');
    this.log(`بدنهٔ ارسالی: ${String(prepared.body).slice(0, 300)}`, 'info');
    this.persist();
    return { ok: true, problems: [], prepared: { method: prepared.method, url: prepared.url, body: prepared.body } };
  }

  // ---- شلیک -----------------------------------------------------------
  async attempt() {
    if (this.session.finished) return;
    const prepared = recipeLib.build(this.learned.recipe, this.overrides());
    this.session.attempts += 1;
    const attemptNo = this.session.attempts;

    const result = await this.browser.replayRequest(prepared);

    if (result.ok) {
      this.session.accepted += 1;
      this.session.successText = String(result.text).slice(0, 300);
      this.session.finished = true;
      this.log(`سفارش پذیرفته شد (تلاش ${attemptNo}، ${result.ms} ms).`, 'ok');
      this.stopFiring('سفارش پذیرفته شد');
      return;
    }

    this.session.rejected += 1;
    this.session.lastError = `${result.status} — ${String(result.text).slice(0, 200)}`;
    this.log(`تلاش ${attemptNo}: رد — HTTP ${result.status} | ${String(result.text).slice(0, 160)}`, 'error');
  }

  arm() {
    this.disarm(false);
    const check = recipeLib.validate(this.learned.recipe, this.overrides());
    if (!check.ok) {
      for (const problem of check.problems) this.log(`مسلح نشد: ${problem}`, 'error');
      this.persist();
      return this.status();
    }
    if (!this.browser.connected) {
      this.log('مسلح نشد: پنجرهٔ ایزی‌تریدر باز نیست.', 'error');
      this.persist();
      return this.status();
    }

    const log = this.session.log;
    this.session = { ...store.freshSession(), log };
    this.session.armed = true;
    this.session.armedAt = new Date().toISOString();

    const now = this.now();
    const delay = this.fireStartTimestamp(now) - now.getTime();
    const pre = Math.max(0, Number(this.settings.preArmSeconds) || 0);

    if (delay <= 0) {
      this.log('ساعت هدف گذشته است؛ شلیک بلافاصله شروع می‌شود.', 'warn');
      this.startFiring();
    } else {
      this.log(
        `مسلح شد: شلیک ${pre} ثانیه زودتر از ${this.settings.targetTime} آغاز می‌شود (${Math.round(delay / 1000)} ثانیه دیگر).`,
        'ok',
      );
      this.armTimer = setTimeout(() => this.startFiring(), delay);
    }
    this.persist();
    return this.status();
  }

  startFiring() {
    if (this.session.firing || this.session.finished) return;
    this.session.firing = true;
    const rate = Math.max(1, Number(this.settings.sendRate) || 1);
    const parallel = Math.max(1, Number(this.settings.parallel) || 1);
    this.log(`شروع شلیک: نرخ ${rate} در ثانیه، ${parallel} درخواست هم‌زمان.`, 'ok');

    this.fireTimer = setInterval(() => {
      if (this.session.finished) return this.stopFiring('پایان');
      if (this.session.attempts >= (Number(this.settings.maxAttempts) || Infinity)) {
        return this.stopFiring('سقف تعداد تلاش');
      }
      if (this.inFlight >= parallel) return undefined;
      this.inFlight += 1;
      return this.attempt()
        .catch((err) => this.log(`خطای غیرمنتظره: ${err.message}`, 'error'))
        .finally(() => { this.inFlight -= 1; this.persist(); });
    }, Math.max(20, Math.round(1000 / rate)));

    const cap = Number(this.settings.stopAfterSeconds) || 0;
    if (cap > 0) this.stopTimer = setTimeout(() => this.stopFiring('سقف مدت'), cap * 1000);
    this.persist();
  }

  stopFiring(reason) {
    clearInterval(this.fireTimer);
    clearTimeout(this.stopTimer);
    this.fireTimer = null;
    this.stopTimer = null;
    if (this.session.firing) {
      this.session.firing = false;
      this.session.armed = false;
      this.log(`پایان شلیک: ${this.session.attempts} تلاش، ${this.session.accepted} پذیرفته (${reason}).`, 'info');
    }
    this.persist();
  }

  disarm(shouldLog = true) {
    clearTimeout(this.armTimer);
    this.armTimer = null;
    this.stopFiring('لغو توسط کاربر');
    this.session.armed = false;
    if (shouldLog) this.log('خلع سلاح شد.', 'info');
    this.persist();
    return this.status();
  }

  async fireNow() {
    const check = recipeLib.validate(this.learned.recipe, this.overrides());
    if (!check.ok) {
      for (const problem of check.problems) this.log(`ارسال نشد: ${problem}`, 'error');
      this.persist();
      return this.status();
    }
    this.session.finished = false;
    this.log('ارسال فوری یک سفارش.', 'info');
    try {
      await this.attempt();
    } catch (err) {
      this.log(`ارسال ناموفق: ${err.message}`, 'error');
    }
    this.persist();
    return this.status();
  }

  // ---- وضعیت ----------------------------------------------------------
  updateSettings(patch) {
    this.settings = store.saveSettings(patch);
    return this.settings;
  }

  resetMemory({ session = true, learned = false } = {}) {
    this.disarm(false);
    if (session) this.session = store.resetSession();
    if (learned) this.learned = store.resetLearned();
    this.log(
      `حافظه پاک شد (${[session && 'جلسه', learned && 'سفارش یادگرفته‌شده'].filter(Boolean).join(' و ')}).`,
      'ok',
    );
    this.persist();
    return this.status();
  }

  status() {
    const now = this.now();
    const recipe = this.learned.recipe;
    return {
      serverNow: now.toISOString(),
      clockOffsetMs: Number(this.settings.clockOffsetMs) || 0,
      tradingDay: store.tradingDay(now),
      targetAt: new Date(this.targetTimestamp(now)).toISOString(),
      fireStartAt: new Date(this.fireStartTimestamp(now)).toISOString(),
      secondsToFireStart: Math.round((this.fireStartTimestamp(now) - now.getTime()) / 1000),
      browserConnected: this.browser.connected,
      settings: this.settings,
      recipe: recipe && {
        label: recipe.label,
        url: recipe.url,
        method: recipe.method,
        learnedAt: recipe.learnedAt,
        fields: Object.keys(recipe.fields),
        side: recipe.fields.side ? recipe.fields.side.sample : null,
      },
      session: this.session,
    };
  }
}

module.exports = { Engine };
