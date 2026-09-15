'use strict';
// تمرین کامل: کارگزاری قلابی + کروم واقعی + یادگیری + تکرار سفارش
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SARKHATI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sarkhati-e2e-'));
const { Engine } = require('../lib/engine');

const received = [];
const broker = http.createServer((req, res) => {
  if (req.url === '/api/Order/Create' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      received.push({ body: JSON.parse(raw), auth: req.headers.authorization });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ orderId: 55500 + received.length }));
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>کارگزاری قلابی</title>
  <script>
  window.placeOrder = () => fetch('/api/Order/Create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer user-token' },
    body: JSON.stringify({ order: { isin: 'IRO1FOLD0001', side: 'Buy', quantity: 100, price: 25000 } })
  }).then(r => r.json());
  </script>`);
});

const fail = (msg) => { console.log('FAIL ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok   ' + msg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => broker.listen(8899, '127.0.0.1', r));
  const engine = new Engine();
  engine.updateSettings({ easyTraderUrl: 'http://127.0.0.1:8899/' });

  const opened = await engine.openEasyTrader();
  if (!opened.ok) return fail('کروم باز نشد: ' + opened.error);
  ok('کروم باز شد و DevTools وصل شد');
  await wait(2500);

  if (!engine.browser.anySession()) return fail('هیچ نشست صفحه‌ای ثبت نشد');
  ok('نشست صفحه ثبت شد');

  // کاربر یک بار دستی سفارش می‌زند
  await engine.browser.send('Runtime.evaluate', {
    expression: 'window.placeOrder()', awaitPromise: true, returnByValue: true,
  }, engine.browser.anySession());
  await wait(800);

  const learned = engine.status().recipe;
  if (!learned) return fail('سفارش دستی یاد گرفته نشد');
  ok('سفارش دستی یاد گرفته شد: ' + learned.label);
  if (learned.side !== 'Buy') return fail('مقدار Side اشتباه یاد گرفته شد');
  ok('مقدار Side درست ضبط شد');

  // حالا با تعداد و قیمت جدید تکرار می‌شود
  engine.updateSettings({ quantity: 300, price: 26500 });
  await engine.fireNow();
  await wait(500);

  if (received.length !== 2) return fail('سفارش تکرارشده به کارگزاری نرسید');
  const replayed = received[1];
  if (replayed.body.order.quantity !== 300) return fail('تعداد اعمال نشد');
  if (replayed.body.order.price !== 26500) return fail('قیمت اعمال نشد');
  if (replayed.body.order.side !== 'Buy') return fail('Side موقع تکرار خراب شد');
  if (replayed.auth !== 'Bearer user-token') return fail('توکن نشست منتقل نشد');
  ok('سفارش با تعداد/قیمت جدید و همان Side و توکن واقعی تکرار شد');

  if (!engine.status().session.accepted) return fail('پذیرش ثبت نشد');
  ok('پاسخ پذیرفته‌شده ثبت شد');

  // مسلح‌سازی با pre-arm
  const now = engine.now();
  const t = new Date(now.getTime() + 5000);
  engine.updateSettings({
    targetTime: `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`,
    preArmSeconds: 3, stopAfterSeconds: 1, sendRate: 4,
  });
  const before = received.length;
  engine.arm();
  await wait(2800);
  if (received.length <= before) return fail('شلیک زودهنگام شروع نشد');
  ok(`شلیک ${engine.settings.preArmSeconds} ثانیه زودتر از ساعت هدف شروع شد`);

  engine.disarm();
  engine.browser.close();
  broker.close();
  fs.rmSync(process.env.SARKHATI_DATA_DIR, { recursive: true, force: true });
  console.log('\nتمرین کامل انجام شد.');
  process.exit(process.exitCode || 0);
})().catch((err) => { console.log('FAIL ' + err.stack); process.exit(1); });
