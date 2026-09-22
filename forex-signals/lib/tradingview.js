// Live candles from TradingView's chart data socket — the same stream a
// tradingview.com chart reads. One socket carries a chart session per
// (instrument, timeframe); TradingView pushes the history once
// (`timescale_update`) and then every tick of the forming bar (`du`).
//
// This is TradingView's web protocol, not a published API: if they change it,
// this file is the only one that needs to follow.

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const SPLITTER = /~m~\d+~m~/g;

export function encodePacket(packet) {
  const msg = typeof packet === 'string' ? packet : JSON.stringify(packet);
  return `~m~${msg.length}~m~${msg}`;
}

// A frame may hold several packets. Heartbeats come back as
// { heartbeat: '~h~N' } and must be echoed verbatim or the server drops us.
export function decodeFrame(frame) {
  const out = [];
  for (const part of String(frame).split(SPLITTER)) {
    if (!part) continue;
    if (part.startsWith('~h~')) {
      out.push({ heartbeat: part });
      continue;
    }
    try {
      out.push(JSON.parse(part));
    } catch {
      // Unparseable fragments are dropped; the next update carries full bars.
    }
  }
  return out;
}

function randomId(prefix) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let s = prefix;
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// TradingView bar: { i, v: [time, open, high, low, close, volume?] }.
export function toCandle(bar) {
  const v = bar && bar.v;
  if (!Array.isArray(v) || v.length < 5) return null;
  const [time, open, high, low, close, volume = 0] = v;
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
}

// Merge bars into a time-sorted series: an equal time replaces (the forming
// bar ticking), a new time appends, and the series is capped at `max`.
export function mergeCandles(series, incoming, max) {
  if (!incoming.length) return series;
  const byTime = new Map(series.map((c) => [c.time, c]));
  for (const c of incoming) byTime.set(c.time, c);
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export class TradingViewFeed extends EventEmitter {
  constructor({ url, origin, authToken, instruments, timeframes, WebSocketImpl = WebSocket, staleMs = 60_000 }) {
    super();
    this.url = url;
    this.origin = origin;
    this.authToken = authToken;
    this.instruments = instruments;
    this.timeframes = timeframes;
    this.WebSocketImpl = WebSocketImpl;
    this.staleMs = staleMs;
    this.source = 'tradingview';
    this.series = new Map(); // `${id}:${tf}` -> { candles, status, error, updatedAt }
    this.sessions = new Map(); // chart session id -> { key, bars }
    this.ws = null;
    this.stopped = true;
    this.backoffMs = 1000;
    this.lastMessageAt = 0;
    this.connectedAt = 0;
    for (const inst of instruments) {
      for (const tf of timeframes) {
        this.series.set(`${inst.id}:${tf.id}`, { candles: [], status: 'connecting', error: null, updatedAt: 0 });
      }
    }
  }

  start() {
    this.stopped = false;
    this.connect();
    this.watchdog = setInterval(() => this.checkStale(), Math.min(this.staleMs, 15_000));
    this.watchdog.unref?.();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {});
      this.ws.terminate();
      this.ws = null;
    }
  }

  connect() {
    if (this.stopped) return;
    this.sessions.clear();
    const ws = new this.WebSocketImpl(this.url, { headers: { Origin: this.origin } });
    this.ws = ws;
    this.lastMessageAt = Date.now();
    ws.on('open', () => {
      this.connectedAt = Date.now();
      this.send({ m: 'set_auth_token', p: [this.authToken] });
      for (const inst of this.instruments) {
        for (const tf of this.timeframes) this.openChart(inst, tf);
      }
    });
    ws.on('message', (data) => this.onFrame(data.toString()));
    ws.on('close', () => this.scheduleReconnect('closed'));
    ws.on('error', (err) => {
      this.emit('log', `TradingView socket error: ${err.message}`);
      this.markAll('error', err.message);
    });
  }

  scheduleReconnect(reason) {
    if (this.stopped) return;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {});
      this.ws.terminate();
      this.ws = null;
    }
    // A connection that stayed up for a while earns a fresh, short backoff.
    if (this.connectedAt && Date.now() - this.connectedAt > 60_000) this.backoffMs = 1000;
    this.connectedAt = 0;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.emit('log', `TradingView ${reason}; reconnecting in ${wait / 1000}s`);
    for (const s of this.series.values()) if (s.status === 'live') s.status = 'reconnecting';
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), wait);
    this.reconnectTimer.unref?.();
  }

  checkStale() {
    if (this.stopped || !this.ws) return;
    if (Date.now() - this.lastMessageAt > this.staleMs) this.scheduleReconnect('went silent');
  }

  send(packet) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(encodePacket(packet));
  }

  openChart(inst, tf) {
    const cs = randomId('cs_');
    const key = `${inst.id}:${tf.id}`;
    this.sessions.set(cs, { key });
    const symbol = `=${JSON.stringify({ adjustment: 'splits', symbol: inst.tvSymbol })}`;
    this.send({ m: 'chart_create_session', p: [cs, ''] });
    this.send({ m: 'switch_timezone', p: [cs, 'Etc/UTC'] });
    this.send({ m: 'resolve_symbol', p: [cs, 'sds_sym_1', symbol] });
    this.send({ m: 'create_series', p: [cs, 'sds_1', 's1', 'sds_sym_1', tf.id, tf.bars, ''] });
  }

  onFrame(frame) {
    this.lastMessageAt = Date.now();
    for (const packet of decodeFrame(frame)) {
      if (packet.heartbeat) {
        if (this.ws && this.ws.readyState === 1) this.ws.send(encodePacket(packet.heartbeat));
        continue;
      }
      if (!packet.m) continue; // the server hello carries only session info
      this.onPacket(packet);
    }
  }

  onPacket({ m, p }) {
    const session = Array.isArray(p) ? this.sessions.get(p[0]) : null;
    switch (m) {
      case 'timescale_update':
      case 'du': {
        if (!session) return;
        const payload = p[1] && p[1].sds_1;
        if (!payload || !Array.isArray(payload.s)) return;
        const bars = payload.s.map(toCandle).filter(Boolean);
        if (!bars.length) return;
        const entry = this.series.get(session.key);
        const tf = this.timeframes.find((t) => session.key.endsWith(`:${t.id}`));
        entry.candles = mergeCandles(entry.candles, bars, tf ? tf.bars : 500);
        entry.status = 'live';
        entry.error = null;
        entry.updatedAt = Date.now();
        this.backoffMs = 1000;
        this.emit('update', session.key);
        return;
      }
      case 'symbol_error':
      case 'series_error': {
        if (!session) return;
        const entry = this.series.get(session.key);
        entry.status = 'error';
        entry.error = `${m}: ${p.slice(2).filter((x) => typeof x === 'string').join(' ') || 'unknown'}`;
        this.emit('log', `TradingView ${session.key} ${entry.error}`);
        return;
      }
      case 'critical_error':
      case 'protocol_error': {
        const msg = `${m}: ${JSON.stringify(p)}`;
        this.emit('log', `TradingView ${msg}`);
        this.markAll('error', msg);
        this.scheduleReconnect(m);
        return;
      }
      default:
    }
  }

  markAll(status, error) {
    for (const s of this.series.values()) {
      if (s.status !== 'live') {
        s.status = status;
        s.error = error;
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
      out[key] = { status: s.status, error: s.error, bars: s.candles.length, updatedAt: s.updatedAt };
    }
    return out;
  }
}
