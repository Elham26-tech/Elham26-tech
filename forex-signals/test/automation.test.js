import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { config, INSTRUMENTS, TIMEFRAMES } from '../lib/config.js';
import { DemoFeed } from '../lib/demo-feed.js';
import { createNotifier, formatSignal } from '../lib/notify.js';
import { createApp, instrumentForTicker } from '../server.js';

let app;
let base;
let dataDir;
const notified = [];

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fx-auto-'));
  const cfg = {
    ...config,
    dataDir,
    appUser: 'u',
    appPassword: 'p',
    port: 0,
    host: '127.0.0.1',
    minAnalyzeSeconds: 0,
    autoMode: 'off',
    webhookSecret: 's3cret',
    dataSource: 'demo',
  };
  app = await createApp({
    cfg,
    feed: new DemoFeed({ instruments: INSTRUMENTS, timeframes: TIMEFRAMES }),
    client: null,
    log: () => {},
    notifier: async (signal, inst) => notified.push({ signal, inst }),
  });
  base = `http://127.0.0.1:${(await app.start()).port}`;
});

after(async () => {
  await app.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
}

test('TradingView tickers map onto the three instruments', () => {
  assert.equal(instrumentForTicker('OANDA:EURUSD').id, 'EURUSD');
  assert.equal(instrumentForTicker('TVC:GOLD').id, 'XAUUSD');
  assert.equal(instrumentForTicker('xauusd.m').id, 'XAUUSD');
  assert.equal(instrumentForTicker('FX:GBPJPY').id, 'GBPJPY');
  assert.equal(instrumentForTicker('BINANCE:BTCUSDT'), null);
  assert.equal(instrumentForTicker(undefined), null);
});

test('the webhook needs its secret, not the page password', async () => {
  const post = (qs, body) => fetch(`${base}/api/webhook/tradingview${qs}`, { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await post('', { symbol: 'EURUSD' })).status, 401);
  assert.equal((await post('?token=nope', { symbol: 'EURUSD' })).status, 401);
  assert.equal((await post('?token=s3cret', { symbol: 'DOGEUSD' })).status, 400);
});

test('a TradingView alert runs an analysis in the background and pushes it', async () => {
  const before = app.store.list({ instrument: 'XAUUSD' }).length;
  const res = await fetch(`${base}/api/webhook/tradingview`, {
    method: 'POST',
    body: JSON.stringify({ token: 's3cret', symbol: 'OANDA:XAUUSD', action: 'BUY', price: 2650 }),
  });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { accepted: true, instrument: 'XAUUSD' });
  await until(() => app.store.list({ instrument: 'XAUUSD' }).length === before + 1);
  const s = app.store.latest('XAUUSD');
  assert.equal(s.trigger, 'tradingview');
  await until(() => notified.some((n) => n.signal.id === s.id && n.inst.id === 'XAUUSD'));

  // A plain-text alert body works too.
  const plain = await fetch(`${base}/api/webhook/tradingview?token=s3cret`, { method: 'POST', body: 'KPA SELL GBPJPY 192.5' });
  assert.equal(plain.status, 202);
  assert.equal((await plain.json()).instrument, 'GBPJPY');
});

test('smart mode looks once per closed trigger candle', async () => {
  const count = () => app.store.list({ limit: 500 }).length;
  const n0 = count();
  await app.smartTick();
  const n1 = count();
  assert.ok(n1 - n0 <= INSTRUMENTS.length);
  for (const s of app.store.list({ limit: n1 - n0 })) assert.equal(s.trigger, 'auto');
  await app.smartTick();
  assert.equal(count(), n1, 'same candle, no second run');
});

const inst = { id: 'EURUSD', nameEn: 'EUR/USD', digits: 5 };
const buy = {
  action: 'BUY',
  orderType: 'market',
  entry: 1.085,
  stopLoss: 1.0842,
  takeProfits: [1.0862, 1.0885],
  stopPips: 8,
  riskReward: [1.5, 4.38],
  setup: 'rtp',
  confidence: 64,
  source: 'ai',
  summary: 'خرید از حمایت',
  invalidation: 'کلوز زیر زون',
  warnings: [],
  dataSource: 'tradingview',
};

test('Telegram message carries the whole trade', () => {
  const text = formatSignal(buy, inst);
  assert.match(text, /خرید EUR\/USD \(مارکت\)/);
  assert.match(text, /ورود 1\.08500 \| حد ضرر 1\.08420 \(8 pip\)/);
  assert.match(text, /1\.08620 \(1\.5R\) \/ 1\.08850 \(4\.38R\)/);
  assert.doesNotMatch(text, /نمایشی/);
  assert.match(formatSignal({ ...buy, dataSource: 'demo' }, inst), /نمایشی/);
});

test('notifier posts to the bot, skips WAIT in actionable mode, and is off without credentials', async () => {
  assert.equal(createNotifier({ token: '', chatId: '1' }), null);
  assert.equal(createNotifier({ token: 't', chatId: '1', mode: 'off' }), null);
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true };
  };
  const notify = createNotifier({ token: 'T0K', chatId: '42', fetchImpl, log: () => {} });
  assert.equal(await notify(buy, inst), true);
  assert.equal(await notify({ ...buy, action: 'WAIT' }, inst), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/botT0K/sendMessage');
  assert.equal(calls[0].body.chat_id, '42');
  const all = createNotifier({ token: 'T0K', chatId: '42', mode: 'all', fetchImpl, log: () => {} });
  await all({ ...buy, action: 'WAIT', takeProfits: [], riskReward: [], price: 1.085 }, inst);
  assert.equal(calls.length, 2);
  const failing = createNotifier({ token: 'x', chatId: '1', fetchImpl: async () => { throw new Error('down'); }, log: () => {} });
  assert.equal(await failing(buy, inst), false, 'a network error never throws');
});
