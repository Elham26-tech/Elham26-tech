// HTTP server: the Persian web UI, a JSON API over the live market read and
// the signal engines, and a server-sent-events stream of prices and signals.
// Everything except /healthz sits behind HTTP Basic auth.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { aiSignal, buildRequest, createClient } from './lib/ai.js';
import { analyze, describe, round } from './lib/analysis.js';
import { config, INSTRUMENTS, instrument, ROLES, TIMEFRAMES, timeframe } from './lib/config.js';
import { DemoFeed } from './lib/demo-feed.js';
import { Knowledge, KnowledgeError } from './lib/knowledge.js';
import { ruleSignal } from './lib/rules.js';
import { finalize } from './lib/signal.js';
import { SignalStore } from './lib/store.js';
import { TradingViewFeed } from './lib/tradingview.js';

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      reject(new HttpError(413, 'request body is too large'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

// Without APP_PASSWORD a random one is generated once and kept in the data
// dir, so a fresh server is never open to whoever finds it.
async function resolvePassword(cfg) {
  if (cfg.appPassword) return { password: cfg.appPassword, generated: false };
  const file = path.join(cfg.dataDir, 'credentials.json');
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (saved.password) return { password: saved.password, generated: true };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const password = crypto.randomBytes(9).toString('base64url');
  await fs.mkdir(cfg.dataDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ user: cfg.appUser, password }), { mode: 0o600 });
  return { password, generated: true };
}

function makeFeed(cfg) {
  if (cfg.dataSource === 'demo') return new DemoFeed({ instruments: INSTRUMENTS, timeframes: TIMEFRAMES });
  if (cfg.dataSource !== 'tradingview') throw new Error(`DATA_SOURCE must be "tradingview" or "demo", got "${cfg.dataSource}"`);
  return new TradingViewFeed({
    url: cfg.tvUrl,
    origin: cfg.tvOrigin,
    authToken: cfg.tvAuthToken,
    instruments: INSTRUMENTS,
    timeframes: TIMEFRAMES,
  });
}

export async function createApp({ cfg = config, feed = makeFeed(cfg), client = createClient(), log = console.log } = {}) {
  const knowledge = await new Knowledge(cfg).load();
  const store = await new SignalStore(cfg).load();
  const { password, generated } = await resolvePassword(cfg);
  const expectedAuth = Buffer.from(`Basic ${Buffer.from(`${cfg.appUser}:${password}`).toString('base64')}`);
  const publicDir = path.join(cfg.root, 'public');
  const sseClients = new Set();
  const inFlight = new Map(); // instrument -> Promise<signal>
  const lastRun = new Map(); // instrument -> ms

  feed.on('log', (msg) => log(msg));

  function authorized(req) {
    const got = Buffer.from(String(req.headers.authorization || ''));
    return got.length === expectedAuth.length && crypto.timingSafeEqual(got, expectedAuth);
  }

  function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(frame);
  }

  function quote(inst) {
    const c15 = feed.getCandles(inst.id, TIMEFRAMES[0].id);
    const d = feed.getCandles(inst.id, '1D');
    if (!c15.length) return { price: null, change: null, time: null };
    const last = c15[c15.length - 1];
    const dayOpen = d.length ? d[d.length - 1].open : null;
    return {
      price: round(last.close, inst.digits),
      change: dayOpen ? round(((last.close - dayOpen) / dayOpen) * 100, 3) : null,
      time: last.time,
    };
  }

  function instrumentStatus(inst) {
    const all = feed.getStatus();
    const out = {};
    for (const tf of TIMEFRAMES) out[tf.id] = all[`${inst.id}:${tf.id}`];
    return out;
  }

  function snapshotOf(id) {
    const inst = instrument(id);
    if (!inst) throw new HttpError(404, `unknown instrument ${id}`);
    const snap = analyze(inst, feed);
    if (!snap) throw new HttpError(503, 'no market data for this instrument yet');
    return snap;
  }

  function staleWarning(snap) {
    const ageMin = (Date.now() / 1000 - snap.time) / 60;
    return ageMin > 60 ? ['داده‌ی قیمت بیش از یک ساعت است به‌روز نشده (بازار بسته است یا اتصال قطع است).'] : [];
  }

  async function runAnalysis(id, trigger) {
    const snap = snapshotOf(id);
    const base = { dataSource: feed.source };
    const candidate = finalize(ruleSignal(snap), snap, { ...base, source: 'rules' });
    let signal = candidate;
    if (client) {
      try {
        const { text: rulebook } = await knowledge.getRulebook();
        const request = buildRequest({
          config: cfg,
          rulebook,
          tutorialBlocks: await knowledge.blocks(),
          desc: describe(snap),
          candidate,
          previous: store.latest(id),
          dataSource: feed.source,
        });
        const { raw, meta } = await aiSignal(client, request);
        signal = finalize(raw, snap, { ...base, ...meta, source: 'ai' });
        const u = meta.usage;
        log(`AI ${id}: ${signal.action} via ${meta.model}${meta.fallbackUsed ? ' (fallback)' : ''}; tokens in ${u.input} cache-read ${u.cacheRead} cache-write ${u.cacheWrite} out ${u.output}`);
      } catch (err) {
        log(`AI analysis for ${id} failed (${err.code || 'error'}): ${err.message}`);
        signal = {
          ...candidate,
          warnings: [...candidate.warnings, `تحلیل هوش مصنوعی انجام نشد (${err.message})؛ این سیگنال از موتور قواعد است.`],
        };
      }
    }
    signal.warnings.push(...staleWarning(snap));
    signal.trigger = trigger;
    await store.add(signal);
    broadcast('signal', signal);
    return signal;
  }

  // One run per instrument at a time, and not more often than the minimum
  // interval — each AI run costs money.
  async function analyzeOnce(id, trigger) {
    if (inFlight.has(id)) return inFlight.get(id);
    const wait = cfg.minAnalyzeSeconds * 1000 - (Date.now() - (lastRun.get(id) || 0));
    if (wait > 0) throw new HttpError(429, 'analysed moments ago; try again shortly', { retryAfter: Math.ceil(wait / 1000) });
    lastRun.set(id, Date.now());
    const job = runAnalysis(id, trigger).finally(() => inFlight.delete(id));
    inFlight.set(id, job);
    return job;
  }

  async function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
    const file = path.resolve(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep)) throw new HttpError(404, 'not found');
    const type = STATIC_TYPES[path.extname(file)];
    if (!type) throw new HttpError(404, 'not found');
    let data;
    try {
      data = await fs.readFile(file);
    } catch {
      throw new HttpError(404, 'not found');
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  }

  async function route(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean);
    const m = req.method;

    if (url.pathname === '/api/config' && m === 'GET') {
      return sendJson(res, 200, {
        instruments: INSTRUMENTS.map(({ id, tvSymbol, nameFa, nameEn, digits, pip }) => ({ id, tvSymbol, nameFa, nameEn, digits, pip })),
        timeframes: TIMEFRAMES.map(({ id, label, atrPeriod }) => ({ id, label, atrPeriod })),
        roles: ROLES,
        dataSource: feed.source,
        ai: { enabled: Boolean(client), model: cfg.model, effort: cfg.effort, fallbacks: cfg.fallbacks },
        autoAnalyzeMinutes: cfg.autoAnalyzeMinutes,
        riskPercent: cfg.riskPercent,
      });
    }

    if (url.pathname === '/api/state' && m === 'GET') {
      return sendJson(res, 200, {
        dataSource: feed.source,
        instruments: INSTRUMENTS.map((inst) => ({
          id: inst.id,
          ...quote(inst),
          status: instrumentStatus(inst),
          latest: store.latest(inst.id),
          analyzing: inFlight.has(inst.id),
        })),
      });
    }

    if (parts[0] === 'api' && parts[1] === 'analysis' && parts.length === 3 && m === 'GET') {
      const snap = snapshotOf(parts[2]);
      const rules = finalize(ruleSignal(snap), snap, { source: 'rules', dataSource: feed.source });
      return sendJson(res, 200, { read: describe(snap), rules });
    }

    if (parts[0] === 'api' && parts[1] === 'candles' && parts.length === 4 && m === 'GET') {
      const inst = instrument(parts[2]);
      const tf = timeframe(parts[3]);
      if (!inst || !tf) throw new HttpError(404, 'unknown instrument or timeframe');
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 150, 20), 300);
      const r = (x) => round(x, inst.digits);
      const candles = feed
        .getCandles(inst.id, tf.id)
        .slice(-limit)
        .map((c) => ({ time: c.time, open: r(c.open), high: r(c.high), low: r(c.low), close: r(c.close) }));
      const snap = analyze(inst, feed);
      const zones = snap
        ? snap.levels
            .filter((l) => l.score >= 3)
            .map((l) => ({ tf: l.tf, acts: l.acts, zone: l.zone, score: l.score, fresh: l.fresh, confluence: l.confluence }))
        : [];
      return sendJson(res, 200, { instrument: inst.id, timeframe: tf.id, digits: inst.digits, candles, zones });
    }

    if (parts[0] === 'api' && parts[1] === 'analyze' && parts.length === 3 && m === 'POST') {
      if (!instrument(parts[2])) throw new HttpError(404, `unknown instrument ${parts[2]}`);
      return sendJson(res, 200, await analyzeOnce(parts[2], 'manual'));
    }

    if (url.pathname === '/api/signals' && m === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
      return sendJson(res, 200, store.list({ instrument: url.searchParams.get('instrument'), limit }));
    }

    if (url.pathname === '/api/knowledge' && m === 'GET') {
      return sendJson(res, 200, { rulebook: await knowledge.getRulebook(), ...knowledge.list() });
    }

    if (url.pathname === '/api/knowledge/rulebook' && m === 'PUT') {
      const body = await readJson(req);
      return sendJson(res, 200, await knowledge.setRulebook(body.text));
    }

    if (url.pathname === '/api/tutorials' && m === 'POST') {
      const name = decodeURIComponent(String(req.headers['x-file-name'] || ''));
      const buf = await readBody(req, cfg.maxUploadBytes);
      return sendJson(res, 201, await knowledge.add(name, buf));
    }

    if (parts[0] === 'api' && parts[1] === 'tutorials' && parts.length === 3) {
      if (m === 'PATCH') {
        const body = await readJson(req);
        return sendJson(res, 200, await knowledge.setActive(parts[2], body.active));
      }
      if (m === 'DELETE') {
        await knowledge.remove(parts[2]);
        return sendJson(res, 200, { ok: true });
      }
    }

    if (url.pathname === '/api/stream' && m === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return undefined;
    }

    if (m === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    throw new HttpError(404, 'not found');
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, dataSource: feed.source });
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="forex-signals", charset="UTF-8"', 'Content-Type': 'text/plain' });
      return res.end('authentication required');
    }
    try {
      await route(req, res, url);
    } catch (err) {
      const status = err instanceof HttpError || err instanceof KnowledgeError ? err.status : 500;
      if (status === 500) log(`${req.method} ${url.pathname} failed: ${err.stack || err}`);
      if (!res.headersSent) sendJson(res, status, { error: err.message, ...(err.extra || {}) });
      else res.end();
    }
  });

  // Prices to every open page once a second.
  const ticker = setInterval(() => {
    if (!sseClients.size) return;
    broadcast(
      'prices',
      Object.fromEntries(INSTRUMENTS.map((inst) => [inst.id, { ...quote(inst), analyzing: inFlight.has(inst.id) }])),
    );
  }, 1000);
  ticker.unref();

  let auto = null;
  if (cfg.autoAnalyzeMinutes > 0 && client) {
    auto = setInterval(async () => {
      for (const inst of INSTRUMENTS) {
        const c = feed.getCandles(inst.id, TIMEFRAMES[0].id);
        // Skip closed markets: no point paying to re-read a frozen chart.
        if (!c.length || Date.now() / 1000 - c[c.length - 1].time > 3600) continue;
        try {
          await analyzeOnce(inst.id, 'auto');
        } catch (err) {
          log(`auto analysis ${inst.id}: ${err.message}`);
        }
      }
    }, cfg.autoAnalyzeMinutes * 60_000);
    auto.unref();
  }

  return {
    server,
    feed,
    store,
    knowledge,
    credentials: { user: cfg.appUser, password, generated },
    start() {
      feed.start();
      return new Promise((resolve) => server.listen(cfg.port, cfg.host, () => resolve(server.address())));
    },
    async close() {
      clearInterval(ticker);
      clearInterval(auto);
      feed.stop();
      for (const res of sseClients) res.end();
      await new Promise((resolve) => server.close(resolve));
      await store.writing;
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const app = await createApp();
  const addr = await app.start();
  const where = `http://${addr.address === '0.0.0.0' ? 'localhost' : addr.address}:${addr.port}`;
  console.log(`forex-signals on ${where} — data: ${app.feed.source}, AI: ${createClient() ? config.model : 'off (rules only; set ANTHROPIC_API_KEY)'}`);
  if (app.credentials.generated) {
    console.log(`login: ${app.credentials.user} / ${app.credentials.password}  (generated; set APP_PASSWORD to choose your own)`);
  }
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
