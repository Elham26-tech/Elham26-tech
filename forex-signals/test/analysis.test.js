import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INSTRUMENTS, TIMEFRAMES } from '../lib/config.js';
import { DemoFeed } from '../lib/demo-feed.js';
import {
  analyze,
  classifyCandle,
  describe,
  findBase,
  findPivots,
  levelScore,
  mergeLevels,
  trackLevel,
} from '../lib/analysis.js';
import { atr } from '../lib/indicators.js';

let t0 = 1_700_000_000;
const bar = (open, high, low, close) => ({ time: (t0 += 3600), open, high, low, close, volume: 0 });
const flat = (n, level = 100) => Array.from({ length: n }, () => bar(level, level + 0.3, level - 0.1, level + 0.05));

test('candle classes follow the course bands against ATR', () => {
  assert.equal(classifyCandle(bar(0, 0.5, 0, 0.4), 1).size, 'spinning');
  assert.equal(classifyCandle(bar(0, 1, 0, 0.5), 1).size, 'standard');
  assert.equal(classifyCandle(bar(0, 2, 0, 1), 1).size, 'longbar');
  assert.equal(classifyCandle(bar(0, 3, 0, 1), 1).size, 'spike');
  assert.equal(classifyCandle(bar(0, 1, 0, 0.9), 1).master, 'body');
  assert.equal(classifyCandle(bar(0.95, 1, 0, 1), 1).master, 'lower-shadow');
  assert.equal(classifyCandle(bar(0.5, 0.6, 0.5, 0.5), 1).dir, 'flat');
});

test('ATR is Wilder-smoothed and null until its period fills', () => {
  const c = [bar(10, 11, 9, 10), bar(10, 12, 10, 11), bar(11, 12, 10, 11), bar(11, 13, 11, 12)];
  const a = atr(c, 2);
  assert.deepEqual(a.slice(0, 2), [null, null]);
  assert.equal(a[2], 2); // mean of TR[1]=2, TR[2]=2
  assert.equal(a[3], (2 * 1 + 2) / 2);
});

function pivotSeries() {
  return [
    ...flat(10),
    bar(100, 101.1, 99.9, 101), // three standard up candles…
    bar(101, 102.1, 100.9, 102),
    bar(102, 103.2, 101.9, 103), // …into the pivot high
    bar(103, 103.1, 102.2, 102.3), // 1.0 ATR back inside one candle
    bar(102.3, 102.5, 102, 102.2),
  ];
}

test('a pivot needs a three-candle leg and a 0.8 ATR reversal; its zone runs wick to body', () => {
  const c = pivotSeries();
  const highs = findPivots(c, c.map(() => 1)).filter((p) => p.kind === 'high');
  assert.equal(highs.length, 1);
  const p = highs[0];
  assert.equal(p.index, 12);
  assert.equal(p.speed, 'live');
  assert.equal(p.strongCandles, 3);
  assert.ok(p.reversal >= 0.8);
  // Wick 103.2 to body 103.0 = 0.2, inside the [0.2, 0.5] ATR clamp.
  assert.deepEqual(p.zone.map((x) => +x.toFixed(2)), [103, 103.2]);
});

test('no pivot without a big enough reversal', () => {
  const c = pivotSeries();
  c[13] = bar(103, 103.1, 102.7, 102.8); // only 0.5 back
  c[14] = bar(102.8, 103.1, 102.6, 102.7);
  const highs = findPivots(c, c.map(() => 1)).filter((p) => p.kind === 'high');
  assert.equal(highs.length, 0);
});

test('a level counts fresh touches and flips when a close breaks through', () => {
  const c = pivotSeries();
  const p = findPivots(c, c.map(() => 1)).find((x) => x.kind === 'high');
  c.push(bar(102.2, 103.05, 102.1, 102.4)); // touch 1
  c.push(bar(102.4, 102.6, 102.2, 102.3)); // away
  c.push(bar(102.3, 103.1, 102.2, 102.5)); // touch 2
  let l = trackLevel(c, p, '60');
  assert.equal(l.role, 'resistance');
  assert.equal(l.touches, 2);
  assert.equal(l.fresh, false);
  c.push(bar(102.5, 103.8, 102.4, 103.6)); // closes above the zone
  l = trackLevel(c, p, '60');
  assert.equal(l.role, 'support');
  assert.equal(l.flips, 1);
  assert.equal(l.touches, 0);
});

test('level value: higher timeframe and freshness score higher, a third touch and pullback pivots lower', () => {
  const base = { reversal: 1, touches: 0, flips: 0, speed: 'live', type: 'reverse' };
  assert.ok(levelScore({ ...base, tf: '1D' }) > levelScore({ ...base, tf: '60' }));
  assert.ok(levelScore({ ...base, tf: '240' }) > levelScore({ ...base, tf: '240', touches: 3 }));
  assert.ok(levelScore({ ...base, tf: '240' }) > levelScore({ ...base, tf: '240', type: 'pullback' }));
});

test('overlapping levels merge into the higher timeframe with confluence', () => {
  const mk = (tf, zone, score) => ({ tf, zone, score });
  const merged = mergeLevels([mk('60', [1.1, 1.102], 4), mk('240', [1.1015, 1.103], 5), mk('60', [1.2, 1.201], 4)], 0.0005);
  assert.equal(merged.length, 2);
  const host = merged.find((m) => m.tf === '240');
  assert.deepEqual(host.confluence, ['240', '60']);
  assert.equal(host.score, 5.5);
});

test('a base is three or more closes inside the mother candle', () => {
  const c = [...flat(5), bar(100, 105, 99, 104), bar(104, 104.5, 102, 103), bar(103, 104, 101, 101.5), bar(101.5, 103, 100.5, 102.5)];
  const b = findBase(c, 2);
  assert.equal(b.count, 3);
  assert.equal(b.high, 105);
  assert.equal(b.low, 99);
  c.push(bar(102.5, 106, 102, 105.5)); // a close above the mother ends it
  assert.equal(findBase(c, 2), null);
});

test('the full read on demo data has every role and a compact description', () => {
  const feed = new DemoFeed({ instruments: INSTRUMENTS, timeframes: TIMEFRAMES });
  for (const inst of INSTRUMENTS) {
    const snap = analyze(inst, feed);
    for (const role of ['structure', 'pattern', 'trigger', 'tolerance', 'context']) assert.ok(snap.atr[role] > 0, `${inst.id} ${role} ATR`);
    assert.ok(snap.atr.structure > snap.atr.pattern && snap.atr.pattern > snap.atr.trigger, 'ATR grows with timeframe');
    assert.ok(Math.abs(snap.thDaily - snap.price * 0.0066) < 1e-9);
    for (const l of snap.above) assert.ok(l.distance > 0);
    for (const l of snap.below) assert.ok(l.distance < 0);
    const d = describe(snap);
    assert.equal(d.instrument, inst.id);
    assert.equal(d.timeframes['60'].atrPeriod, 24);
    assert.ok(JSON.stringify(d).length < 40_000, 'prompt payload stays small');
  }
});
