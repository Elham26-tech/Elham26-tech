// The market read both signal engines work from, in the terms of Saeed
// Khakestar's price-action course (see knowledge/rulebook.md): ATR as the
// movement step, TH as movement power, candle classes, pivots and their zones,
// level value, bases and breakouts — per timeframe and across the fractal
// roles (structure / pattern / trigger / tolerance).

import { ROLES, TIMEFRAMES } from './config.js';
import { atr, structure, swings } from './indicators.js';

// TH: a pair's daily movement power is about 0.66% of its current price.
export const TH_DAILY = 0.0066;

const TF_WEIGHT = { 15: 1, 60: 2, 240: 3, '1D': 4, W: 5 };

export function round(x, digits) {
  return x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(digits));
}

function dirOf(c) {
  if (c.close > c.open) return 'up';
  if (c.close < c.open) return 'down';
  return 'flat';
}

// Candle class by its range against the timeframe's ATR: spinning under 80%,
// standard 80–120%, longbar 120–250%, spike above 250%. A master candle is
// 80% body, or 80% one shadow.
export function classifyCandle(c, a) {
  const range = c.high - c.low;
  const ratio = a > 0 ? range / a : 0;
  let size = 'spinning';
  if (ratio > 2.5) size = 'spike';
  else if (ratio > 1.2) size = 'longbar';
  else if (ratio >= 0.8) size = 'standard';
  const body = Math.abs(c.close - c.open);
  const upper = c.high - Math.max(c.open, c.close);
  const lower = Math.min(c.open, c.close) - c.low;
  let master = null;
  if (range > 0) {
    if (body / range >= 0.8) master = 'body';
    else if (upper / range >= 0.8) master = 'upper-shadow';
    else if (lower / range >= 0.8) master = 'lower-shadow';
  }
  return {
    time: c.time,
    dir: dirOf(c),
    size,
    atrRatio: round(ratio, 2),
    bodyShare: range > 0 ? round(body / range, 2) : 0,
    master,
  };
}

// A pivot: a move of at least three standard candles one way (or 2.5 ATR in
// total), then a reversal of at least 0.8 ATR before price goes beyond the
// extreme. A reversal within two candles is a live, tradeable pivot; a slower
// one still leaves a level, a weaker one.
function pivotAt(candles, i, a, kind, lookback) {
  const up = kind === 'high';
  const ext = (b) => (up ? b.high : b.low);
  const beyond = (x, y) => (up ? x > y : x < y);
  const c = candles[i];
  const px = ext(c);
  // The first bar to print this extreme; an equal extreme two bars later is
  // the same pivot tested, not a new one.
  for (let k = Math.max(0, i - 2); k < i; k++) if (!beyond(px, ext(candles[k]))) return null;

  // The leg into the pivot runs back to the opposite extreme, stopping at any
  // bar that went beyond the pivot.
  let startIdx = i;
  let start = up ? c.low : c.high;
  for (let k = i - 1; k >= Math.max(0, i - lookback); k--) {
    const b = candles[k];
    if (beyond(ext(b), px)) break;
    const opp = up ? b.low : b.high;
    if (beyond(start, opp)) {
      start = opp;
      startIdx = k;
    }
  }
  let strong = 0;
  let lastWithLeg = null;
  for (let k = startIdx; k <= i; k++) {
    const b = candles[k];
    if (dirOf(b) === (up ? 'up' : 'down')) {
      lastWithLeg = b;
      if (b.high - b.low >= 0.8 * a) strong++;
    }
  }
  const move = Math.abs(px - start);
  if (strong < 3 && move < 2.5 * a) return null;

  let confirmedIndex = -1;
  let engulfed = false;
  for (let k = i + 1; k < Math.min(candles.length, i + 7); k++) {
    const b = candles[k];
    if (beyond(ext(b), px)) return null;
    if (lastWithLeg && (up ? b.close < lastWithLeg.open : b.close > lastWithLeg.open)) engulfed = true;
    const back = up ? px - b.low : b.high - px;
    if (back >= 0.8 * a) {
      confirmedIndex = k;
      break;
    }
  }
  if (confirmedIndex < 0) return null;

  // Zone: from the wick tip to the body edge, kept between the tolerance
  // (20% ATR) and half an ATR.
  const bodyEdge = up ? Math.max(c.open, c.close) : Math.min(c.open, c.close);
  const depth = Math.min(Math.max(Math.abs(px - bodyEdge), 0.2 * a), 0.5 * a);
  const back = up ? px - Math.min(...candles.slice(i + 1, confirmedIndex + 1).map((b) => b.low))
    : Math.max(...candles.slice(i + 1, confirmedIndex + 1).map((b) => b.high)) - px;
  return {
    kind,
    index: i,
    time: c.time,
    price: px,
    zone: up ? [px - depth, px] : [px, px + depth],
    atr: a,
    move: move / a,
    strongCandles: strong,
    reversal: back / a,
    speed: confirmedIndex - i <= 2 ? 'live' : 'slow',
    engulfed,
    confirmedIndex,
    confirmedTime: candles[confirmedIndex].time,
  };
}

export function findPivots(candles, atrs, { lookback = 12 } = {}) {
  const out = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const a = atrs[i];
    if (!a) continue;
    for (const kind of ['high', 'low']) {
      const p = pivotAt(candles, i, a, kind, lookback);
      if (p) out.push(p);
    }
  }
  return out;
}

// Follows a pivot's zone forward: each fresh entry into the zone is a touch,
// a close through the far edge breaks it and the level flips role.
export function trackLevel(candles, p, tf) {
  const [lo, hi] = p.zone;
  let role = p.kind === 'high' ? 'resistance' : 'support';
  let touches = 0;
  let flips = 0;
  let inside = false;
  let lastTouchTime = null;
  let flipTime = null;
  for (let k = p.confirmedIndex + 1; k < candles.length; k++) {
    const b = candles[k];
    if ((role === 'resistance' && b.close > hi) || (role === 'support' && b.close < lo)) {
      role = role === 'resistance' ? 'support' : 'resistance';
      flips++;
      if (flipTime === null) flipTime = b.time;
      touches = 0;
      inside = true;
      continue;
    }
    const enters = b.high >= lo && b.low <= hi;
    if (enters && !inside) {
      touches++;
      lastTouchTime = b.time;
    }
    inside = enters;
  }
  const level = {
    tf,
    role,
    zone: [lo, hi],
    price: p.price,
    time: p.time,
    confirmedTime: p.confirmedTime,
    touches,
    flips,
    fresh: touches === 0 && flips === 0,
    speed: p.speed,
    type: p.type || 'reverse',
    reversal: p.reversal,
    move: p.move,
    lastTouchTime,
    flipTime,
  };
  level.score = levelScore(level);
  return level;
}

// Level value: a higher timeframe wins; fresh levels hold best and by the
// third touch a break is the thing to expect; a sharp departure and a single
// flip add weight; a level broken back and forth is spent, and one left by a
// pullback pivot is usually broken.
export function levelScore(l) {
  let s = TF_WEIGHT[l.tf] ?? 1;
  s += Math.min(l.reversal, 3) * 0.5;
  if (l.touches === 0) s += 1.5;
  else if (l.touches === 1) s += 1;
  else if (l.touches === 2) s += 0.5;
  else s -= 1;
  if (l.speed === 'live') s += 0.5;
  if (l.type === 'pullback') s -= 1.5;
  if (l.flips === 1) s += 0.5;
  else if (l.flips > 1) s -= 2;
  return round(s, 1);
}

// Levels from every timeframe, strongest first; a weaker level overlapping a
// stronger one (within the tolerance) joins it as confluence.
export function mergeLevels(levels, tol) {
  const rank = (l) => (TF_WEIGHT[l.tf] ?? 0) * 100 + l.score;
  const merged = [];
  for (const l of [...levels].sort((a, b) => rank(b) - rank(a))) {
    const host = merged.find((m) => l.zone[0] <= m.zone[1] + tol && l.zone[1] >= m.zone[0] - tol);
    if (host) {
      if (!host.confluence.includes(l.tf)) host.confluence.push(l.tf);
      continue;
    }
    merged.push({ ...l, confluence: [l.tf] });
  }
  for (const m of merged) m.score = round(m.score + Math.min(m.confluence.length - 1, 3) * 0.5, 1);
  return merged;
}

// A base: three or more candles that fail to close outside the range of the
// candle that started it.
export function findBase(closed, a, { min = 3, maxLook = 24 } = {}) {
  const n = closed.length;
  let best = null;
  for (let m = n - 1 - min; m >= Math.max(0, n - 1 - maxLook); m--) {
    const mother = closed[m];
    let ok = true;
    for (let k = m + 1; k < n; k++) {
      if (closed[k].close > mother.high || closed[k].close < mother.low) {
        ok = false;
        break;
      }
    }
    if (ok) best = { startTime: mother.time, count: n - 1 - m, high: mother.high, low: mother.low, widthAtr: (mother.high - mother.low) / a };
  }
  return best;
}

// Breakout package: a longbar with a full body closing through a level,
// ideally out of a compression (a base, or small candles pressing the level).
export function findBreakout(closed, a, levels, tf, { look = 3 } = {}) {
  const n = closed.length;
  let found = null;
  for (let k = Math.max(6, n - look); k < n; k++) {
    const b = closed[k];
    const range = b.high - b.low;
    if (range < 1.2 * a || Math.abs(b.close - b.open) < 0.7 * range) continue;
    const dir = b.close > b.open ? 'up' : 'down';
    let level = null;
    for (const l of levels) {
      // Only a level of this timeframe or higher makes a breakout here.
      if (l.confirmedTime >= b.time || (TF_WEIGHT[l.tf] ?? 0) < (TF_WEIGHT[tf] ?? 0)) continue;
      const crossed = dir === 'up' ? b.open < l.zone[1] && b.close > l.zone[1] : b.open > l.zone[0] && b.close < l.zone[0];
      if (crossed && (!level || l.score > level.score)) level = l;
    }
    if (!level) continue;
    const before = closed.slice(k - 5, k);
    const avgRange = before.reduce((s, c) => s + (c.high - c.low), 0) / before.length;
    const base = findBase(closed.slice(0, k), a);
    found = {
      tf,
      dir,
      time: b.time,
      candle: classifyCandle(b, a),
      level,
      edge: dir === 'up' ? level.zone[1] : level.zone[0],
      compression: avgRange < 0.8 * a || Boolean(base && base.count >= 3),
      barsAgo: n - 1 - k,
    };
  }
  return found;
}

// The last closed candle as an entry trigger: its class, and whether it
// penetrates (نفوذ) the body of the last candle against it.
export function triggerCandle(closed, a) {
  const b = closed[closed.length - 1];
  const cls = classifyCandle(b, a);
  let opposite = null;
  for (let j = closed.length - 2; j >= Math.max(0, closed.length - 8); j--) {
    const d = dirOf(closed[j]);
    if (d !== 'flat' && d !== cls.dir) {
      opposite = closed[j];
      break;
    }
  }
  const prev = closed[closed.length - 2];
  return {
    ...cls,
    low: b.low,
    high: b.high,
    close: b.close,
    engulfsLastOpposite: Boolean(
      opposite && (cls.dir === 'up' ? b.close > opposite.open : cls.dir === 'down' ? b.close < opposite.open : false),
    ),
    closesBeyondPrev: Boolean(prev && (cls.dir === 'up' ? b.close > prev.high : cls.dir === 'down' ? b.close < prev.low : false)),
  };
}

// Pivot types: a pullback pivot forms on a level that was just broken (it
// retests it from the other side); a reverse pivot turns price on its own
// timeframe's level. A settlement pivot — the first touch of a known level on
// the trigger timeframe — is read at entry time, not here.
export function classifyPivots(closed, pivots, tol, tf) {
  const tracked = pivots.map((p) => trackLevel(closed, p, tf));
  for (const p of pivots) {
    p.type = 'reverse';
    const wants = p.kind === 'low' ? 'support' : 'resistance';
    for (let j = 0; j < pivots.length; j++) {
      const l = tracked[j];
      if (!l.flipTime || l.flipTime >= p.time || l.confirmedTime >= p.time) continue;
      const nowRole = pivots[j].kind === 'high' ? 'support' : 'resistance'; // role after its first flip
      if (nowRole !== wants) continue;
      if (p.zone[0] <= l.zone[1] + tol && p.zone[1] >= l.zone[0] - tol) {
        p.type = 'pullback';
        break;
      }
    }
  }
  return pivots;
}

function analyzeTimeframe(tf, candles, price) {
  if (candles.length < tf.atrPeriod + 10) return null;
  const closed = candles.slice(0, -1);
  const forming = candles[candles.length - 1];
  const atrs = atr(closed, tf.atrPeriod);
  const a = atrs[atrs.length - 1];
  if (!a) return null;
  const pivots = findPivots(closed, atrs);
  classifyPivots(closed, pivots, 0.2 * a, tf.id);
  const levels = pivots.map((p) => trackLevel(closed, p, tf.id)).filter((l) => l.flips < 2);
  const th = tf.thShare ? price * TH_DAILY * tf.thShare : null;
  const last5 = closed.slice(-5);
  return {
    tf,
    atr: a,
    th,
    closed,
    forming,
    pivots,
    levels,
    structure: structure(swings(closed, 2)),
    base: findBase(closed, a),
    compression: last5.reduce((s, c) => s + (c.high - c.low), 0) / last5.length / a,
    lastCandles: closed.slice(-6).map((c) => classifyCandle(c, a)),
    trigger: triggerCandle(closed, a),
  };
}

// Full read of one instrument from whatever feed is running.
export function analyze(inst, feed, { roles = ROLES, timeframes = TIMEFRAMES } = {}) {
  const lowest = feed.getCandles(inst.id, timeframes[0].id);
  if (!lowest.length) return null;
  const price = lowest[lowest.length - 1].close;
  const tfs = {};
  for (const tf of timeframes) tfs[tf.id] = analyzeTimeframe(tf, feed.getCandles(inst.id, tf.id), price);

  const A = (role) => (tfs[roles[role]] ? tfs[roles[role]].atr : null);
  const pattern = tfs[roles.pattern];
  const tol = A('tolerance') || (A('pattern') ? A('pattern') * 0.2 : 0);
  const all = Object.values(tfs).filter(Boolean).flatMap((t) => t.levels);
  const levels = mergeLevels(all, tol).map((l) => {
    const mid = (l.zone[0] + l.zone[1]) / 2;
    const inside = price >= l.zone[0] - tol && price <= l.zone[1] + tol;
    return {
      ...l,
      side: inside ? 'at' : mid > price ? 'above' : 'below',
      // Whatever its history, a zone above price acts as resistance now.
      acts: inside ? l.role : mid > price ? 'resistance' : 'support',
      distance: mid - price,
    };
  });
  const above = levels.filter((l) => l.side === 'above').sort((a, b) => a.distance - b.distance);
  const below = levels.filter((l) => l.side === 'below').sort((a, b) => b.distance - a.distance);
  const at = levels.filter((l) => l.side === 'at').sort((a, b) => b.score - a.score);

  const breakouts = [roles.pattern, roles.trigger]
    .map((id) => (tfs[id] ? findBreakout(tfs[id].closed, tfs[id].atr, all, id) : null))
    .filter(Boolean);

  const daily = tfs['1D'];
  const lastPatternPivot = pattern && pattern.pivots.length ? pattern.pivots[pattern.pivots.length - 1] : null;
  const support = below[0] || null;
  const resistance = above[0] || null;

  return {
    instrument: inst,
    price,
    time: lowest[lowest.length - 1].time,
    roles,
    tolerance: tol,
    atr: {
      context: A('context'),
      structure: A('structure'),
      pattern: A('pattern'),
      trigger: A('trigger'),
      tolerance: A('tolerance'),
    },
    thDaily: price * TH_DAILY,
    timeframes: tfs,
    levels,
    at,
    above: above.slice(0, 6),
    below: below.slice(0, 6),
    support,
    resistance,
    // Where price sits between the nearest support (0) and resistance (1).
    location:
      support && resistance ? (price - support.zone[1]) / (resistance.zone[0] - support.zone[1]) : null,
    breakouts,
    movement: {
      // Share of today's ATR already travelled; past 100% the day's step is
      // spent and price tends to settle or range.
      dailyAtrUsed: daily ? (daily.forming.high - daily.forming.low) / daily.atr : null,
      // Pattern-timeframe steps travelled since its last pivot, signed.
      patternSteps: lastPatternPivot && pattern ? (price - lastPatternPivot.price) / pattern.atr : null,
      lastPatternPivot,
    },
  };
}

// Compact, rounded view for the UI and the AI prompt.
export function describe(snap, { candles = { W: 12, '1D': 20, 240: 30, 60: 24, 15: 16 } } = {}) {
  const { digits, pip } = snap.instrument;
  const p = (x) => round(x, digits);
  const pips = (x) => (x === null ? null : round(x / pip, 1));
  const level = (l) => ({
    tf: l.tf,
    acts: l.acts,
    zone: [p(l.zone[0]), p(l.zone[1])],
    score: l.score,
    touches: l.touches,
    fresh: l.fresh,
    flipped: l.flips > 0,
    speed: l.speed,
    type: l.type,
    confluence: l.confluence,
    distancePips: pips(l.distance),
    formed: new Date(l.time * 1000).toISOString(),
  });
  const timeframes = {};
  for (const [id, t] of Object.entries(snap.timeframes)) {
    if (!t) {
      timeframes[id] = null;
      continue;
    }
    timeframes[id] = {
      label: t.tf.label,
      atrPeriod: t.tf.atrPeriod,
      atr: p(t.atr),
      atrPips: pips(t.atr),
      th: t.th === null ? null : p(t.th),
      atrToTh: t.th ? round(t.atr / t.th, 2) : null,
      structure: t.structure,
      compression: round(t.compression, 2),
      base: t.base && {
        count: t.base.count,
        high: p(t.base.high),
        low: p(t.base.low),
        widthAtr: round(t.base.widthAtr, 2),
        since: new Date(t.base.startTime * 1000).toISOString(),
      },
      forming: {
        time: new Date(t.forming.time * 1000).toISOString(),
        open: p(t.forming.open),
        high: p(t.forming.high),
        low: p(t.forming.low),
        close: p(t.forming.close),
        rangeAtr: round((t.forming.high - t.forming.low) / t.atr, 2),
      },
      lastCandles: t.lastCandles,
      trigger: {
        dir: t.trigger.dir,
        size: t.trigger.size,
        master: t.trigger.master,
        atrRatio: t.trigger.atrRatio,
        engulfsLastOpposite: t.trigger.engulfsLastOpposite,
        closesBeyondPrev: t.trigger.closesBeyondPrev,
      },
      lastPivots: t.pivots.slice(-4).map((pv) => ({
        kind: pv.kind,
        price: p(pv.price),
        time: new Date(pv.time * 1000).toISOString(),
        speed: pv.speed,
        type: pv.type,
        moveAtr: round(pv.move, 2),
        reversalAtr: round(pv.reversal, 2),
      })),
      // [time ISO, open, high, low, close], oldest first, closed bars only.
      candles: t.closed.slice(-(candles[id] || 20)).map((c) => [
        new Date(c.time * 1000).toISOString().slice(0, 16),
        p(c.open),
        p(c.high),
        p(c.low),
        p(c.close),
      ]),
    };
  }
  return {
    instrument: snap.instrument.id,
    name: snap.instrument.nameEn,
    digits,
    pip,
    price: p(snap.price),
    asOf: new Date(snap.time * 1000).toISOString(),
    roles: snap.roles,
    atr: Object.fromEntries(Object.entries(snap.atr).map(([k, v]) => [k, { price: p(v), pips: pips(v) }])),
    thDaily: { price: p(snap.thDaily), pips: pips(snap.thDaily) },
    tolerance: { price: p(snap.tolerance), pips: pips(snap.tolerance) },
    location: round(snap.location, 2),
    movement: {
      dailyAtrUsed: round(snap.movement.dailyAtrUsed, 2),
      patternSteps: round(snap.movement.patternSteps, 2),
    },
    levelsAtPrice: snap.at.map(level),
    levelsAbove: snap.above.map(level),
    levelsBelow: snap.below.map(level),
    breakouts: snap.breakouts.map((b) => ({
      tf: b.tf,
      dir: b.dir,
      time: new Date(b.time * 1000).toISOString(),
      barsAgo: b.barsAgo,
      candle: b.candle,
      level: level({ ...b.level, acts: b.dir === 'up' ? 'support' : 'resistance', distance: (b.level.zone[0] + b.level.zone[1]) / 2 - snap.price, confluence: [b.level.tf] }),
      edge: p(b.edge),
      compression: b.compression,
      distancePips: pips(Math.abs(snap.price - b.edge)),
    })),
    timeframes,
  };
}
