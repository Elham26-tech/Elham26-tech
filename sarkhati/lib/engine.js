'use strict';

const store = require('./store');
const order = require('./order');

const MAX_LOG = 400;

class Engine {
  constructor() {
    this.settings = store.loadSettings();
    this.session = store.loadSession();
    this.learned = store.loadLearned();
    this.armTimer = null;
    this.fireTimer = null;
    this.stopTimer = null;
    this.inFlight = 0;
    this.listeners = new Set();
  }

  // ---- گزارش ----------------------------------------------------------
  onLog(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  log(message, level = 'info') {
    const entry = { at: new Date().toISOString(), level, message };
    this.session.log.push(entry);
    if (this.session.log.length > MAX_LOG) {
      this.session.log = this.session.log.slice(-MAX_LOG);
    }
    for (const fn of this.listeners) {
      try { fn(entry); } catch { /* یک شنونده نباید موتور را بخواباند */ }
    }
    return entry;
  }

  persist() {
    store.saveSession(this.session);
  }

  // ---- ساعت -----------------------------------------------------------
  /** زمان جاری با احتساب اختلاف ساعت سرور کارگزاری */
  now() {
    return new Date(Date.now() + (Number(this.settings.clockOffsetMs) || 0));
  }

  /** ساعت هدف امروز («HH:MM:SS») به‌صورت timestamp */
  targetTimestamp(now = this.now()) {
    const [h = 0, m = 0, s = 0] = String(this.settings.targetTime || '00:00:00')
      .split(':')
      .map((n) => Number(n) || 0);
    const target = new Date(now);
    target.setHours(h, m, s, 0);
    return target.getTime();
  }

  /**
   * --- باگ ۳ ---
   * لحظهٔ شروع شلیک = ساعت هدف منهای پنجرهٔ pre-arm. کارگزاری‌ها گاهی
   * تا یک دقیقه زودتر باز می‌کنند، پس از قبل شروع به تلاش می‌کنیم و
   * اولین پاسخ پذیرفته‌شده برنده است.
   */
  fireStartTimestamp(now = this.now()) {
    const pre = Math.max(0, Number(this.settings.preArmSeconds) || 0);
    return this.targetTimestamp(now) - pre * 1000;
  }

  async syncClock() {
    const url = this.settings.timeSyncUrl || this.settings.baseUrl;
    if (!url) {
      this.log('برای همگام‌سازی ساعت، آدرس کارگزاری را وارد کنید.', 'warn');
      this.persist();
      return { ok: false, offsetMs: this.settings.clockOffsetMs };
    }
    const sentAt = Date.now();
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const receivedAt = Date.now();
      const header = res.headers.get('date');
      if (!header) throw new Error('سرور هدر Date نفرستاد.');
      const roundTrip = receivedAt - sentAt;
      const serverTime = new Date(header).getTime() + roundTrip / 2;
      const offsetMs = Math.round(serverTime - receivedAt);
      this.settings = store.saveSettings({ clockOffsetMs: offsetMs });
      this.log(`ساعت همگام شد: اختلاف ${offsetMs} ms (رفت‌وبرگشت ${roundTrip} ms)`, 'ok');
      this.persist();
      return { ok: true, offsetMs, roundTripMs: roundTrip };
    } catch (err) {
      this.log(`همگام‌سازی ساعت ناموفق: ${err.message}`, 'error');
      this.persist();
      return { ok: false, error: err.message };
    }
  }

  // ---- بررسی (dry-run) ------------------------------------------------
  validate() {
    const formats = order.sideFormatCandidates(this.settings, this.learned);
    const built = order.buildOrder(this.settings, formats[0]);
    const problems = [...built.errors];
    if (!this.settings.baseUrl) problems.push('آدرس کارگزاری وارد نشده است.');
    if (!this.settings.token) problems.push('توکن/نشست کارگزاری وارد نشده است.');

    if (problems.length) {
      for (const p of problems) this.log(`بررسی: ${p}`, 'error');
    } else {
      this.log(`بررسی: سفارش معتبر است — ${JSON.stringify(built.body)}`, 'ok');
    }
    this.persist();
    return { ok: problems.length === 0, problems, body: built.body, sideFormat: formats[0] };
  }

  // ---- ارسال ----------------------------------------------------------
  async sendOnce(format) {
    const built = order.buildOrder(this.settings, format);
    if (!built.ok) {
      return { ok: false, status: 0, text: built.errors.join(' '), validation: true };
    }
    const url = String(this.settings.baseUrl).replace(/\/+$/, '') + this.settings.orderPath;
    const startedAt = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.settings.token ? { authorization: `Bearer ${this.settings.token}` } : {}),
        },
        body: JSON.stringify(built.body),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, ms: Date.now() - startedAt, format };
    } catch (err) {
      return { ok: false, status: 0, text: err.message, ms: Date.now() - startedAt, format };
    }
  }

  /** یک تلاش کامل، با یادگیری قالب Side در صورت خطای اعتبارسنجی */
  async attempt() {
    if (this.session.finished) return;
    const candidates = order.sideFormatCandidates(this.settings, this.learned);
    let result = null;

    for (const format of candidates) {
      this.session.attempts += 1;
      result = await this.sendOnce(format);

      if (result.ok) {
        this.session.accepted += 1;
        this.session.successOrderId = result.text.slice(0, 200);
        this.session.finished = true;
        this.learned = store.saveLearned({
          sideFormat: format,
          learnedAt: new Date().toISOString(),
          learnedFrom: 'پاسخ پذیرفته‌شدهٔ کارگزاری',
        });
        this.log(`سفارش پذیرفته شد (قالب Side: ${format}) — ${result.ms} ms`, 'ok');
        this.stopFiring('سفارش پذیرفته شد');
        return;
      }

      this.session.rejected += 1;
      this.session.lastError = `${result.status} — ${String(result.text).slice(0, 200)}`;

      // اگر ایراد از قالب Side بود، قالب بعدی را همین حالا امتحان کن
      if (order.isSideValidationError(result.status, result.text) && !this.learned.sideFormat) {
        this.log(`قالب Side «${format}» را کارگزاری نپذیرفت؛ قالب بعدی امتحان می‌شود.`, 'warn');
        continue;
      }
      break;
    }

    if (result) {
      this.log(
        `تلاش ${this.session.attempts}: رد — HTTP ${result.status} | ${String(result.text).slice(0, 160)}`,
        'error',
      );
    }
  }

  // ---- زمان‌بندی ------------------------------------------------------
  arm() {
    this.disarm(false);
    const now = this.now();
    const startAt = this.fireStartTimestamp(now);
    const delay = startAt - now.getTime();

    this.session = { ...store.freshSession(), log: this.session.log };
    this.session.armed = true;
    this.session.armedAt = new Date().toISOString();

    const pre = Math.max(0, Number(this.settings.preArmSeconds) || 0);
    if (delay <= 0) {
      this.log('ساعت هدف گذشته است؛ شلیک بلافاصله شروع می‌شود.', 'warn');
      this.startFiring();
    } else {
      this.log(
        `مسلح شد: شلیک ${pre} ثانیه زودتر از ${this.settings.targetTime} آغاز می‌شود ` +
          `(${Math.round(delay / 1000)} ثانیه دیگر).`,
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
    const interval = Math.max(10, Math.round(1000 / rate));
    this.log(`شروع شلیک: نرخ ${rate} در ثانیه، ${parallel} اتصال موازی.`, 'ok');

    this.fireTimer = setInterval(() => {
      if (this.session.finished) return this.stopFiring('پایان');
      if (this.session.attempts >= (Number(this.settings.maxAttempts) || Infinity)) {
        return this.stopFiring('سقف تعداد تلاش');
      }
      if (this.inFlight >= parallel) return;
      this.inFlight += 1;
      this.attempt()
        .catch((err) => this.log(`خطای غیرمنتظره: ${err.message}`, 'error'))
        .finally(() => {
          this.inFlight -= 1;
          this.persist();
        });
    }, interval);

    const cap = Number(this.settings.stopAfterSeconds) || 0;
    if (cap > 0) {
      this.stopTimer = setTimeout(() => this.stopFiring('سقف مدت'), cap * 1000);
    }
    this.persist();
  }

  stopFiring(reason) {
    if (this.fireTimer) clearInterval(this.fireTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
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
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = null;
    this.stopFiring('لغو توسط کاربر');
    this.session.armed = false;
    if (shouldLog) this.log('خلع سلاح شد.', 'info');
    this.persist();
    return this.status();
  }

  async fireNow() {
    this.session.finished = false;
    this.log('ارسال فوری یک سفارش.', 'info');
    await this.attempt();
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
      `حافظه پاک شد (${[session && 'جلسه', learned && 'یادگرفته‌ها'].filter(Boolean).join(' و ')}).`,
      'ok',
    );
    this.persist();
    return this.status();
  }

  status() {
    const now = this.now();
    return {
      serverNow: now.toISOString(),
      clockOffsetMs: Number(this.settings.clockOffsetMs) || 0,
      tradingDay: store.tradingDay(now),
      targetAt: new Date(this.targetTimestamp(now)).toISOString(),
      fireStartAt: new Date(this.fireStartTimestamp(now)).toISOString(),
      secondsToFireStart: Math.round((this.fireStartTimestamp(now) - now.getTime()) / 1000),
      settings: this.settings,
      learned: this.learned,
      session: this.session,
    };
  }
}

module.exports = { Engine };
