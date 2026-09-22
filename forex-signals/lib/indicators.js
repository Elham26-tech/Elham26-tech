// Low-level series math over candle arrays. A candle is
// { time (unix seconds), open, high, low, close, volume }. Series functions
// return an array aligned with their input, null where the lookback is not
// yet filled.

// Wilder's ATR, as TradingView's built-in `ta.atr` computes it.
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

// Market structure from the last two confirmed swings each way: higher highs
// and higher lows read as an uptrend, lower highs and lower lows as a downtrend.
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
