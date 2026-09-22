// Technical indicators over candle arrays. A candle is
// { time (unix seconds), open, high, low, close, volume }. Every series
// function returns an array aligned with its input, with null where the
// lookback is not yet filled.

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// Wilder's RSI, as TradingView's built-in `ta.rsi` computes it.
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => (f[i] === null || s[i] === null ? null : f[i] - s[i]));
  const firstIdx = line.findIndex((v) => v !== null);
  const sig = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const tail = ema(line.slice(firstIdx), signal);
    for (let i = 0; i < tail.length; i++) sig[firstIdx + i] = tail[i];
  }
  const hist = line.map((v, i) => (v === null || sig[i] === null ? null : v - sig[i]));
  return { line, signal: sig, hist };
}

// Wilder's ATR.
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i];
  prev /= period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

// Fractal swing points: a high (low) that is the extreme of `span` bars on
// each side. The last `span` bars can never qualify, which is intended — an
// unconfirmed swing is not a level yet.
export function swings(candles, span = 3) {
  const highs = [];
  const lows = [];
  for (let i = span; i < candles.length - span; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ time: candles[i].time, price: candles[i].high });
    if (isLow) lows.push({ time: candles[i].time, price: candles[i].low });
  }
  return { highs, lows };
}

function last(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i];
  return null;
}

// Market structure from the last few confirmed swings: higher highs and higher
// lows read as an uptrend, lower highs and lower lows as a downtrend.
export function structure(sw) {
  const h = sw.highs.slice(-2);
  const l = sw.lows.slice(-2);
  if (h.length < 2 || l.length < 2) return 'unknown';
  const hh = h[1].price > h[0].price;
  const hl = l[1].price > l[0].price;
  if (hh && hl) return 'uptrend';
  if (!hh && !hl) return 'downtrend';
  return 'range';
}

// One snapshot of everything the signal engines read for a timeframe.
export function summarize(candles) {
  if (!candles || candles.length < 30) return null;
  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = atr(candles, 14);
  const bb = bollinger(closes, 20, 2);
  const sw = swings(candles, 3);
  const close = closes[closes.length - 1];
  const prevHist = m.hist.length > 1 ? m.hist[m.hist.length - 2] : null;
  const e20v = last(e20);
  const e50v = last(e50);
  const e200v = last(e200);

  let trend = 'neutral';
  if (e20v !== null && e50v !== null) {
    if (close > e20v && e20v > e50v && (e200v === null || e50v > e200v)) trend = 'bullish';
    else if (close < e20v && e20v < e50v && (e200v === null || e50v < e200v)) trend = 'bearish';
  }

  return {
    close,
    time: candles[candles.length - 1].time,
    ema20: e20v,
    ema50: e50v,
    ema200: e200v,
    rsi14: last(r),
    macd: last(m.line),
    macdSignal: last(m.signal),
    macdHist: last(m.hist),
    macdHistPrev: prevHist,
    atr14: last(a),
    bbUpper: last(bb.upper),
    bbLower: last(bb.lower),
    trend,
    structure: structure(sw),
    swingHighs: sw.highs.slice(-4).map((s) => s.price),
    swingLows: sw.lows.slice(-4).map((s) => s.price),
  };
}
