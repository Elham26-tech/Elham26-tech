'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Engine } = require('./lib/engine');

const PORT = Number(process.env.PORT) || 9117;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const engine = new Engine();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('بدنهٔ درخواست بیش از حد بزرگ است.'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const rel = req.url === '/' ? 'index.html' : req.url.replace(/^\/+/, '').split('?')[0];
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('یافت نشد');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, route) {
  if (route === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, engine.status());
  }
  if (route === '/api/settings' && req.method === 'PUT') {
    engine.updateSettings(await readBody(req));
    return sendJson(res, 200, engine.status());
  }
  if (route === '/api/validate' && req.method === 'POST') {
    return sendJson(res, 200, { ...engine.validate(), status: engine.status() });
  }
  if (route === '/api/open-easytrader' && req.method === 'POST') {
    const result = await engine.openEasyTrader();
    return sendJson(res, 200, { ...result, status: engine.status() });
  }
  if (route === '/api/learn' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, engine.setLearning(body.on !== false));
  }
  if (route === '/api/sync-clock' && req.method === 'POST') {
    const result = await engine.syncClock();
    return sendJson(res, 200, { ...result, status: engine.status() });
  }
  if (route === '/api/arm' && req.method === 'POST') {
    return sendJson(res, 200, engine.arm());
  }
  if (route === '/api/disarm' && req.method === 'POST') {
    return sendJson(res, 200, engine.disarm());
  }
  if (route === '/api/fire' && req.method === 'POST') {
    return sendJson(res, 200, await engine.fireNow());
  }
  if (route === '/api/reset' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, engine.resetMemory(body));
  }
  if (route === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const off = engine.onLog((entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { off(); clearInterval(keepAlive); });
    return undefined;
  }
  return sendJson(res, 404, { error: 'مسیر یافت نشد' });
}

const server = http.createServer((req, res) => {
  const route = req.url.split('?')[0];
  if (!route.startsWith('/api/')) return serveStatic(req, res);
  return handleApi(req, res, route).catch((err) => sendJson(res, 400, { error: err.message }));
});

server.listen(PORT, HOST, () => {
  const link = `http://${HOST}:${PORT}`;
  process.stdout.write('\n');
  process.stdout.write('  ==================================================\n');
  process.stdout.write('    سرخطی‌زن در حال اجراست\n');
  process.stdout.write('  ==================================================\n\n');
  process.stdout.write(`    ${link}\n\n`);
  process.stdout.write('    روی لینک بالا کلیک کنید (یا در مرورگر باز کنید).\n');
  process.stdout.write('    برای بستن برنامه این پنجره را ببندید یا Ctrl+C بزنید.\n\n');
});

function shutdown() {
  engine.disarm(false);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, engine };
