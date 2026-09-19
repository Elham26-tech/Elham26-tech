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
  if (req.url.startsWith('/api/instrument')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ instrument: {
      isin: new URL(req.url, 'http://x').searchParams.get('isin'),
      maxAllowedPrice: 10941, minAllowedPrice: 9899,
      maxOrderQuantity: 200000, minOrderQuantity: 10, tickSize: 1, closingPrice: 10420,
    } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>کارگزاری قلابی</title>
  <script>
  window.openInstrument = (isin) => fetch('/api/instrument?isin=' + isin + '&lang=fa').then(r => r.json());
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

  if (!engine.browser.sessionFor('http://127.0.0.1:8899/')) return fail('هیچ نشست صفحه‌ای ثبت نشد');
  ok('نشست صفحه ثبت شد');

  // منتظر می‌مانیم تا صفحهٔ کارگزاری واقعاً بالا بیاید؛ خوابِ ثابت روی
  // ماشین کُند جواب نمی‌دهد و تست را بی‌دلیل قرمز می‌کند.
  const ready = async () => {
    for (let i = 0; i < 60; i += 1) {
      try {
        const probe = await engine.browser.send('Runtime.evaluate', {
          expression: 'typeof window.openInstrument === "function"', returnByValue: true,
        }, engine.browser.sessionFor('http://127.0.0.1:8899/'));
        if (probe.result && probe.result.value === true) return true;
      } catch { /* هنوز آماده نیست */ }
      await wait(250);
    }
    return false;
  };
  if (!await ready()) return fail('صفحهٔ کارگزاری قلابی بالا نیامد');
  ok('صفحهٔ کارگزاری بالا آمد');

  // کاربر داخل ایزی‌تریدر یک نماد را باز می‌کند → مسیر اطلاعات نماد یاد گرفته می‌شود
  await engine.browser.send('Runtime.evaluate', {
    expression: "window.openInstrument('IRO3LABN0001')", awaitPromise: true, returnByValue: true,
  }, engine.browser.sessionFor('http://127.0.0.1:8899/'));
  await wait(600);
  if (!engine.status().hasInstrumentEndpoint) return fail('مسیر اطلاعات نماد یاد گرفته نشد');
  ok('مسیر اطلاعات نماد یاد گرفته شد');

  // حالا سقف/کف نمادِ دیگری را از خودِ کارگزار می‌پرسد
  const picked = await engine.selectSymbol({ isin: 'IRO1FOLD0001', symbol: 'فولاد', name: 'فولاد مباركه', yesterday: 24800 });
  if (!picked.ok) return fail('انتخاب نماد ناموفق');
  const inst = picked.instrument;
  if (inst.estimated) return fail('باید از کارگزاری گرفته می‌شد، نه تخمین');
  if (inst.priceMax !== 10941 || inst.priceMin !== 9899) return fail('سقف/کف اشتباه: ' + JSON.stringify(inst));
  if (inst.maxQuantity !== 200000 || inst.minQuantity !== 10) return fail('تعداد مجاز اشتباه');
  ok('سقف/کف و تعداد مجاز از خودِ کارگزار گرفته شد (بدون تخمین)');

  // کاربر یک بار دستی سفارش می‌زند
  await engine.browser.send('Runtime.evaluate', {
    expression: 'window.placeOrder()', awaitPromise: true, returnByValue: true,
  }, engine.browser.sessionFor('http://127.0.0.1:8899/'));
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

  // قیمت «سقف مجاز» باید همان عددِ کارگزاری باشد
  engine.updateSettings({ priceMode: 'max' });
  if (engine.effectivePrice() !== 10941) return fail('حالت سقف مجاز، قیمت کارگزاری را برنداشت');
  ok('حالت «سقف مجاز» قیمت را از کارگزاری برمی‌دارد');
  engine.updateSettings({ priceMode: 'manual' });

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
