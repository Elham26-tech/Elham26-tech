// Simulated candles for trying the app where TradingView is unreachable.
// The UI labels every price and signal from this feed as DEMO — never trade on it.

import { EventEmitter } from 'node:events';

const START = { EURUSD: 1.085, XAUUSD: 2650, GBPJPY: 192.5 };
const VOL = { EURUSD: 0.0006, XAUUSD: 2.2, GBPJPY: 0.12 }; // per-15m-bar noise

const TF_SECONDS = { 15: 900, 60: 3600, 240: 14400, '1D': 86400, W: 604800 };
const MONDAY = 4 * 86400; // the Unix epoch was a Thursday; weekly bars open on Monday

function bucket(time, tf) {
  const step = TF_SECONDS[tf];
  const shift = tf === 'W' ? MONDAY : 0;
  return Math.floor((time - shift) / step) * step + shift;
}

// Deterministic PRNG so the demo history is identical across restarts.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One 15-minute random walk per instrument, aggregated up to every timeframe,
// so all timeframes agree on the same price path.
function buildBase(id, bars15, now) {
  const rand = mulberry32([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const sigma = VOL[id] / START[id]; // relative noise per bar
  const lastOpen = Math.floor(now / 900) * 900;
  const candles = [];
  let price = START[id];
  let drift = 0;
  for (let i = bars15 - 1; i >= 0; i--) {
    if (rand() < 0.01) drift = (rand() - 0.5) * sigma * 0.3; // regime change
    const open = price;
    const close = open * Math.exp(drift + (rand() - 0.5) * 2 * sigma);
    const high = Math.max(open, close) * (1 + rand() * sigma * 0.8);
    const low = Math.min(open, close) * (1 - rand() * sigma * 0.8);
    candles.push({ time: lastOpen - i * 900, open, high, low, close, volume: Math.round(rand() * 500) });
    price = close;
  }
  // Rescale so today's price sits at the instrument's usual level.
  const k = START[id] / price;
  for (const c of candles) {
    c.open *= k;
    c.high *= k;
    c.low *= k;
    c.close *= k;
  }
  return candles;
}

function aggregate(base, tf, bars) {
  const out = [];
  for (const c of base) {
    const t = bucket(c.time, tf);
    const bar = out[out.length - 1];
    if (!bar || bar.time !== t) {
      out.push({ ...c, time: t });
    } else {
      bar.high = Math.max(bar.high, c.high);
      bar.low = Math.min(bar.low, c.low);
      bar.close = c.close;
      bar.volume += c.volume;
    }
  }
  return out.slice(-bars);
}

export class DemoFeed extends EventEmitter {
  constructor({ instruments, timeframes }) {
    super();
    this.source = 'demo';
    this.instruments = instruments;
    this.timeframes = timeframes;
    this.series = new Map();
    const now = Math.floor(Date.now() / 1000);
    const span = Math.max(...timeframes.map((tf) => TF_SECONDS[tf.id] * (tf.bars + 1)));
    for (const inst of instruments) {
      const base = buildBase(inst.id, Math.ceil(span / 900), now);
      for (const tf of timeframes) {
        this.series.set(`${inst.id}:${tf.id}`, {
          candles: aggregate(base, tf.id, tf.bars),
          updatedAt: Date.now(),
        });
      }
    }
  }

  start() {
    this.timer = setInterval(() => this.tick(), 2000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  // Moves every instrument's price once and applies it to all its timeframes.
  tick() {
    const now = Math.floor(Date.now() / 1000);
    for (const inst of this.instruments) {
      const first = this.series.get(`${inst.id}:${this.timeframes[0].id}`).candles;
      const price = first[first.length - 1].close + (Math.random() - 0.5) * VOL[inst.id] * 0.25;
      for (const tf of this.timeframes) {
        const key = `${inst.id}:${tf.id}`;
        const entry = this.series.get(key);
        const candles = entry.candles;
        const openTime = bucket(now, tf.id);
        let bar = candles[candles.length - 1];
        if (bar.time < openTime) {
          bar = { time: openTime, open: bar.close, high: bar.close, low: bar.close, close: bar.close, volume: 0 };
          candles.push(bar);
          if (candles.length > tf.bars) candles.shift();
        }
        bar.close = price;
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        bar.volume += 1;
        entry.updatedAt = Date.now();
        this.emit('update', key);
      }
    }
  }

  getCandles(id, tf) {
    const s = this.series.get(`${id}:${tf}`);
    return s ? s.candles : [];
  }

  getStatus() {
    const out = {};
    for (const [key, s] of this.series) {
      out[key] = { status: 'demo', error: null, bars: s.candles.length, updatedAt: s.updatedAt };
    }
    return out;
  }
}
