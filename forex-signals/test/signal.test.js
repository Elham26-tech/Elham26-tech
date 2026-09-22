import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INSTRUMENTS, TIMEFRAMES } from '../lib/config.js';
import { DemoFeed } from '../lib/demo-feed.js';
import { analyze } from '../lib/analysis.js';
import { ruleSignal } from '../lib/rules.js';
import { finalize } from '../lib/signal.js';

const snap = {
  instrument: { id: 'EURUSD', digits: 5, pip: 0.0001 },
  price: 1.1,
  atr: { trigger: 0.001 },
};

test('a buy with its stop above entry is downgraded to WAIT', () => {
  const s = finalize({ action: 'BUY', orderType: 'market', entry: 1.1, stopLoss: 1.101, takeProfits: [1.102] }, snap);
  assert.equal(s.action, 'WAIT');
  assert.equal(s.entry, null);
  assert.equal(s.warnings.length, 1);
});

test('targets on the wrong side are dropped and the rest sorted; R:R and pips computed', () => {
  const s = finalize({ action: 'BUY', orderType: 'market', entry: 1.1, stopLoss: 1.0992, takeProfits: [1.103, 1.099, 1.1016], confidence: 70 }, snap);
  assert.equal(s.action, 'BUY');
  assert.deepEqual(s.takeProfits, [1.1016, 1.103]);
  assert.deepEqual(s.riskReward, [2, 3.75]);
  assert.equal(s.stopPips, 8);
  assert.deepEqual(s.warnings, []);
});

test('a sell with no valid target becomes WAIT', () => {
  const s = finalize({ action: 'SELL', orderType: 'market', entry: 1.1, stopLoss: 1.1008, takeProfits: [1.105] }, snap);
  assert.equal(s.action, 'WAIT');
});

test('a stop wider than the trigger ATR is flagged', () => {
  const s = finalize({ action: 'SELL', orderType: 'market', entry: 1.1, stopLoss: 1.1015, takeProfits: [1.097] }, snap);
  assert.equal(s.action, 'SELL');
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /ATR/);
});

test('a "market" entry far from price is treated as a limit', () => {
  const s = finalize({ action: 'BUY', orderType: 'market', entry: 1.095, stopLoss: 1.0942, takeProfits: [1.098] }, snap);
  assert.equal(s.orderType, 'limit');
});

test('confidence is clamped and WAIT carries no prices', () => {
  const s = finalize({ action: 'WAIT', entry: 1.1, stopLoss: 1, takeProfits: [2], confidence: 250 }, snap);
  assert.equal(s.confidence, 100);
  assert.equal(s.entry, null);
  assert.deepEqual(s.takeProfits, []);
});

test('rule signals are well-formed across demo history, and actionable ones respect the stop cap', () => {
  const feed = new DemoFeed({ instruments: INSTRUMENTS, timeframes: TIMEFRAMES });
  for (const inst of INSTRUMENTS) {
    const full = Object.fromEntries(TIMEFRAMES.map((t) => [t.id, feed.getCandles(inst.id, t.id).slice()]));
    const c15 = full['15'];
    for (let cut = c15.length - 1; cut > 150; cut -= 4) {
      const t = c15[cut].time;
      const view = { getCandles: (id, tf) => full[tf].filter((c) => c.time <= t) };
      const s = analyze(inst, view);
      const sig = finalize(ruleSignal(s), s);
      assert.ok(['BUY', 'SELL', 'WAIT'].includes(sig.action));
      assert.ok(sig.summary.length > 0);
      if (sig.action === 'WAIT') continue;
      const dir = sig.action === 'BUY' ? 1 : -1;
      assert.ok((sig.entry - sig.stopLoss) * dir > 0);
      assert.ok(sig.takeProfits.every((tp) => (tp - sig.entry) * dir > 0));
      assert.ok(Math.abs(sig.entry - sig.stopLoss) <= s.atr.trigger * 1.0001 + inst.pip, 'stop within one trigger ATR');
      assert.ok(sig.riskReward[0] >= 0.99, 'first target at least 1R');
    }
  }
});
