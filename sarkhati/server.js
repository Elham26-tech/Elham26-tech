'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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

// وقتی برنامه به‌صورت فایل اجرایی تک‌فایله ساخته شده، صفحه و اسکریپت‌ها
// داخل خودِ فایل‌اند و از آنجا خوانده می‌شوند؛ در حالت عادی از روی دیسک.
const sea = require('node:sea');
const inExecutable = typeof sea.isSea === 'function' && sea.isSea();

function readAsset(name) {
  if (inExecutable) {
    try { return sea.getAsset(name, 'utf8'); } catch { return null; }
  }
  const file = path.join(PUBLIC_DIR, name);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function serveStatic(req, res) {
  const rel = req.url === '/' ? 'index.html' : req.url.replace(/^\/+/, '').split('?')[0];
  const body = readAsset(rel);
  if (body === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('یافت نشد');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(rel)] || 'application/octet-stream',
    'content-length': Buffer.byteLength(body),
  });
  return res.end(body);
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
  if (route === '/api/symbols/search' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, await engine.searchSymbol(body.query));
  }
  if (route === '/api/symbols/select' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await engine.selectSymbol(body);
    return sendJson(res, 200, { ...result, status: engine.status() });
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
  // دانلود مستقیم گزارش تشخیصی: مرورگر فایل را ذخیره می‌کند، بدون اینکه
  // کاربر لازم باشد دنبال مسیر پوشهٔ data بگردد.
  if (route === '/api/diagnostics' && (req.method === 'GET' || req.method === 'POST')) {
    const report = engine.exportDiagnostics();
    const body = JSON.stringify(report.report, null, 2);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="sarkhati-diagnostics.json"',
      'content-length': Buffer.byteLength(body),
    });
    return res.end(body);
  }
  if (route === '/api/symbols/refresh' && req.method === 'POST') {
    try {
      const rows = await engine.ensureSymbols({ force: true });
      return sendJson(res, 200, { ok: true, total: rows.length, status: engine.status() });
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: err.message, status: engine.status() });
    }
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

/**
 * صفحهٔ کنترل را در مرورگر پیش‌فرض باز می‌کند. در پنجرهٔ مشکی ویندوز
 * کلیک روی لینک کار نمی‌کند (و Ctrl+C برنامه را می‌بندد)، پس خودمان بازش
 * می‌کنیم تا کاربر کاری نکند.
 */
function openPanel(link) {
  if (process.env.SARKHATI_NO_OPEN) return;
  try {
    const [cmd, args] = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', link]]
      : process.platform === 'darwin'
        ? ['open', [link]]
        : ['xdg-open', [link]];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // اگر باز نشد، لینک در پنجره چاپ شده و کاربر دستی بازش می‌کند
  }
}

server.listen(PORT, HOST, () => {
  const link = `http://${HOST}:${PORT}`;
  process.stdout.write('\n');
  // این پنجره را cmd ویندوز نشان می‌دهد و فارسی را درست رندر نمی‌کند،
  // پس پیام‌های همین‌جا عمداً انگلیسی‌اند. رابط اصلی فارسی است.
  process.stdout.write('  ==================================================\n');
  process.stdout.write('    SARKHATI is running\n');
  process.stdout.write('  ==================================================\n\n');
  process.stdout.write('    The control panel should open in your browser now.\n');
  process.stdout.write('    If it does not, type this address in your browser:\n\n');
  process.stdout.write(`    ${link}\n\n`);
  process.stdout.write('    Keep this window open while you use the app.\n');
  process.stdout.write('    To stop: just close this window.\n\n');
  openPanel(link);
});

function shutdown() {
  engine.disarm(false);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, engine };
