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
test('پاسخ JSON جست‌وجو به فهرست نماد تبدیل می‌شود', () => {
  const rows = tsetmc.parseSearchJson({
    instrumentSearch: [
      { lVal18AFC: 'فولاد', lVal30: 'فولاد مباركه اصفهان', insCode: '46348559193224090', lastDate: 20260915 },
      { lVal18AFC: 'فولاژ', lVal30: 'فولاد آلياژي ايران', insCode: '14957056743925737', lastDate: 20260915 },
      { lVal18AFC: '', lVal30: 'بدون کد', insCode: '' },
    ],
  });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].symbol, 'فولاد');
  assert.strictEqual(rows[0].insCode, '46348559193224090');
});

test('پاسخ متنی سرویس قدیمی هم خوانده می‌شود', () => {
  const rows = tsetmc.parseSearchLegacy(
    'فولاد,فولاد مباركه اصفهان,46348559193224090,1,1,1,,1;فولاژ,فولاد آلياژي,14957056743925737,1,1,1,,1;',
  );
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].symbol, 'فولاژ');
});

test('سقف و کف بدون تکیه بر نام فیلد درمی‌آید', () => {
  const t = tsetmc.thresholdsFromObject({
    insCode: '46348559193224090', dEven: 20260915,
    psGelStaticThreshold: 26250, psGelStaticThresholdMin: 23750,
  });
  assert.strictEqual(t.max, 26250);
  assert.strictEqual(t.min, 23750);
});

test('شناسه‌ها با سقف/کف اشتباه گرفته نمی‌شوند', () => {
  const t = tsetmc.thresholdsFromObject({ insCode: '46348559193224090', dEven: 20260915 });
  assert.strictEqual(t.max, null);
  assert.strictEqual(t.min, null);
});

test('ISIN از پاسخ اطلاعات نماد پیدا می‌شود', () => {
  const flat = tsetmc.flatten({ instrumentInfo: { instrumentID: 'IRO1FOLD0001', lVal18AFC: 'فولاد' } });
  assert.strictEqual(tsetmc.pickIsin(flat), 'IRO1FOLD0001');
  assert.strictEqual(tsetmc.pickIsin(tsetmc.flatten({ a: 'NOTANISIN' })), null);
});

test('عدد بر اساس الگوی نام کلید برداشته می‌شود', () => {
  const flat = tsetmc.flatten({ instrumentInfo: { baseVol: 9600000, maxOrderQty: 200000, zero: 0 } });
  assert.strictEqual(tsetmc.pickNumber(flat, /^baseVol$/i), 9600000);
  assert.strictEqual(tsetmc.pickNumber(flat, /^maxOrderQty$/i), 200000);
  assert.strictEqual(tsetmc.pickNumber(flat, /^zero$/i), null);
});

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

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stdout.write(`FAIL ${name}\n     ${err.message}\n`);
  }
}
fs.rmSync(process.env.SARKHATI_DATA_DIR, { recursive: true, force: true });
process.stdout.write(`\n${tests.length - failed}/${tests.length} تست موفق\n`);
process.exit(failed ? 1 : 0);
