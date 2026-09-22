import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';

import Anthropic from '@anthropic-ai/sdk';

import { aiSignal, AiError, buildRequest, SIGNAL_SCHEMA } from '../lib/ai.js';
import { INSTRUMENTS, TIMEFRAMES } from '../lib/config.js';
import { DemoFeed } from '../lib/demo-feed.js';
import { analyze, describe } from '../lib/analysis.js';

const MODEL_JSON = {
  action: 'BUY',
  order_type: 'market',
  entry: 1.085,
  stop_loss: 1.0842,
  take_profits: [1.0862, 1.0885],
  confidence: 64,
  setup: 'rtp',
  summary: 'خرید از حمایت ۴ساعته',
  reasoning: 'تست',
  checklist: [{ rule: 'قیمت روی زون', ok: true, note: '' }],
  invalidation: 'کلوز زیر زون',
  key_levels: [{ price: 1.0845, kind: 'support', timeframe: '240', note: '' }],
};

function sse(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

// Serves /v1/messages as a Messages API stream: a thinking block, then the
// JSON text, then the stop reason the test asks for.
function mockAnthropic({ stopReason = 'end_turn', text = JSON.stringify(MODEL_JSON) } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(
      sse([
        {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reading zones' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, 20) } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(20) } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 321 } },
        { type: 'message_stop' },
      ]),
    );
  });
  return { server, requests };
}

function fixtures() {
  const feed = new DemoFeed({ instruments: INSTRUMENTS, timeframes: TIMEFRAMES });
  const snap = analyze(INSTRUMENTS[0], feed);
  return { snap, desc: describe(snap) };
}

const cfg = { model: 'claude-opus-5', effort: 'high', fallbacks: true };

test('request: adaptive thinking, JSON schema output, refusal fallback, cached rulebook and tutorials', () => {
  const { desc } = fixtures();
  const tutorials = [
    { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'my rules' }, title: 'a.txt' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
  ];
  const req = buildRequest({ config: cfg, rulebook: 'RULES', tutorialBlocks: tutorials, desc, candidate: null, previous: null, dataSource: 'demo' });
  assert.equal(req.model, 'claude-opus-5');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.equal(req.output_config.effort, 'high');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.format.schema, SIGNAL_SCHEMA);
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.system[1].cache_control, { type: 'ephemeral' });
  assert.match(req.system[1].text, /RULES/);
  const content = req.messages[0].content;
  assert.deepEqual(content[2].cache_control, { type: 'ephemeral' }, 'breakpoint on the last tutorial block');
  assert.equal(content[1].cache_control, undefined);
  assert.equal(content.filter((b) => b.cache_control).length, 1);
  assert.match(content.at(-1).text, /"instrument":"EURUSD"/);
  assert.match(content.at(-1).text, /Data source: demo/);

  const off = buildRequest({ config: { ...cfg, fallbacks: false }, rulebook: 'R', desc, dataSource: 'tradingview' });
  assert.equal(off.betas, undefined);
  assert.equal(off.fallbacks, undefined);
  assert.equal(off.messages[0].content.length, 1, 'no tutorials, just the snapshot');
});

test('schema keeps to what structured outputs accept', () => {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const bad of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) {
      assert.equal(node[bad], undefined, `unsupported keyword ${bad}`);
    }
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    Object.values(node).forEach(walk);
  };
  walk(SIGNAL_SCHEMA);
});

test('streams through the SDK against a mock API and maps the JSON onto the signal', async () => {
  const { server, requests } = mockAnthropic();
  server.listen(0);
  await once(server, 'listening');
  const client = new Anthropic({ apiKey: 'test-key', baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
  try {
    const { desc } = fixtures();
    const req = buildRequest({ config: cfg, rulebook: 'R', desc, dataSource: 'demo' });
    const { raw, meta } = await aiSignal(client, req);
    assert.equal(raw.action, 'BUY');
    assert.equal(raw.stopLoss, 1.0842);
    assert.deepEqual(raw.takeProfits, [1.0862, 1.0885]);
    assert.equal(raw.keyLevels[0].timeframe, '240');
    assert.equal(meta.model, 'claude-opus-5');
    assert.equal(meta.usage.cacheRead, 4000);
    assert.equal(meta.usage.output, 321);

    const sent = requests[0];
    assert.match(sent.url, /^\/v1\/messages/);
    assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(sent.headers['x-api-key'], 'test-key');
    assert.equal(sent.body.stream, true);
    assert.equal(sent.body.fallbacks, 'default');
    assert.equal(sent.body.betas, undefined, 'betas travel as a header, not in the body');
  } finally {
    server.close();
  }
});

test('refusal and truncation surface as typed errors', async () => {
  for (const [stopReason, code] of [
    ['refusal', 'refusal'],
    ['max_tokens', 'max_tokens'],
  ]) {
    const { server } = mockAnthropic({ stopReason });
    server.listen(0);
    await once(server, 'listening');
    const client = new Anthropic({ apiKey: 'k', baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    try {
      const { desc } = fixtures();
      await assert.rejects(aiSignal(client, buildRequest({ config: cfg, rulebook: 'R', desc, dataSource: 'demo' })), (err) => err instanceof AiError && err.code === code);
    } finally {
      server.close();
    }
  }
});

test('non-JSON text is a bad_output error', async () => {
  const { server } = mockAnthropic({ text: 'not json at all' });
  server.listen(0);
  await once(server, 'listening');
  const client = new Anthropic({ apiKey: 'k', baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
  try {
    const { desc } = fixtures();
    await assert.rejects(aiSignal(client, buildRequest({ config: cfg, rulebook: 'R', desc, dataSource: 'demo' })), (err) => err.code === 'bad_output');
  } finally {
    server.close();
  }
});
