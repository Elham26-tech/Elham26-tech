'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');
const recipeLib = require('./recipe');
const tsetmc = require('./tsetmc');
const endpointLib = require('./endpoint');
const limitsLib = require('./limits');
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

    this.dropInvalidRecipe();
    this.browser.on('event', (msg) => this.onBrowserEvent(msg));
    this.browser.on('disconnected', () => this.log('ارتباط با مرورگر قطع شد.', 'warn'));
  }

  /**
   * نسخه‌های قبلی، درخواست‌های آمار (مثل گوگل آنالیتیکس) را هم سفارش
   * حساب می‌کردند. چنین دستوری قابل اجرا نیست، پس همین ابتدا دور ریخته
   * می‌شود تا کاربر دوباره و درست یاد بدهد.
   */
  dropInvalidRecipe() {
    const recipe = this.learned.recipe;
    if (!recipe) return;
    const junk = !recipe.fields || !recipe.fields.side
      || recipeLib.THIRD_PARTY.test(recipe.url || '');
    if (!junk) return;
    this.learned = store.resetLearned();
    this.log('سفارش یادگرفته‌شدهٔ قبلی معتبر نبود و پاک شد؛ لطفاً یک بار دیگر دستی سفارش بزنید.', 'warn');
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
      const sessionId = this.browser.sessionFor(this.settings.easyTraderUrl);
      if (!sessionId) throw new Error('اول ایزی‌تریدر را باز کنید.');
      const sentAt = Date.now();
      const result = await this.browser.send('Runtime.evaluate', {
        expression: `(async () => {
          for (const init of [{ method: 'HEAD' }, { method: 'GET' }]) {
            try {
              const res = await fetch(location.href, { ...init, cache: 'no-store' });
              const date = res.headers.get('date');
              if (date) return date;
            } catch (err) { /* روش بعدی */ }
          }
          return '';
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
      if (!request) return;
      this.learnEndpoints(request);
      if (request.method === 'POST' || request.method === 'PUT') {
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
      if (!recipeLib.looksLikeOrder(request, { origin: this.settings.easyTraderUrl })) {
        this.noteSkipped(request);
        return;
      }

      const recipe = recipeLib.fromRequest(request, response);
      // بدون فیلد نوع سفارش، این دستور بعداً قابل اجرا نیست — ذخیره نمی‌کنیم
      // و یادگیری روشن می‌ماند تا سفارش واقعی برسد.
      if (!recipe.fields.side) {
        this.log(`درخواست ${new URL(request.url).pathname} سفارش نبود (فیلد نوع سفارش نداشت) — رد شد.`, 'warn');
        return;
      }
      this.learned = store.saveRecipe(recipe);
      this.session.learning = false;
      this.log(`سفارش یاد گرفته شد — ${recipe.label}`, 'ok');
      this.log('حالا فقط ساعت هدف را تنظیم و «مسلح کردن» را بزنید.', 'info');
      this.persist();
    }
  }

  /**
   * از ترافیک ایزی‌تریدر، درخواست «اطلاعات نماد» را یاد می‌گیرد تا بعداً
   * بشود دربارهٔ نماد دیگری هم از خودِ کارگزار پرسید — سقف و کف مجاز و
   * تعداد مجاز از همان‌جا می‌آید، نه از تخمین.
   */
  learnEndpoints(request) {
    if (this.learned.endpoints && this.learned.endpoints.instrument) return;
    if (endpointLib.replayableHeaders && !request.url) return;
    if (recipeLib.THIRD_PARTY.test(request.url)) return;
    if (recipeLib.looksLikeOrder(request, { origin: this.settings.easyTraderUrl })) return;

    const built = endpointLib.build(request, { isinMode: true });
    if (!built) return;
    built.headers = endpointLib.replayableHeaders(request.headers);
    this.learned = store.saveEndpoint('instrument', built);
    this.log(`مسیر اطلاعات نماد از کارگزاری یاد گرفته شد: ${new URL(built.url).pathname}`, 'ok');
    this.persist();
  }

  /**
   * سقف/کف مجاز و تعداد مجاز را از خودِ کارگزار می‌پرسد: همان درخواستی که
   * ایزی‌تریدر می‌زند، این بار با کد نماد انتخاب‌شده، از داخل خود صفحه.
   */
  async brokerLimits(isin) {
    const endpoint = this.learned.endpoints && this.learned.endpoints.instrument;
    if (!endpoint) return null;
    const prepared = endpointLib.withValue(endpoint, isin);
    if (!prepared) return null;

    try {
      const result = await this.browser.replayRequest({
        method: prepared.method,
        url: prepared.url,
        headers: prepared.headers,
        body: prepared.method === 'GET' ? null : prepared.body,
      });
      if (!result.ok) {
        this.log(`کارگزاری به پرسش اطلاعات نماد پاسخ HTTP ${result.status} داد.`, 'warn');
        return null;
      }
      const payload = JSON.parse(result.text);
      const limits = limitsLib.fromResponse(payload);
      this.lastBrokerLimits = { url: prepared.url, limits };
      return limitsLib.isUseful(limits) ? limits : null;
    } catch (err) {
      this.log(`گرفتن سقف/کف از کارگزاری ناموفق: ${err.message}`, 'warn');
      return null;
    }
  }

  /** چند تا از درخواست‌هایی که سفارش نبودند را گزارش می‌کند، بدون شلوغ‌کاری */
  noteSkipped(request) {
    this.skipped = (this.skipped || 0) + 1;
    if (this.skipped > 5) return;
    let where = request.url;
    try { where = new URL(request.url).pathname; } catch { /* آدرس نامعتبر */ }
    this.log(`نادیده گرفته شد (سفارش نبود): ${where}`, 'info');
  }

  setLearning(on) {
    this.skipped = 0;
    this.session.learning = Boolean(on);
    this.log(on ? 'حالت یادگیری روشن شد؛ یک سفارش دستی ثبت کنید.' : 'حالت یادگیری خاموش شد.', 'info');
    this.persist();
    return this.status();
  }

  // ---- نماد و سقف/کف --------------------------------------------------

  /**
   * فهرست کل بازار یک‌بار گرفته و روی دیسک نگه داشته می‌شود، بعد جست‌وجو
   * محلی انجام می‌گیرد. برای همین نتیجه حین تایپ بی‌درنگ می‌آید.
   */
  async ensureSymbols({ force = false } = {}) {
    if (!force && this.symbols && this.symbols.length) return this.symbols;

    const cached = store.loadSymbols();
    const freshEnough = cached.fetchedAt
      && Date.now() - new Date(cached.fetchedAt).getTime() < 12 * 3600 * 1000;
    if (!force && cached.rows.length && freshEnough) {
      this.symbols = cached.rows;
      return this.symbols;
    }

    try {
      const { rows, url } = await tsetmc.fetchMarketWatch();
      store.saveSymbols(rows, url);
      this.symbols = rows;
      this.log(`فهرست نمادها به‌روز شد: ${rows.length} نماد از ${new URL(url).hostname}`, 'ok');
      this.persist();
      return rows;
    } catch (err) {
      if (cached.rows.length) {
        this.symbols = cached.rows;
        this.log(`فهرست تازه گرفته نشد (${err.message})؛ از فهرست ذخیره‌شده استفاده می‌شود.`, 'warn');
        this.persist();
        return this.symbols;
      }
      throw err;
    }
  }

  async searchSymbol(query) {
    try {
      const rows = await this.ensureSymbols();
      return { ok: true, rows: tsetmc.search(rows, query), total: rows.length };
    } catch (err) {
      this.log(`جست‌وجوی نماد ناموفق: ${err.message}`, 'error');
      this.persist();
      return { ok: false, rows: [], error: err.message };
    }
  }

  /**
   * نماد را انتخاب می‌کند و محدودیت‌هایش را می‌گیرد.
   * اول از خودِ کارگزار — که مرجع واقعی است — و فقط اگر نشد، تخمین از
   * قیمت دیروز، که آن‌وقت صریحاً «تخمینی» علامت می‌خورد.
   */
  async selectSymbol(row) {
    const isin = String(row.isin || '').trim();
    if (!isin) {
      this.log('نماد انتخاب‌شده کد ISIN ندارد.', 'error');
      this.persist();
      return { ok: false, error: 'نماد بدون کد' };
    }

    let limits = await this.brokerLimits(isin);
    let estimated = false;

    if (!limits) {
      limits = limitsLib.estimateFromYesterday(row.yesterday || row.closing, this.settings.rangePercent);
      estimated = Boolean(limits);
      if (limits) {
        this.log(
          this.learned.endpoints && this.learned.endpoints.instrument
            ? 'کارگزاری سقف/کف نداد؛ فعلاً تخمین از قیمت دیروز استفاده می‌شود.'
            : 'هنوز مسیر اطلاعات نماد از کارگزاری یاد گرفته نشده؛ در ایزی‌تریدر نماد را باز کنید تا سقف/کف واقعی بیاید.',
          'warn',
        );
      }
    }

    const instrument = {
      isin,
      symbol: row.symbol || '',
      name: row.name || '',
      insCode: row.insCode || '',
      priceMax: limits ? limits.upperPrice : null,
      priceMin: limits ? limits.lowerPrice : null,
      tick: limits ? limits.tick : null,
      maxQuantity: limits ? limits.maxQuantity : null,
      minQuantity: limits ? limits.minQuantity : null,
      lastPrice: (limits && limits.lastPrice) || row.last || null,
      yesterdayPrice: row.yesterday || null,
      estimated,
      source: limits ? limits.source : null,
      fetchedAt: new Date().toISOString(),
    };

    this.settings = store.saveSettings({
      symbol: isin,
      symbolName: instrument.name || instrument.symbol,
      insCode: instrument.insCode,
      instrument,
    });

    this.log(
      `نماد ${instrument.symbol}: سقف ${instrument.priceMax ?? '—'} / کف ${instrument.priceMin ?? '—'}`
        + (estimated ? ' (تخمینی)' : ' (از کارگزاری)'),
      estimated ? 'warn' : 'ok',
    );
    if (instrument.maxQuantity || instrument.minQuantity) {
      this.log(`تعداد مجاز هر سفارش: ${instrument.minQuantity ?? '—'} تا ${instrument.maxQuantity ?? '—'}`, 'info');
    }
    this.persist();
    return { ok: true, instrument };
  }

  /** قیمتی که واقعاً ارسال می‌شود: سقف مجاز، کف مجاز، یا عدد دستی */
  effectivePrice() {
    const instrument = this.settings.instrument;
    if (this.settings.priceMode === 'max' && instrument && instrument.priceMax) return instrument.priceMax;
    if (this.settings.priceMode === 'min' && instrument && instrument.priceMin) return instrument.priceMin;
    return this.settings.price ?? undefined;
  }

  overrides() {
    return {
      symbol: this.settings.symbol || undefined,
      quantity: this.settings.quantity ?? undefined,
      price: this.effectivePrice(),
    };
  }

  // ---- بررسی ----------------------------------------------------------
  /** حجم سفارش را با محدودیت خودِ کارگزاری می‌سنجد */
  quantityProblems() {
    const inst = this.settings.instrument;
    const quantity = Number(this.settings.quantity);
    if (!inst || !(quantity > 0)) return [];
    const problems = [];
    if (inst.maxQuantity && quantity > inst.maxQuantity) {
      problems.push(`تعداد ${quantity} از سقف کارگزاری (${inst.maxQuantity}) بیشتر است.`);
    }
    if (inst.minQuantity && quantity < inst.minQuantity) {
      problems.push(`تعداد ${quantity} از کف کارگزاری (${inst.minQuantity}) کمتر است.`);
    }
    return problems;
  }

  validate() {
    const check = recipeLib.validate(this.learned.recipe, this.overrides());
    check.problems = [...check.problems, ...this.quantityProblems()];
    check.ok = check.problems.length === 0;
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

    // ۵xx یعنی ایراد سمت کارگزاری است، نه سفارش ما — معمولاً بیرون از
    // ساعت معاملات. بدون این توضیح، کاربر دنبال اشکالِ نداشته می‌گردد.
    const serverSide = result.status >= 500;
    this.log(
      `تلاش ${attemptNo}: رد — HTTP ${result.status}`
        + (serverSide ? ' (سرور کارگزاری پاسخ نداد؛ احتمالاً بیرون از ساعت معاملات)' : '')
        + ` | ${String(result.text).slice(0, 140)}`,
      'error',
    );
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

  /**
   * یک فایل خروجی برای عیب‌یابی می‌سازد که هر چیز محرمانه‌ای (توکن، کوکی،
   * کلید) داخلش حذف شده — امن برای فرستادن به کسی که کمک می‌کند.
   */
  exportDiagnostics() {
    const SECRET = /(auth|token|key|cookie|session|password|jwt|bearer)/i;
    const redact = (obj) => Object.fromEntries(
      Object.entries(obj || {}).map(([k, v]) => [k, SECRET.test(k) ? '«حذف شد»' : v]),
    );

    const recipe = this.learned.recipe;
    const report = {
      ساخته_شده: new Date().toISOString(),
      نسخهٔ_نود: process.version,
      سیستم: process.platform,
      تنظیمات: {
        ...redact(this.settings),
        instrument: this.settings.instrument,
      },
      سفارش_یادگرفته‌شده: recipe && {
        method: recipe.method,
        url: recipe.url,
        headerNames: Object.keys(recipe.headers || {}),
        headers: redact(recipe.headers),
        body: recipe.parsedBody,
        fields: recipe.fields,
        learnedAt: recipe.learnedAt,
      },
      مسیر_اطلاعات_نماد: (this.learned.endpoints && this.learned.endpoints.instrument) || null,
      آخرین_سقف_کف_کارگزاری: this.lastBrokerLimits || null,
      تعداد_نمادهای_فهرست: (this.symbols || []).length,
      گزارش: this.session.log.slice(-60),
    };

    const file = path.join(store.DATA_DIR, 'diagnostics.json');
    fs.mkdirSync(store.DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    this.log(`فایل عیب‌یابی ساخته شد: ${file}`, 'ok');
    this.log('این فایل توکن و کوکی ندارد و فرستادنش امن است.', 'info');
    this.persist();
    return { ok: true, file, report };
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
      hasInstrumentEndpoint: Boolean(this.learned.endpoints && this.learned.endpoints.instrument),
      symbolCount: (this.symbols || []).length,
      settings: this.settings,
      effectivePrice: this.effectivePrice() ?? null,
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
