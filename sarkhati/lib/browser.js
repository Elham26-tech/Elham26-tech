'use strict';

// کروم/اِج نصب‌شده روی همین ویندوز را با پورت دیباگ باز می‌کند و از راه
// پروتکل DevTools با آن حرف می‌زند. هیچ مرورگری دانلود یا نصب نمی‌شود.
//
// نکتهٔ مهم: نام کاربری و رمز کارگزاری هرگز وارد این برنامه نمی‌شود و جایی
// ذخیره نمی‌گردد — لاگین را خودتان داخل همان پنجرهٔ ایزی‌تریدر انجام می‌دهید
// و نشست فقط داخل پروفایل کروم می‌ماند.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { WebSocketClient } = require('./ws');

const CHROME_CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    process.env.CHROME_PATH || '',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
};

function findChrome() {
  if (process.env.SARKHATI_CHROME && fs.existsSync(process.env.SARKHATI_CHROME)) {
    return process.env.SARKHATI_CHROME;
  }
  const list = CHROME_CANDIDATES[process.platform] || CHROME_CANDIDATES.linux;
  for (const candidate of list) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  if (process.platform === 'win32') {
    const local = path.join(
      os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe',
    );
    if (fs.existsSync(local)) return local;
  }
  return null;
}

function getJson(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: route }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('کروم پاسخ نداد.')));
  });
}

async function waitForDevtools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await getJson(port, '/json/version');
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`اتصال به کروم برقرار نشد: ${lastError && lastError.message}`);
}

/** یک نشست DevTools: ارسال فرمان و گوش دادن به رویدادها */
class Browser extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.sessions = new Set();
    this.port = Number(process.env.SARKHATI_DEBUG_PORT) || 9222;
  }

  get connected() {
    return Boolean(this.ws) && !this.ws.closed;
  }

  async open(startUrl, profileDir) {
    if (this.connected) {
      if (startUrl) await this.send('Target.createTarget', { url: startUrl });
      return { reused: true };
    }
    const chrome = findChrome();
    if (!chrome) {
      throw new Error('کروم یا اِج روی این سیستم پیدا نشد. مسیر آن را در متغیر SARKHATI_CHROME بگذارید.');
    }
    fs.mkdirSync(profileDir, { recursive: true });
    const extraFlags = (process.env.SARKHATI_CHROME_FLAGS || '').split(' ').filter(Boolean);
    this.child = spawn(chrome, [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...extraFlags,
      startUrl || 'about:blank',
    ], { detached: true, stdio: 'ignore' });
    this.child.unref();

    await waitForDevtools(this.port);
    await this.attach();
    return { reused: false, chrome };
  }

  async attach() {
    const version = await waitForDevtools(this.port);
    this.ws = await WebSocketClient.connect(version.webSocketDebuggerUrl);
    this.ws.on('message', (text) => this.onMessage(text));
    this.ws.on('close', () => { this.ws = null; this.sessions.clear(); this.emit('disconnected'); });
    // هر تبِ جدید خودکار وصل می‌شود تا درخواست‌هایش دیده شود
    await this.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  }

  onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }

    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'خطای DevTools'));
      else resolve(msg.result);
      return;
    }

    if (msg.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = msg.params;
      if (targetInfo.type === 'page') {
        this.sessions.add(sessionId);
        this.send('Network.enable', {}, sessionId).catch(() => {});
        this.send('Page.enable', {}, sessionId).catch(() => {});
      }
      return;
    }
    if (msg.method === 'Target.detachedFromTarget') {
      this.sessions.delete(msg.params.sessionId);
      return;
    }
    if (msg.method) this.emit('event', msg);
  }

  send(method, params = {}, sessionId) {
    if (!this.ws) return Promise.reject(new Error('به کروم وصل نیستیم.'));
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`پاسخی برای ${method} نرسید.`));
      }, 15000);
      this.ws.send(JSON.stringify(payload));
    });
  }

  /** یک نشستِ صفحهٔ باز (برای اجرای کد داخل صفحهٔ کارگزاری) */
  anySession() {
    for (const sessionId of this.sessions) return sessionId;
    return null;
  }

  /**
   * درخواست را از داخلِ خودِ صفحهٔ کارگزاری می‌فرستد، بنابراین کوکی‌ها،
   * هدرها و توکن نشست دقیقاً همان‌هایی‌اند که مرورگر می‌فرستد.
   */
  async replayRequest(recipe) {
    const sessionId = this.anySession();
    if (!sessionId) throw new Error('هیچ صفحهٔ بازی از کارگزاری پیدا نشد.');

    const expression = `(async () => {
      const started = performance.now();
      try {
        const res = await fetch(${JSON.stringify(recipe.url)}, {
          method: ${JSON.stringify(recipe.method || 'POST')},
          headers: ${JSON.stringify(recipe.headers || {})},
          body: ${JSON.stringify(recipe.body == null ? null : recipe.body)},
          credentials: 'include',
          cache: 'no-store',
        });
        const text = await res.text();
        return JSON.stringify({ ok: res.ok, status: res.status, text: text.slice(0, 500), ms: Math.round(performance.now() - started) });
      } catch (err) {
        return JSON.stringify({ ok: false, status: 0, text: String(err && err.message), ms: Math.round(performance.now() - started) });
      }
    })()`;

    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'اجرای درخواست در صفحه شکست خورد.');
    }
    return JSON.parse(result.result.value);
  }

  close() {
    if (this.ws) this.ws.close();
    this.ws = null;
    this.sessions.clear();
  }
}

module.exports = { Browser, findChrome };
