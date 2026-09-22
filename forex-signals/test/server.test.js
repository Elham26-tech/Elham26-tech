import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { config, INSTRUMENTS, TIMEFRAMES } from '../lib/config.js';
import { DemoFeed } from '../lib/demo-feed.js';
import { createApp } from '../server.js';

let app;
let base;
let dataDir;
const auth = { Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` };
let aiCalls = [];
let aiReply = null;

// Stands in for the Anthropic client: returns whatever the test queues.
const stubClient = {
  beta: {
    messages: {
      stream(request) {
        aiCalls.push(request);
        return {
          finalMessage: async () => {
            if (aiReply instanceof Error) throw aiReply;
            return {
              model: 'claude-opus-5',
              stop_reason: 'end_turn',
              content: [
                { type: 'thinking', thinking: '…', signature: 's' },
                { type: 'text', text: JSON.stringify(aiReply) },
              ],
              usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            };
          },
        };
      },
    },
  },
};

async function call(method, url, { body, headers = {}, raw = false } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...auth, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (static files)
  }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fx-signals-'));
  const cfg = { ...config, dataDir, appUser: 'u', appPassword: 'p', port: 0, host: '127.0.0.1', minAnalyzeSeconds: 30, autoAnalyzeMinutes: 0, dataSource: 'demo' };
  app = await createApp({ cfg, feed: new DemoFeed({ instruments: INSTRUMENTS, timeframes: TIMEFRAMES }), client: stubClient, log: () => {} });
  const addr = await app.start();
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('everything but the health check needs the password', async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  for (const url of ['/', '/api/state', '/api/config']) assert.equal((await fetch(base + url)).status, 401);
  const wrong = await fetch(`${base}/api/state`, { headers: { Authorization: `Basic ${Buffer.from('u:x').toString('base64')}` } });
  assert.equal(wrong.status, 401);
  const page = await call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /dir="rtl"/);
  assert.equal((await call('GET', '/..%2Fpackage.json')).status, 404);
});

test('config and state describe the three instruments', async () => {
  const c = await call('GET', '/api/config');
  assert.deepEqual(c.json.instruments.map((i) => i.id), ['EURUSD', 'XAUUSD', 'GBPJPY']);
  assert.equal(c.json.dataSource, 'demo');
  assert.equal(c.json.ai.enabled, true);
  assert.equal(c.json.ai.fallbacks, true);
  const s = await call('GET', '/api/state');
  for (const i of s.json.instruments) {
    assert.ok(i.price > 0);
    assert.equal(Object.keys(i.status).length, TIMEFRAMES.length);
  }
});

test('analysis and candles endpoints', async () => {
  const a = await call('GET', '/api/analysis/XAUUSD');
  assert.equal(a.status, 200);
  assert.equal(a.json.read.instrument, 'XAUUSD');
  assert.ok(['BUY', 'SELL', 'WAIT'].includes(a.json.rules.action));
  const c = await call('GET', '/api/candles/GBPJPY/240?limit=50');
  assert.equal(c.json.candles.length, 50);
  assert.equal(c.json.digits, 3);
  assert.ok(Array.isArray(c.json.zones));
  assert.equal((await call('GET', '/api/candles/GBPJPY/7')).status, 404);
  assert.equal((await call('GET', '/api/analysis/BTCUSD')).status, 404);
});

test('analyze runs the AI once, validates its levels, stores it, and rate-limits', async () => {
  const price = (await call('GET', '/api/state')).json.instruments.find((i) => i.id === 'EURUSD').price;
  aiReply = {
    action: 'BUY',
    order_type: 'market',
    entry: price,
    stop_loss: price - 0.0008,
    take_profits: [price + 0.002, price - 0.001],
    confidence: 70,
    setup: 'rtp',
    summary: 'خرید',
    reasoning: 'r',
    checklist: [],
    invalidation: 'i',
    key_levels: [],
  };
  const r = await call('POST', '/api/analyze/EURUSD');
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'ai');
  assert.equal(r.json.action, 'BUY');
  assert.equal(r.json.takeProfits.length, 1, 'the target below a buy entry is dropped');
  assert.equal(aiCalls.length, 1);
  assert.match(aiCalls[0].system[1].text, /خاکستر/, 'the built-in course rulebook is sent');

  const again = await call('POST', '/api/analyze/EURUSD');
  assert.equal(again.status, 429);
  assert.ok(again.json.retryAfter > 0);
  assert.equal(aiCalls.length, 1);

  const list = await call('GET', '/api/signals?instrument=EURUSD');
  assert.equal(list.json[0].id, r.json.id);
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'signals.json'), 'utf8'));
  assert.equal(saved[0].id, r.json.id);
});

test('an AI failure falls back to the rule engine with a warning', async () => {
  aiReply = new Error('overloaded');
  const r = await call('POST', '/api/analyze/GBPJPY');
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'rules');
  assert.ok(r.json.warnings.some((w) => /overloaded/.test(w)));
});

test('rulebook: edit, then reset to the built-in course text', async () => {
  const k = await call('GET', '/api/knowledge');
  assert.equal(k.json.rulebook.custom, false);
  const put = await call('PUT', '/api/knowledge/rulebook', { body: { text: 'قاعده‌ی من' } });
  assert.equal(put.json.custom, true);
  assert.equal((await call('GET', '/api/knowledge')).json.rulebook.text, 'قاعده‌ی من');
  const reset = await call('PUT', '/api/knowledge/rulebook', { body: { text: '' } });
  assert.equal(reset.json.custom, false);
  assert.match(reset.json.text, /ATR/);
});

test('tutorials: upload text and images, toggle, reject unknown types, delete', async () => {
  const txt = await call('POST', '/api/tutorials', { body: 'درس اول: ATR', raw: true, headers: { 'x-file-name': encodeURIComponent('درس ۱.md') } });
  assert.equal(txt.status, 201);
  assert.equal(txt.json.kind, 'text');
  assert.equal(txt.json.name, 'درس ۱.md');
  assert.equal(txt.json.active, true);

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const img = await call('POST', '/api/tutorials', { body: png, raw: true, headers: { 'x-file-name': 'chart.png' } });
  assert.equal(img.json.kind, 'image');

  const bad = await call('POST', '/api/tutorials', { body: 'x', raw: true, headers: { 'x-file-name': 'virus.exe' } });
  assert.equal(bad.status, 400);
  const fakePdf = await call('POST', '/api/tutorials', { body: 'hello', raw: true, headers: { 'x-file-name': 'a.pdf' } });
  assert.equal(fakePdf.status, 400);

  const blocks = await app.knowledge.blocks();
  assert.equal(blocks[0].type, 'document');
  assert.equal(blocks[0].source.data, 'درس اول: ATR');
  assert.ok(blocks.some((b) => b.type === 'image' && b.source.media_type === 'image/png'));

  const off = await call('PATCH', `/api/tutorials/${txt.json.id}`, { body: { active: false } });
  assert.equal(off.json.active, false);
  assert.equal((await app.knowledge.blocks()).filter((b) => b.type === 'document').length, 0);

  assert.equal((await call('DELETE', `/api/tutorials/${txt.json.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/tutorials/${txt.json.id}`)).status, 404);
  const list = await call('GET', '/api/knowledge');
  assert.deepEqual(list.json.tutorials.map((t) => t.name), ['chart.png']);
});

test('the event stream pushes prices', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/stream`, { headers: auth, signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader();
  let text = '';
  const deadline = Date.now() + 3000;
  while (!text.includes('event: prices') && Date.now() < deadline) {
    const { value } = await reader.read();
    text += Buffer.from(value).toString('utf8');
  }
  controller.abort();
  assert.match(text, /event: prices\ndata: \{"EURUSD"/);
});
