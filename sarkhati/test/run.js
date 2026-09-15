'use strict';

// تست‌های سبک بدون وابستگی بیرونی: node test/run.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SARKHATI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sarkhati-test-'));

const store = require('../lib/store');
const order = require('../lib/order');
const { Engine } = require('../lib/engine');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- باگ ۱: حافظهٔ جلسه نباید از روز قبل بماند ---
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

test('جلسهٔ همین روز حفظ می‌شود ولی «مسلح» به ارث نمی‌رسد', () => {
  const today = store.freshSession();
  today.attempts = 7;
  today.armed = true;
  today.firing = true;
  store.saveSession(today);

  const loaded = store.loadSession();
  assert.strictEqual(loaded.attempts, 7);
  assert.strictEqual(loaded.armed, false);
  assert.strictEqual(loaded.firing, false);
});

test('تنظیمات ماندگار جدا از جلسه باقی می‌ماند', () => {
  store.saveSettings({ isinOrSymbol: 'IRO1FOLD0001', preArmSeconds: 45 });
  store.resetSession();
  const settings = store.loadSettings();
  assert.strictEqual(settings.isinOrSymbol, 'IRO1FOLD0001');
  assert.strictEqual(settings.preArmSeconds, 45);
});

// --- باگ ۲: قالب فیلد Side ---
test('نوع سفارش از هر نوشتاری یکدست می‌شود', () => {
  for (const raw of ['buy', 'BUY', ' Buy ', 'خرید', 1, '1']) {
    assert.strictEqual(order.canonicalSide(raw), 'buy', String(raw));
  }
  for (const raw of ['sell', 'فروش', 2, '2']) {
    assert.strictEqual(order.canonicalSide(raw), 'sell', String(raw));
  }
  assert.strictEqual(order.canonicalSide(''), null);
  assert.strictEqual(order.canonicalSide(undefined), null);
});

test('سفارش بدون نوع/نماد/تعداد اصلاً ساخته نمی‌شود', () => {
  const built = order.buildOrder({ side: '', isinOrSymbol: '', quantity: 0, price: 0 }, 'numeric');
  assert.strictEqual(built.ok, false);
  assert.strictEqual(built.errors.length, 4);
});

test('هر قالب Side مقدار درست خودش را می‌سازد', () => {
  const base = { side: 'buy', isinOrSymbol: 'X', quantity: 10, price: 1000, priceStep: 1 };
  assert.strictEqual(order.buildOrder(base, 'numeric').body.side, 1);
  assert.strictEqual(order.buildOrder(base, 'pascal').body.side, 'Buy');
  assert.strictEqual(order.buildOrder(base, 'lower').body.side, 'buy');
  assert.strictEqual(order.buildOrder(base, 'upper').body.side, 'BUY');
});

test('قالب یادگرفته‌شده اول امتحان می‌شود', () => {
  const candidates = order.sideFormatCandidates({ sideFormat: 'auto' }, { sideFormat: 'pascal' });
  assert.strictEqual(candidates[0], 'pascal');
  assert.strictEqual(candidates.length, order.FORMAT_ORDER.length);

  const pinned = order.sideFormatCandidates({ sideFormat: 'upper' }, { sideFormat: 'pascal' });
  assert.deepStrictEqual(pinned, ['upper']);
});

test('خطای ۴۰۰ مربوط به Side تشخیص داده می‌شود', () => {
  const body = '{"errors":{"Order.Side":["سفارش معتبر نمیباشد"]}}';
  assert.strictEqual(order.isSideValidationError(400, body), true);
  assert.strictEqual(order.isSideValidationError(400, 'قیمت نامعتبر'), false);
  assert.strictEqual(order.isSideValidationError(503, body), false);
});

test('تعداد داخل بازه و قیمت روی گام قیمت می‌نشیند', () => {
  const r = order.normalizeQuantityAndPrice({
    quantity: 5, minQuantity: 10, maxQuantity: 100, price: 1007, priceStep: 10,
  });
  assert.strictEqual(r.quantity, 10);
  assert.strictEqual(r.price, 1010);

  const capped = order.normalizeQuantityAndPrice({ quantity: 500, maxQuantity: 100, price: 5, priceStep: 1 });
  assert.strictEqual(capped.quantity, 100);
});

// --- باگ ۳: شروع زودتر از ساعت هدف ---
test('شلیک دقیقاً preArmSeconds قبل از ساعت هدف شروع می‌شود', () => {
  const engine = new Engine();
  engine.updateSettings({ targetTime: '08:45:00', preArmSeconds: 60, clockOffsetMs: 0 });
  const now = engine.now();
  const gap = engine.targetTimestamp(now) - engine.fireStartTimestamp(now);
  assert.strictEqual(gap, 60000);
});

test('اختلاف ساعت سرور در محاسبهٔ لحظهٔ شلیک لحاظ می‌شود', () => {
  const engine = new Engine();
  engine.updateSettings({ targetTime: '08:45:00', preArmSeconds: 0, clockOffsetMs: 0 });
  const withoutOffset = engine.now().getTime();
  engine.updateSettings({ clockOffsetMs: 2500 });
  const withOffset = engine.now().getTime();
  assert.ok(withOffset - withoutOffset >= 2400, 'ساعت باید با offset جلو برود');
});

test('پاک‌کردن حافظه، جلسه را صفر و تنظیمات را حفظ می‌کند', () => {
  const engine = new Engine();
  engine.updateSettings({ isinOrSymbol: 'IRO1FOLD0001' });
  engine.session.attempts = 12;
  const status = engine.resetMemory({ session: true, learned: true });
  assert.strictEqual(status.session.attempts, 0);
  assert.strictEqual(status.learned.sideFormat, null);
  assert.strictEqual(status.settings.isinOrSymbol, 'IRO1FOLD0001');
});

test('بررسی، نبودِ آدرس و توکن را گزارش می‌کند', () => {
  const engine = new Engine();
  engine.updateSettings({ baseUrl: '', token: '', isinOrSymbol: 'X', quantity: 1, price: 10, side: 'buy' });
  const result = engine.validate();
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('آدرس')));
  assert.ok(result.problems.some((p) => p.includes('توکن')));
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
