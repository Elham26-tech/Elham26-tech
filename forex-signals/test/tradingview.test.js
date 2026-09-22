import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { WebSocketServer } from 'ws';

import { decodeFrame, encodePacket, mergeCandles, toCandle, TradingViewFeed } from '../lib/tradingview.js';

const INST = [{ id: 'EURUSD', tvSymbol: 'OANDA:EURUSD' }];
const TFS = [
  { id: '60', bars: 5 },
  { id: '240', bars: 5 },
];

test('frames: encode, decode several packets and heartbeats', () => {
  const frame = encodePacket({ m: 'a', p: [1] }) + encodePacket('~h~7') + encodePacket({ m: 'b', p: [] });
  assert.deepEqual(decodeFrame(frame), [{ m: 'a', p: [1] }, { heartbeat: '~h~7' }, { m: 'b', p: [] }]);
  assert.equal(encodePacket('~h~7'), '~m~4~m~~h~7');
  assert.deepEqual(decodeFrame('~m~5~m~{bad}'), []);
});

test('bars: parse, then merge by time with a cap', () => {
  assert.equal(toCandle({ v: [1, 2, 3] }), null);
  assert.deepEqual(toCandle({ i: 0, v: [100, 1, 2, 0.5, 1.5] }), { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 });
  const a = [100, 200, 300].map((t) => ({ time: t, close: t }));
  const merged = mergeCandles(a, [{ time: 300, close: 301 }, { time: 400, close: 400 }], 3);
  assert.deepEqual(merged.map((c) => [c.time, c.close]), [[200, 200], [300, 301], [400, 400]]);
});

// A stand-in for TradingView's chart socket that speaks just enough of the
// protocol: it answers every create_series with history and remembers sessions.
function mockServer() {
  const wss = new WebSocketServer({ port: 0 });
  const state = { sockets: [], sessions: new Map(), received: [], origin: null, heartbeatEcho: null };
  wss.on('connection', (ws, req) => {
    state.origin = req.headers.origin;
    state.sockets.push(ws);
    ws.send(encodePacket({ session_id: 'x', timestamp: 1 }));
    ws.send(encodePacket('~h~1'));
    ws.on('message', (data) => {
      for (const p of decodeFrame(data.toString())) {
        if (p.heartbeat) {
          state.heartbeatEcho = p.heartbeat;
          continue;
        }
        state.received.push(p);
        if (p.m === 'resolve_symbol') state.sessions.set(p.p[0], { symbol: p.p[2] });
        if (p.m === 'create_series') {
          const [cs, , , , tf] = p.p;
          state.sessions.get(cs).tf = tf;
          if (tf === '240' && state.failSymbol) {
            ws.send(encodePacket({ m: 'symbol_error', p: [cs, 'sds_sym_1', 'invalid symbol'] }));
            continue;
          }
          const s = [0, 1, 2].map((i) => ({ i, v: [1000 + i * 60, 1 + i, 2 + i, 0.5 + i, 1.5 + i, 10] }));
          ws.send(encodePacket({ m: 'timescale_update', p: [cs, { sds_1: { s } }] }));
        }
      }
    });
  });
  return { wss, state, url: () => `ws://127.0.0.1:${wss.address().port}` };
}

async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
}

test('feed opens one chart session per instrument × timeframe and loads history', async () => {
  const srv = mockServer();
  await once(srv.wss, 'listening');
  const feed = new TradingViewFeed({ url: srv.url(), origin: 'https://www.tradingview.com', authToken: 'tok', instruments: INST, timeframes: TFS });
  feed.start();
  try {
    await until(() => feed.getCandles('EURUSD', '60').length === 3 && feed.getCandles('EURUSD', '240').length === 3);
    assert.equal(srv.state.origin, 'https://www.tradingview.com');
    assert.deepEqual(srv.state.received[0], { m: 'set_auth_token', p: ['tok'] });
    const series = srv.state.received.filter((p) => p.m === 'create_series');
    assert.deepEqual(series.map((p) => p.p[4]).sort(), ['240', '60']);
    assert.ok(series.every((p) => p.p[5] === 5), 'asks for the configured bar count');
    const symbols = [...srv.state.sessions.values()].map((s) => JSON.parse(s.symbol.slice(1)).symbol);
    assert.deepEqual([...new Set(symbols)], ['OANDA:EURUSD']);
    assert.equal(srv.state.heartbeatEcho, '~h~1');
    assert.equal(feed.getStatus()['EURUSD:60'].status, 'live');

    // A tick on the forming bar replaces it; a new bar appends and the cap holds.
    const [cs] = [...srv.state.sessions.entries()].find(([, s]) => s.tf === '60');
    const ws = srv.state.sockets[0];
    ws.send(encodePacket({ m: 'du', p: [cs, { sds_1: { s: [{ i: 2, v: [1120, 3, 4, 2.5, 3.9, 11] }] } }] }));
    await until(() => feed.getCandles('EURUSD', '60')[2].close === 3.9);
    ws.send(encodePacket({ m: 'du', p: [cs, { sds_1: { s: [1180, 1240, 1300].map((t) => ({ v: [t, 4, 5, 3, 4.5] })) } }] }));
    await until(() => feed.getCandles('EURUSD', '60').at(-1).time === 1300);
    assert.equal(feed.getCandles('EURUSD', '60').length, 5);
  } finally {
    feed.stop();
    srv.wss.close();
  }
});

test('a symbol error marks only that series, and a dropped socket reconnects', async () => {
  const srv = mockServer();
  srv.state.failSymbol = true;
  await once(srv.wss, 'listening');
  const feed = new TradingViewFeed({ url: srv.url(), origin: 'o', authToken: 't', instruments: INST, timeframes: TFS });
  const logs = [];
  feed.on('log', (m) => logs.push(m));
  feed.start();
  try {
    await until(() => feed.getStatus()['EURUSD:240'].status === 'error' && feed.getCandles('EURUSD', '60').length === 3);
    assert.match(feed.getStatus()['EURUSD:240'].error, /invalid symbol/);
    assert.equal(feed.getStatus()['EURUSD:60'].status, 'live');

    srv.state.failSymbol = false;
    srv.state.sockets[0].terminate();
    await until(() => srv.state.sockets.length === 2, 4000);
    await until(() => feed.getStatus()['EURUSD:240'].status === 'live');
    assert.ok(logs.some((m) => /reconnecting/.test(m)));
  } finally {
    feed.stop();
    srv.wss.close();
  }
});
