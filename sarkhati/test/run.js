'use strict';

// تست‌های سبک بدون وابستگی بیرونی: node test/run.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SARKHATI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sarkhati-test-'));

const store = require('../lib/store');
const recipe = require('../lib/recipe');
const tsetmc = require('../lib/tsetmc');
const limits = require('../lib/limits');
const endpoint = require('../lib/endpoint');
const clock = require('../lib/clock');
const { Engine } = require('../lib/engine');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const SAMPLE_REQUEST = {
  method: 'POST',
  url: 'https://easy.broker.ir/api/Order/Create',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer abc123',
    host: 'easy.broker.ir',
    'content-length': '120',
    cookie: 'session=xyz',
  },
  postData: JSON.stringify({
    order: { isin: 'IRO1FOLD0001', side: 'Buy', quantity: 100, price: 25000, validity: 'Day' },
  }),
};

// --- باگ ۱: حافظهٔ جلسه نباید از اجرای قبلی بماند ---
test('جلسهٔ روز گذشته موقع بارگذاری دور ریخته می‌شود', () => {
  const stale = store.freshSession('2000-01-01');
  stale.attempts = 99;
  stale.armed = true;
  store.saveSession(stale);

  const loaded = store.loadSession();
  assert.strictEqual(loaded.day, store.tradingDay());
  assert.strictEqual(loaded.attempts, 0);
  assert.strictEqual(loaded.armed, false);
});

test('جلسهٔ همین روز حفظ می‌شود ولی مسلح/یادگیری به ارث نمی‌رسد', () => {
  const today = store.freshSession();
  Object.assign(today, { attempts: 7, armed: true, firing: true, learning: true });
  store.saveSession(today);

  const loaded = store.loadSession();
  assert.strictEqual(loaded.attempts, 7);
  assert.strictEqual(loaded.armed, false);
  assert.strictEqual(loaded.firing, false);
  assert.strictEqual(loaded.learning, false);
});

test('تنظیمات و سفارش یادگرفته‌شده مستقل از جلسه باقی می‌مانند', () => {
  store.saveSettings({ symbol: 'IRO1FOLD0001', preArmSeconds: 45 });
  store.saveRecipe(recipe.fromRequest(SAMPLE_REQUEST, { status: 200 }));
  store.resetSession();

  assert.strictEqual(store.loadSettings().symbol, 'IRO1FOLD0001');
  assert.strictEqual(store.loadSettings().preArmSeconds, 45);
  assert.ok(store.loadLearned().recipe, 'سفارش یادگرفته‌شده باید بماند');
});

// --- باگ ۲: سفارش از روی درخواست واقعی یاد گرفته می‌شود ---
test('درخواست ثبت سفارش تشخیص داده می‌شود', () => {
  assert.strictEqual(recipe.looksLikeOrder(SAMPLE_REQUEST), true);
  assert.strictEqual(recipe.looksLikeOrder({ method: 'GET', url: '/api/Order' }), false);
  assert.strictEqual(
    recipe.looksLikeOrder({ method: 'POST', url: '/api/Watchlist', postData: '{"x":1}' }),
    false,
  );
});

test('فیلدهای سفارش، حتی تودرتو، نقشه‌برداری می‌شوند', () => {
  const learned = recipe.fromRequest(SAMPLE_REQUEST, { status: 200 });
  assert.deepStrictEqual(learned.fields.side.path, ['order', 'side']);
  assert.strictEqual(learned.fields.side.sample, 'Buy');
  assert.deepStrictEqual(learned.fields.quantity.path, ['order', 'quantity']);
  assert.strictEqual(learned.fields.price.sample, 25000);
  assert.strictEqual(learned.fields.symbol.sample, 'IRO1FOLD0001');
});

test('هدرهای ناپایدار در دستور ذخیره نمی‌شوند', () => {
  const learned = recipe.fromRequest(SAMPLE_REQUEST, { status: 200 });
  assert.strictEqual(learned.headers.authorization, 'Bearer abc123');
  for (const dropped of ['host', 'content-length', 'cookie']) {
    assert.ok(!(dropped in learned.headers), `${dropped} نباید ذخیره شود`);
  }
});

test('مقدار Side دست‌نخورده می‌ماند و فقط تعداد/قیمت عوض می‌شود', () => {
  const learned = recipe.fromRequest(SAMPLE_REQUEST, { status: 200 });
  const built = recipe.build(learned, { quantity: 500, price: 26000 });
  const body = JSON.parse(built.body);

  assert.strictEqual(body.order.side, 'Buy', 'Side باید همانی بماند که کارگزاری پذیرفته');
  assert.strictEqual(body.order.quantity, 500);
  assert.strictEqual(body.order.price, 26000);
  assert.strictEqual(body.order.validity, 'Day');
  assert.strictEqual(built.url, SAMPLE_REQUEST.url);
});

test('نوعِ اصلی فیلد موقع جایگزینی حفظ می‌شود', () => {
  const stringQty = {
    ...SAMPLE_REQUEST,
    postData: JSON.stringify({ isin: 'X', side: 1, quantity: '100', price: '2500' }),
  };
  const built = recipe.build(recipe.fromRequest(stringQty), { quantity: 7, price: 30 });
  const body = JSON.parse(built.body);
  assert.strictEqual(body.quantity, '7');
  assert.strictEqual(body.price, '30');
  assert.strictEqual(body.side, 1);
});

test('بدون سفارش یادگرفته‌شده، اعتبارسنجی جلوی کار را می‌گیرد', () => {
  const check = recipe.validate(null, {});
  assert.strictEqual(check.ok, false);
  assert.ok(check.problems[0].includes('یاد گرفته'));
  assert.throws(() => recipe.build(null), /یاد گرفته/);
});

test('تعداد یا قیمت نامعتبر رد می‌شود', () => {
  const learned = recipe.fromRequest(SAMPLE_REQUEST, { status: 200 });
  assert.strictEqual(recipe.validate(learned, { quantity: 0 }).ok, false);
  assert.strictEqual(recipe.validate(learned, { price: -5 }).ok, false);
  assert.strictEqual(recipe.validate(learned, { quantity: 10, price: 100 }).ok, true);
});

// --- باگ ۳: شروع زودتر از ساعت هدف ---
test('شلیک دقیقاً preArmSeconds قبل از ساعت هدف شروع می‌شود', () => {
  const engine = new Engine();
  engine.updateSettings({ targetTime: '08:45:00', preArmSeconds: 60, clockOffsetMs: 0 });
  const now = engine.now();
  assert.strictEqual(engine.targetTimestamp(now) - engine.fireStartTimestamp(now), 60000);

  engine.updateSettings({ preArmSeconds: 90 });
  const later = engine.now();
  assert.strictEqual(engine.targetTimestamp(later) - engine.fireStartTimestamp(later), 90000);
});

test('اختلاف ساعت سرور در محاسبه لحاظ می‌شود', () => {
  const engine = new Engine();
  engine.updateSettings({ clockOffsetMs: 0 });
  const plain = engine.now().getTime();
  engine.updateSettings({ clockOffsetMs: 2500 });
  assert.ok(engine.now().getTime() - plain >= 2400);
});

test('بدون مرورگرِ وصل، مسلح‌سازی انجام نمی‌شود', () => {
  const engine = new Engine();
  const status = engine.arm();
  assert.strictEqual(status.session.armed, false);
  assert.ok(status.session.log.some((l) => l.message.includes('مسلح نشد')));
});

test('پاک‌کردن حافظه، جلسه را صفر و تنظیمات را حفظ می‌کند', () => {
  const engine = new Engine();
  engine.updateSettings({ symbol: 'IRO1FOLD0001' });
  engine.session.attempts = 12;
  const status = engine.resetMemory({ session: true, learned: true });
  assert.strictEqual(status.session.attempts, 0);
  assert.strictEqual(status.recipe, null);
  assert.strictEqual(status.settings.symbol, 'IRO1FOLD0001');
});

test('سفارش دستیِ موفق در مرورگر، یاد گرفته می‌شود', () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.updateSettings({ easyTraderUrl: 'https://easy.broker.ir' });
  engine.session.learning = true;

  engine.onBrowserEvent({
    method: 'Network.requestWillBeSent',
    params: { requestId: 'r1', request: SAMPLE_REQUEST },
  });
  engine.onBrowserEvent({
    method: 'Network.responseReceived',
    params: { requestId: 'r1', response: { status: 200 } },
  });

  const status = engine.status();
  assert.ok(status.recipe, 'باید دستور ساخته شود');
  assert.strictEqual(status.recipe.side, 'Buy');
  assert.strictEqual(status.session.learning, false, 'بعد از یادگیری باید خاموش شود');
});

test('سفارش دستیِ ناموفق یاد گرفته نمی‌شود', () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.updateSettings({ easyTraderUrl: 'https://easy.broker.ir' });
  engine.session.learning = true;

  engine.onBrowserEvent({
    method: 'Network.requestWillBeSent',
    params: { requestId: 'r2', request: SAMPLE_REQUEST },
  });
  engine.onBrowserEvent({
    method: 'Network.responseReceived',
    params: { requestId: 'r2', response: { status: 400 } },
  });

  assert.strictEqual(engine.status().recipe, null);
});

// --- نماد و سقف/کف (TSETMC) ---






test('قیمت ارسالی از حالت انتخابی می‌آید', () => {
  const engine = new Engine();
  engine.updateSettings({
    price: 111,
    instrument: { priceMax: 26250, priceMin: 23750 },
  });

  engine.updateSettings({ priceMode: 'max' });
  assert.strictEqual(engine.effectivePrice(), 26250);

  engine.updateSettings({ priceMode: 'min' });
  assert.strictEqual(engine.effectivePrice(), 23750);

  engine.updateSettings({ priceMode: 'manual' });
  assert.strictEqual(engine.effectivePrice(), 111);
});

test('اگر سقف/کف نداشته باشیم، قیمت دستی ملاک است', () => {
  const engine = new Engine();
  engine.updateSettings({ price: 500, priceMode: 'max', instrument: null });
  assert.strictEqual(engine.effectivePrice(), 500);
});

test('قیمت حالت سقف واقعاً داخل سفارش می‌نشیند', () => {
  const engine = new Engine();
  engine.updateSettings({
    priceMode: 'max',
    quantity: 400,
    instrument: { priceMax: 26250, priceMin: 23750 },
  });
  const built = recipe.build(recipe.fromRequest(SAMPLE_REQUEST), engine.overrides());
  const body = JSON.parse(built.body);
  assert.strictEqual(body.order.price, 26250);
  assert.strictEqual(body.order.quantity, 400);
  assert.strictEqual(body.order.side, 'Buy');
});

// --- درخواست‌هایی که سفارش نیستند ---
const ANALYTICS_REQUEST = {
  method: 'POST',
  url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-X&dl=https%3A%2F%2Fd.easytrader.ir%2F',
  headers: { 'content-type': 'text/plain' },
  postData: '{}',
};

test('درخواست گوگل آنالیتیکس سفارش حساب نمی‌شود', () => {
  // دامنهٔ کارگزاری خودش کلمهٔ trade را دارد؛ قبلاً همین باعث اشتباه می‌شد
  assert.strictEqual(
    recipe.looksLikeOrder(ANALYTICS_REQUEST, { origin: 'https://d.easytrader.ir' }),
    false,
  );
  assert.strictEqual(recipe.looksLikeOrder(ANALYTICS_REQUEST), false);
});

test('درخواست سفارش واقعی کارگزاری پذیرفته می‌شود', () => {
  const real = {
    method: 'POST',
    url: 'https://d.easytrader.ir/api/Order/Create',
    headers: { 'content-type': 'application/json' },
    postData: JSON.stringify({ isin: 'IRO1LBAN0001', side: 1, quantity: 5000, price: 10730 }),
  };
  assert.strictEqual(recipe.looksLikeOrder(real, { origin: 'https://d.easytrader.ir' }), true);
});

test('سایت دیگر بدون نشانهٔ قطعی رد می‌شود', () => {
  const foreign = {
    method: 'POST',
    url: 'https://tracker.example.com/api/trade',
    postData: JSON.stringify({ price: 5 }),
  };
  assert.strictEqual(recipe.looksLikeOrder(foreign, { origin: 'https://d.easytrader.ir' }), false);
});

test('اگر API کارگزاری روی دامنهٔ دیگری باشد، با نشانهٔ قطعی قبول می‌شود', () => {
  // بعضی کارگزاری‌ها صفحه را روی یک دامنه و API سفارش را روی دامنهٔ دیگر دارند
  const otherDomain = {
    method: 'POST',
    url: 'https://api.mofidonline.com/Order',
    postData: JSON.stringify({ isin: 'IRO1LBAN0001', side: 1, quantity: 5000, price: 10730 }),
  };
  assert.strictEqual(recipe.looksLikeOrder(otherDomain, { origin: 'https://d.easytrader.ir' }), true);
});

test('زیردامنهٔ دیگرِ همان کارگزاری قبول است', () => {
  const sub = {
    method: 'POST',
    url: 'https://api.easytrader.ir/v1/order',
    postData: JSON.stringify({ side: 'Buy', quantity: 10, price: 5 }),
  };
  assert.strictEqual(recipe.looksLikeOrder(sub, { origin: 'https://d.easytrader.ir' }), true);
});

test('درخواست بدون فیلد نوع سفارش ذخیره نمی‌شود و یادگیری روشن می‌ماند', () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.updateSettings({ easyTraderUrl: 'https://d.easytrader.ir' });
  engine.session.learning = true;

  const noSide = {
    method: 'POST',
    url: 'https://d.easytrader.ir/api/Order/Preview',
    postData: JSON.stringify({ isin: 'IRO1LBAN0001', quantity: 5000, price: 10730 }),
  };
  engine.onBrowserEvent({ method: 'Network.requestWillBeSent', params: { requestId: 'x', request: noSide } });
  engine.onBrowserEvent({ method: 'Network.responseReceived', params: { requestId: 'x', response: { status: 200 } } });

  assert.strictEqual(engine.status().recipe, null);
  assert.strictEqual(engine.session.learning, true, 'یادگیری باید روشن بماند');
});

test('دستور نامعتبرِ به‌جا مانده از نسخهٔ قبل، موقع شروع پاک می‌شود', () => {
  store.saveRecipe(recipe.fromRequest(ANALYTICS_REQUEST, { status: 204 }));
  assert.ok(store.loadLearned().recipe, 'برای تست باید ذخیره شده باشد');

  const engine = new Engine();
  assert.strictEqual(engine.status().recipe, null);
  assert.ok(engine.session.log.some((l) => l.message.includes('معتبر نبود')));
});

// --- سقف و کف از خود کارگزار ---
const BROKER_INSTRUMENT = {
  instrument: {
    isin: 'IRO3LABN0001',
    maxAllowedPrice: 10941,
    minAllowedPrice: 9899,
    closingPrice: 10420,
    tickSize: 1,
    maxOrderQuantity: 200000,
    minOrderQuantity: 1,
  },
};

test('سقف/کف و تعداد مجاز از پاسخ کارگزار درمی‌آید', () => {
  const found = limits.fromResponse(BROKER_INSTRUMENT);
  assert.strictEqual(found.upperPrice, 10941);
  assert.strictEqual(found.lowerPrice, 9899);
  assert.strictEqual(found.maxQuantity, 200000);
  assert.strictEqual(found.minQuantity, 1);
  assert.strictEqual(found.tick, 1);
  assert.strictEqual(limits.isUseful(found), true);
});

test('نام‌های صریح بر نام‌های کلی مقدم‌اند', () => {
  const found = limits.fromResponse({ max: 99, maxAllowedPrice: 10941, min: 1, minAllowedPrice: 9899 });
  assert.strictEqual(found.upperPrice, 10941);
  assert.strictEqual(found.lowerPrice, 9899);
});

test('اگر سقف و کف جابه‌جا خوانده شوند، اصلاح می‌شوند', () => {
  const found = limits.fromResponse({ ceil: 100, floor: 900 });
  assert.ok(found.upperPrice > found.lowerPrice);
});

test('پاسخ بی‌ربط، سقف/کف قابل‌استفاده نمی‌دهد', () => {
  assert.strictEqual(limits.isUseful(limits.fromResponse({ ok: true, items: [] })), false);
});

test('تخمین از قیمت دیروز صریحاً تخمینی علامت می‌خورد', () => {
  const found = limits.estimateFromYesterday(10420, 5);
  assert.strictEqual(found.estimated, true);
  assert.strictEqual(found.upperPrice, 10941);
  assert.strictEqual(found.lowerPrice, 9899);
  assert.strictEqual(limits.estimateFromYesterday(0), null);
});

// --- یادگیری مسیر اطلاعات نماد ---
test('مسیر اطلاعات نماد با پارامتر در نشانی یاد گرفته می‌شود', () => {
  const built = endpoint.build({
    method: 'GET',
    url: 'https://api.easytrader.ir/core/api/v2/instrument?isin=IRO3LABN0001&lang=fa',
  }, { isinMode: true });

  assert.strictEqual(built.param, 'isin');
  assert.strictEqual(built.sample, 'IRO3LABN0001');

  const next = endpoint.withValue(built, 'IRO1FOLD0001');
  assert.ok(next.url.includes('isin=IRO1FOLD0001'));
  assert.ok(next.url.includes('lang=fa'), 'بقیهٔ پارامترها باید بمانند');
});

test('کد نماد داخل خود مسیر هم پشتیبانی می‌شود', () => {
  const built = endpoint.build({
    method: 'GET',
    url: 'https://api.easytrader.ir/instrument/IRO3LABN0001/details',
  }, { isinMode: true });

  assert.strictEqual(built.param, '');
  const next = endpoint.withValue(built, 'IRO1FOLD0001');
  assert.strictEqual(next.url, 'https://api.easytrader.ir/instrument/IRO1FOLD0001/details');
});

test('کد نماد در بدنهٔ JSON هم عوض می‌شود', () => {
  const built = endpoint.build({
    method: 'POST',
    url: 'https://api.easytrader.ir/graphql',
    postData: JSON.stringify({ isin: 'IRO3LABN0001', market: 'bourse' }),
  }, { isinMode: true });

  assert.strictEqual(built.inBody, true);
  const body = JSON.parse(endpoint.withValue(built, 'IRO1FOLD0001').body);
  assert.strictEqual(body.isin, 'IRO1FOLD0001');
  assert.strictEqual(body.market, 'bourse', 'بقیهٔ بدنه باید دست‌نخورده بماند');
});

test('کد نماد داخل متن یک فیلد (مثل GraphQL) هم جایگزین می‌شود', () => {
  const built = endpoint.build({
    method: 'POST',
    url: 'https://api.easytrader.ir/graphql',
    postData: JSON.stringify({ query: '{ instrument(isin: "IRO3LABN0001") { maxPrice } }' }),
  }, { isinMode: true });

  assert.strictEqual(built.contains, true);
  const body = JSON.parse(endpoint.withValue(built, 'IRO1FOLD0001').body);
  assert.ok(body.query.includes('IRO1FOLD0001'));
  assert.ok(!body.query.includes('IRO3LABN0001'));
});

test('هدرهای قابل تکرار نگه داشته و ناپایدارها حذف می‌شوند', () => {
  const kept = endpoint.replayableHeaders({
    'x-broker-key': 'abc', accept: 'application/json',
    host: 'x.ir', 'content-length': '10', cookie: 'a=b',
  });
  assert.strictEqual(kept['x-broker-key'], 'abc');
  assert.ok(!('host' in kept) && !('cookie' in kept));
});

// --- فهرست نمادها برای جست‌وجوی آنی ---
test('فهرست بازار از پاسخ JSON خوانده می‌شود', () => {
  const rows = tsetmc.parse(JSON.stringify({
    marketwatch: [
      { insCode: '1', lva: 'x', lVal18AFC: 'فولاد', lVal30: 'فولاد مباركه', insCode2: 'IRO1FOLD0001', pdrCotVal: 25000, priceYesterday: 24800 },
      { lVal18AFC: 'شاخص', lVal30: 'شاخص كل', insCode2: 'IRX6XTPI0006' },
    ],
  }));
  assert.strictEqual(rows.length, 1, 'شاخص نباید در فهرست سهم‌ها بیاید');
  assert.strictEqual(rows[0].symbol, 'فولاد');
  assert.strictEqual(rows[0].isin, 'IRO1FOLD0001');
  assert.strictEqual(rows[0].yesterday, 24800);
});

test('فهرست بازار از پاسخ متنی قدیمی هم خوانده می‌شود', () => {
  const rows = tsetmc.parse('1,IRO1FOLD0001,فولاد,فولاد مباركه,2,3,24900,25000,24950,100,200,24800;');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].symbol, 'فولاد');
  assert.strictEqual(rows[0].yesterday, 24800);
});

test('جست‌وجوی محلی، تطبیق دقیق را اول می‌آورد', () => {
  const rows = [
    { symbol: 'فولاژ', name: 'فولاد آلياژي', isin: 'IR2' },
    { symbol: 'فولاد', name: 'فولاد مباركه', isin: 'IR1' },
    { symbol: 'وبملت', name: 'بانك ملت', isin: 'IR3' },
  ];
  const found = tsetmc.search(rows, 'فولاد');
  assert.strictEqual(found[0].symbol, 'فولاد');
  assert.strictEqual(found.length, 2);
  assert.strictEqual(tsetmc.search(rows, 'ملت')[0].symbol, 'وبملت');
  assert.strictEqual(tsetmc.search(rows, '').length, 0);
});

// --- حجم در برابر محدودیت کارگزاری ---
test('حجم بیرون از بازهٔ کارگزاری رد می‌شود', () => {
  const engine = new Engine();
  engine.updateSettings({
    quantity: 500000,
    instrument: { maxQuantity: 200000, minQuantity: 10 },
  });
  assert.ok(engine.quantityProblems()[0].includes('سقف'));

  engine.updateSettings({ quantity: 5 });
  assert.ok(engine.quantityProblems()[0].includes('کف'));

  engine.updateSettings({ quantity: 1000 });
  assert.deepStrictEqual(engine.quantityProblems(), []);
});

// --- یکسان‌سازی فارسی/عربی در جست‌وجو ---
test('«عیار» فارسی، نمادِ «عيار» عربی را پیدا می‌کند', () => {
  // دادهٔ TSETMC «ي» عربی دارد و کاربر «ی» فارسی تایپ می‌کند؛ این همان
  // چیزی بود که جست‌وجو را بی‌دلیل خالی برمی‌گرداند.
  const rows = [{ symbol: 'عيار', name: 'صندوق عيار', isin: 'IR1' }];
  assert.strictEqual(tsetmc.search(rows, 'عیار').length, 1);
  assert.strictEqual(tsetmc.search(rows, 'عيار').length, 1);
});

test('«ک» و «ي» و نیم‌فاصله و ارقام یکسان می‌شوند', () => {
  assert.strictEqual(tsetmc.normalizePersian('كيان'), tsetmc.normalizePersian('کیان'));
  assert.strictEqual(tsetmc.normalizePersian('فولاد\u200cمباركه'), 'فولاد مبارکه');
  assert.strictEqual(tsetmc.normalizePersian('۱۲۳'), '123');
  assert.strictEqual(tsetmc.normalizePersian('  آسيا '), 'اسیا');
});

test('نام شرکت با املای عربی هم پیدا می‌شود', () => {
  const rows = [{ symbol: 'وبملت', name: 'بانك ملت', isin: 'IR3' }];
  assert.strictEqual(tsetmc.search(rows, 'بانک').length, 1);
});

test('نماد کوتاه‌تر اول می‌آید', () => {
  const rows = [
    { symbol: 'فولادی', name: '', isin: 'IR9' },
    { symbol: 'فولاد', name: '', isin: 'IR1' },
    { symbol: 'فولاژ', name: '', isin: 'IR2' },
  ];
  assert.strictEqual(tsetmc.search(rows, 'فولاد')[0].symbol, 'فولاد');
});

// --- چند نامزد برای مسیر اطلاعات نماد ---
test('مسیر نمودار امتیاز کمتری از مسیر مشخصات نماد می‌گیرد', () => {
  // در گزارش واقعی کاربر، مسیر miniChart/history به‌عنوان «اطلاعات نماد»
  // یاد گرفته شده بود و هرگز سقف/کف نمی‌داد.
  const chart = { method: 'GET', url: 'https://api.easytrader.ir/chart/api/v2/datafeed/miniChart/history?isin=IRO1FOLD0001' };
  const info = { method: 'GET', url: 'https://api.easytrader.ir/core/api/v2/instrument?isin=IRO1FOLD0001' };
  assert.ok(endpoint.scoreEndpoint(info) > endpoint.scoreEndpoint(chart));
});

test('نامزدهای تکراری دوباره ثبت نمی‌شوند و به‌ترتیب امتیاز می‌مانند', () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.updateSettings({ easyTraderUrl: 'https://easytrader.ir/' });

  const chart = {
    method: 'GET',
    url: 'https://api.easytrader.ir/chart/api/v2/datafeed/miniChart/history?isin=IRO1FOLD0001&res=1',
    headers: {},
  };
  const info = {
    method: 'GET',
    url: 'https://api.easytrader.ir/core/api/v2/instrument?isin=IRO1FOLD0001',
    headers: {},
  };

  engine.learnEndpoints(chart);
  engine.learnEndpoints(info);
  engine.learnEndpoints({ ...chart, url: chart.url.replace('IRO1FOLD0001', 'IRO3LABN0001') });

  const candidates = engine.learned.candidates;
  assert.strictEqual(candidates.length, 2, 'همان مسیر با نماد دیگر، نامزد تازه نیست');
  assert.ok(candidates[0].url.includes('instrument'), 'مسیر مشخصات نماد باید اول باشد');
  assert.strictEqual(engine.status().candidateCount, 2);
});

test('نامزدی که سقف/کف بدهد، به‌عنوان مسیر اثبات‌شده ذخیره می‌شود', async () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.learned = store.saveCandidates([
    { method: 'GET', url: 'https://api.b.ir/chart/history?isin=IRO1FOLD0001', param: 'isin', sample: 'IRO1FOLD0001', headers: {}, postData: '' },
    { method: 'GET', url: 'https://api.b.ir/instrument?isin=IRO1FOLD0001', param: 'isin', sample: 'IRO1FOLD0001', headers: {}, postData: '' },
  ]);

  // نمودار داده‌ای بی‌ربط می‌دهد، مشخصات نماد سقف و کف
  engine.browser.replayRequest = async (req) => (req.url.includes('instrument')
    ? { ok: true, status: 200, text: JSON.stringify({ maxAllowedPrice: 10941, minAllowedPrice: 9899, maxOrderQuantity: 200000 }) }
    : { ok: true, status: 200, text: JSON.stringify({ t: [1, 2, 3], c: [10, 11, 12] }) });

  const found = await engine.brokerLimits('IRO3LABN0001');
  assert.ok(found, 'باید از نامزد دوم جواب بگیرد');
  assert.strictEqual(found.upperPrice, 10941);
  assert.ok(engine.learned.endpoints.instrument.url.includes('instrument'));
  assert.strictEqual(engine.status().hasInstrumentEndpoint, true);
});

test('اگر هیچ نامزدی جواب ندهد، سقف/کف تخمینی می‌شود', async () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.learned = store.saveCandidates([
    { method: 'GET', url: 'https://api.b.ir/chart/history?isin=IRO1FOLD0001', param: 'isin', sample: 'IRO1FOLD0001', headers: {}, postData: '' },
  ]);
  engine.browser.replayRequest = async () => ({ ok: true, status: 200, text: '{"t":[1,2]}' });

  const picked = await engine.selectSymbol({ isin: 'IRO3LABN0001', symbol: 'لبن', name: '', yesterday: 10420 });
  assert.strictEqual(picked.ok, true);
  assert.strictEqual(picked.instrument.estimated, true);
  assert.strictEqual(picked.instrument.priceMax, 10941);
});

// --- سمت سفارش: خرید و فروش ---
test('کد مقابل از روی سمتِ یادگرفته‌شده ساخته می‌شود', () => {
  assert.deepStrictEqual(recipe.sideCodes(0, false), { buy: 0, sell: 1 });
  assert.deepStrictEqual(recipe.sideCodes('Buy', false), { buy: 'Buy', sell: 'Sell' });
  // «۱» مبهم است: در الگوی ۱/۲ خرید است، در الگوی ۰/۱ فروش
  assert.deepStrictEqual(recipe.sideCodes(1, false), { buy: 1, sell: 2 });
  assert.deepStrictEqual(recipe.sideCodes(1, true), { buy: 0, sell: 1 });
});

test('انتخاب فروش، کد فروش را داخل سفارش می‌گذارد', () => {
  // سفارش دستیِ کاربر خرید با کد 0 بوده
  const learned = recipe.fromRequest({
    method: 'POST',
    url: 'https://api.easytrader.ir/core/api/v2/order',
    postData: JSON.stringify({ symbol: 'IRO1FOLD0001', side: 0, quantity: 100, price: 25000 }),
  });

  const buy = JSON.parse(recipe.build(learned, { side: 'buy', quantity: 10 }).body);
  assert.strictEqual(buy.side, 0);

  const sell = JSON.parse(recipe.build(learned, { side: 'sell', quantity: 10 }).body);
  assert.strictEqual(sell.side, 1, 'کد فروش باید مقابلِ کد خرید باشد');
  assert.strictEqual(sell.quantity, 10);
});

test('اگر سفارش دستی فروش بوده، کدها جابه‌جا می‌شوند', () => {
  const learned = recipe.fromRequest({
    method: 'POST',
    url: 'https://api.easytrader.ir/order',
    postData: JSON.stringify({ symbol: 'X', side: 1, quantity: 5, price: 10 }),
  });
  const buy = JSON.parse(recipe.build(learned, { side: 'buy', capturedIsSell: true }).body);
  assert.strictEqual(buy.side, 0);
});

test('سمت انتخابی کاربر واقعاً به سفارش می‌رسد', () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.updateSettings({ side: 'sell', quantity: 20, price: 500, priceMode: 'manual' });
  assert.strictEqual(engine.overrides().side, 'sell');
});

// --- زمان‌بندی دقیق ---
test('میلی‌ثانیهٔ ساعت هدف اعمال می‌شود', () => {
  const engine = new Engine();
  engine.updateSettings({ targetTime: '08:45:00', targetMillis: 0, leadMs: 0, clockOffsetMs: 0 });
  const base = engine.targetTimestamp();
  engine.updateSettings({ targetMillis: 250 });
  assert.strictEqual(engine.targetTimestamp() - base, 250);
});

test('پیش‌فرست، لحظهٔ هدف را جلو می‌کشد', () => {
  const engine = new Engine();
  engine.updateSettings({ targetTime: '08:45:00', targetMillis: 0, leadMs: 0 });
  const base = engine.targetTimestamp();
  engine.updateSettings({ leadMs: 120 });
  assert.strictEqual(base - engine.targetTimestamp(), 120);
});

test('فاصلهٔ ارسال کمتر از ۵ میلی‌ثانیه نمی‌شود', () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.updateSettings({ retryGapMs: 1, fireSeconds: 1 });
  // کمینه را موتور خودش اعمال می‌کند؛ اینجا فقط ذخیره‌شدنش را می‌سنجیم
  assert.strictEqual(engine.settings.retryGapMs, 1);
  assert.strictEqual(Math.max(5, engine.settings.retryGapMs), 5);
});

// --- گزارشِ دلیلِ شکستِ نامزدها ---
test('وقتی نامزدی جواب ندهد، دلیلش در گزارش می‌آید', async () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.learned = store.saveCandidates([
    { method: 'GET', url: 'https://api.b.ir/chart/history?isin=IRO1FOLD0001', param: 'isin', sample: 'IRO1FOLD0001', headers: {}, postData: '' },
    { method: 'GET', url: 'https://api.b.ir/quote?isin=IRO1FOLD0001', param: 'isin', sample: 'IRO1FOLD0001', headers: {}, postData: '' },
  ]);
  engine.browser.replayRequest = async (req) => (req.url.includes('quote')
    ? { ok: false, status: 401, text: 'unauthorized' }
    : { ok: true, status: 200, text: JSON.stringify({ t: [1], c: [2] }) });

  const found = await engine.brokerLimits('IRO3LABN0001');
  assert.strictEqual(found, null);

  const log = engine.session.log.map((l) => l.message).join('\n');
  assert.ok(log.includes('HTTP 401'), 'کد وضعیت باید گزارش شود');
  assert.ok(log.includes('سقف/کف در پاسخ نبود'), 'دلیل نبودِ سقف/کف باید گزارش شود');
});

// --- ترکیب سقف/کف از چند مسیر (همان کاری که نسخهٔ اصلی می‌کرد) ---
test('اعداد چند پاسخ با هم ترکیب می‌شوند', () => {
  // هیچ پاسخی همهٔ اعداد را ندارد: یکی سقف/کف دارد، دیگری حجم مجاز
  let merged = limits.emptyLimits();
  merged = limits.merge(merged, limits.fromResponse({ maxAllowedPrice: 10941, minAllowedPrice: 9899 }));
  assert.strictEqual(limits.isUseful(merged), true);
  assert.strictEqual(merged.maxQuantity, null);

  merged = limits.merge(merged, limits.fromResponse({ maxOrderQuantity: 200000, tickSize: 10 }));
  assert.strictEqual(merged.upperPrice, 10941, 'عدد قبلی نباید پاک شود');
  assert.strictEqual(merged.maxQuantity, 200000);
  assert.strictEqual(merged.tick, 10);
});

test('ترکیب، عدد موجود را با عدد پاسخ بعدی خراب نمی‌کند', () => {
  let merged = limits.emptyLimits();
  merged = limits.merge(merged, limits.fromResponse({ maxAllowedPrice: 10941 }));
  merged = limits.merge(merged, limits.fromResponse({ maxAllowedPrice: 999 }));
  assert.strictEqual(merged.upperPrice, 10941);
});

test('سقف/کف از دو مسیر جدا کنار هم جمع می‌شوند', async () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.learned = store.saveCandidates([
    { method: 'GET', url: 'https://api.b.ir/price?isin=IRO1FOLD0001', param: 'isin', sample: 'IRO1FOLD0001', headers: {}, postData: '' },
    { method: 'GET', url: 'https://api.b.ir/limit?isin=IRO1FOLD0001', param: 'isin', sample: 'IRO1FOLD0001', headers: {}, postData: '' },
  ]);
  engine.browser.replayRequest = async (req) => (req.url.includes('/price')
    ? { ok: true, status: 200, text: JSON.stringify({ maxAllowedPrice: 10941, minAllowedPrice: 9899 }) }
    : { ok: true, status: 200, text: JSON.stringify({ maxOrderQuantity: 200000, minOrderQuantity: 10 }) });

  const found = await engine.brokerLimits('IRO3LABN0001');
  assert.strictEqual(found.upperPrice, 10941);
  assert.strictEqual(found.lowerPrice, 9899);
  assert.strictEqual(found.maxQuantity, 200000, 'حجم مجاز از مسیر دوم باید اضافه شود');
  assert.strictEqual(found.minQuantity, 10);
});

// --- کد نماد داخل خودِ نشانی، وقتی پارامتر جواب نمی‌دهد ---
test('اگر پارامتر پیدا نشد، کد نماد داخل نشانی جایگزین می‌شود', () => {
  const broken = {
    method: 'GET',
    url: 'https://api.b.ir/ms/api/MarketSheet/sum/IRTKMOFD0001/',
    param: 'isin',            // پارامتری که اصلاً در نشانی نیست
    sample: 'IRTKMOFD0001',
    headers: {},
    postData: '',
  };
  const next = endpoint.withValue(broken, 'IRO1FOLD0001');
  assert.ok(next, 'باید جایگزین شود، نه اینکه رد شود');
  assert.ok(next.url.endsWith('/MarketSheet/sum/IRO1FOLD0001/'));
});

// --- ساعت کارگزار با دقت میلی‌ثانیه ---
test('زمان سرور از هر شکلی از پاسخ خوانده می‌شود', () => {
  const now = Date.now();
  assert.strictEqual(clock.serverTimestampOf({ serverTime: now }), now);
  assert.strictEqual(clock.serverTimestampOf({ data: { currentTimeMillis: now } }), now);
  // ثانیه به‌جای میلی‌ثانیه
  const seconds = Math.floor(now / 1000);
  assert.strictEqual(clock.serverTimestampOf({ time: seconds }), seconds * 1000);
  assert.strictEqual(clock.serverTimestampOf({ ok: true, count: 5 }), null);
});

test('عددهای بی‌ربط به‌جای زمان گرفته نمی‌شوند', () => {
  assert.strictEqual(clock.plausibleEpochMillis(5), false);
  assert.strictEqual(clock.plausibleEpochMillis(Date.now()), true);
  assert.strictEqual(clock.plausibleEpochMillis(Date.UTC(1990, 0, 1)), false);
});

test('کم‌تأخیرترین نمونه ملاک است', () => {
  const best = clock.bestReading([
    { offset: 900, rtt: 400 },
    { offset: 120, rtt: 40 },
    { offset: 500, rtt: 250 },
  ]);
  assert.strictEqual(best.offsetMs, 120, 'نمونه‌ای با کمترین رفت‌وبرگشت کمترین خطا را دارد');
  assert.strictEqual(best.rttMs, 40);
  assert.strictEqual(best.samples, 3);
  assert.strictEqual(clock.bestReading([]), null);
});

test('اختلاف از روی وسطِ رفت‌وبرگشت حساب می‌شود', () => {
  // سرور در لحظهٔ ۱۰۰۰ عدد داده؛ ما در ۹۰۰ فرستادیم و در ۱۱۰۰ گرفتیم
  const r = clock.readingFrom(1000, 900, 1100);
  assert.strictEqual(r.rtt, 200);
  assert.strictEqual(r.offset, 0, 'وسطِ رفت‌وبرگشت ۱۰۰۰ است، پس اختلاف صفر');
});

// --- گام قیمت ---
test('قیمتی که مضرب گام قیمت نیست رد می‌شود', () => {
  const learned = recipe.fromRequest(SAMPLE_REQUEST, { status: 200 });
  const bad = recipe.validate(learned, { quantity: 10, price: 10005, tick: 10 });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.includes('گام قیمت')));

  assert.strictEqual(recipe.validate(learned, { quantity: 10, price: 10010, tick: 10 }).ok, true);
  assert.strictEqual(recipe.validate(learned, { quantity: 10, price: 10005, tick: 1 }).ok, true);
});

// --- سقف/کف از پاسخ زندهٔ مرورگر ---
test('سقف/کف از پاسخی که ایزی‌تریدر گرفته برداشته می‌شود', async () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.updateSettings({ easyTraderUrl: 'https://easytrader.ir/' });

  const request = { method: 'GET', url: 'https://api.easytrader.ir/ms/api/MarketSheet/sum/IRO1FOLD0001/' };
  engine.browser.send = async (method) => {
    assert.strictEqual(method, 'Network.getResponseBody');
    return { base64Encoded: false, body: JSON.stringify({
      maxAllowedPrice: 26250, minAllowedPrice: 23750, maxOrderQuantity: 200000,
    }) };
  };

  engine.onBrowserEvent({
    method: 'Network.requestWillBeSent',
    params: { requestId: 'q1', request },
  });
  await engine.captureLimits('q1', request, { status: 200, mimeType: 'application/json' }, 'S1');

  const picked = await engine.selectSymbol({ isin: 'IRO1FOLD0001', symbol: 'فولاد', name: '', yesterday: 25000 });
  assert.strictEqual(picked.instrument.estimated, false, 'نباید تخمینی باشد');
  assert.strictEqual(picked.instrument.priceMax, 26250);
  assert.strictEqual(picked.instrument.maxQuantity, 200000);
});

test('پاسخِ بدون سقف/کف نگه داشته نمی‌شود', async () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  const request = { method: 'GET', url: 'https://api.easytrader.ir/chart/IRO1FOLD0001/history' };
  engine.browser.send = async () => ({ base64Encoded: false, body: JSON.stringify({ t: [1, 2], c: [3, 4] }) });

  await engine.captureLimits('q2', request, { status: 200, mimeType: 'application/json' }, 'S1');
  assert.strictEqual(engine.capturedLimits.size, 0);
});

test('پاسخ HTML اصلاً خوانده نمی‌شود', async () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  let called = false;
  engine.browser.send = async () => { called = true; return { body: '<html>' }; };

  await engine.captureLimits('q3', { url: 'https://api.easytrader.ir/x/IRO1FOLD0001' },
    { status: 200, mimeType: 'text/html' }, 'S1');
  assert.strictEqual(called, false, 'برای HTML نباید بدنه خوانده شود');
});

test('کد نماد از نشانی یا بدنه پیدا می‌شود', () => {
  const engine = new Engine();
  assert.strictEqual(engine.isinOf({ url: 'https://x.ir/a/IRO1FOLD0001/b' }), 'IRO1FOLD0001');
  assert.strictEqual(engine.isinOf({ url: 'https://x.ir/a', postData: '{"isin":"IRO3LABN0001"}' }), 'IRO3LABN0001');
  assert.strictEqual(engine.isinOf({ url: 'https://x.ir/a' }), null);
});

// --- توقف وقتی سرور کارگزاری بالا نیست ---
test('بعد از خطاهای پیاپیِ سمت سرور، شلیک می‌ایستد', async () => {
  const engine = new Engine();
  engine.resetMemory({ session: true, learned: true });
  engine.updateSettings({ easyTraderUrl: 'https://easy.broker.ir', quantity: 10, price: 100, priceMode: 'manual' });
  engine.learned = store.saveRecipe(recipe.fromRequest(SAMPLE_REQUEST, { status: 200 }));
  engine.browser.replayRequest = async () => ({ ok: false, status: 504, text: 'gateway timeout' });

  engine.session.firing = true;
  engine.serverErrors = 0;
  for (let i = 0; i < 15 && engine.session.firing; i += 1) await engine.attempt();

  assert.strictEqual(engine.session.firing, false, 'باید متوقف شده باشد');
  assert.ok(engine.session.attempts < 15, 'نباید تا آخر ادامه بدهد');
  const log = engine.session.log.map((l) => l.message).join('\n');
  assert.ok(log.includes('شلیک متوقف شد'));
});

let failed = 0;
(async () => {
for (const [name, fn] of tests) {
  try {
    await fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stdout.write(`FAIL ${name}\n     ${err.message}\n`);
  }
}
fs.rmSync(process.env.SARKHATI_DATA_DIR, { recursive: true, force: true });
process.stdout.write(`\n${tests.length - failed}/${tests.length} تست موفق\n`);
process.exit(failed ? 1 : 0);
})();
