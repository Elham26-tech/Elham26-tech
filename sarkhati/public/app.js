'use strict';

// --- باگ ۱ (سمت رابط کاربری) -------------------------------------------
// رابط هیچ چیزی را در localStorage نگه نمی‌دارد؛ تنها منبع حقیقت سرور است
// و سرور هم وضعیت جلسه را با کلید روز معاملاتی نگه می‌دارد. بنابراین باز
// کردن دوبارهٔ برنامه، وضعیت جلسهٔ قبل را احیا نمی‌کند.
// -----------------------------------------------------------------------

const FIELDS = [
  'baseUrl', 'orderPath', 'token', 'isinOrSymbol', 'side', 'quantity', 'price',
  'minQuantity', 'maxQuantity', 'priceStep', 'targetTime', 'preArmSeconds',
  'sendRate', 'parallel', 'stopAfterSeconds', 'maxAttempts', 'sideFormat',
];

const NUMERIC = new Set([
  'quantity', 'price', 'minQuantity', 'maxQuantity', 'priceStep',
  'preArmSeconds', 'sendRate', 'parallel', 'stopAfterSeconds', 'maxAttempts',
]);

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

const $ = (id) => document.getElementById(id);
const fa = (value) => String(value ?? '').replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

function clockText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return fa(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'خطای ناشناخته');
  return data;
}

function collectSettings() {
  const patch = {};
  for (const key of FIELDS) {
    const el = $(key);
    if (!el) continue;
    const raw = el.value.trim();
    if (NUMERIC.has(key)) {
      patch[key] = raw === '' ? null : Number(raw);
    } else {
      patch[key] = raw;
    }
  }
  return patch;
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/settings', { method: 'PUT', body: collectSettings() })
      .then(render)
      .catch((err) => appendLog({ at: new Date().toISOString(), level: 'error', message: err.message }));
  }, 400);
}

function fillSettings(settings) {
  for (const key of FIELDS) {
    const el = $(key);
    if (!el || el === document.activeElement) continue;
    const value = settings[key];
    el.value = value == null ? '' : String(value);
  }
  $('prearm-echo').textContent = fa(settings.preArmSeconds ?? 0);
}

function appendLog(entry) {
  const box = $('log');
  const stuck = box.scrollTop + box.clientHeight >= box.scrollHeight - 12;
  const p = document.createElement('p');
  const time = document.createElement('span');
  time.className = 't';
  time.textContent = clockText(entry.at);
  const text = document.createElement('span');
  text.className = entry.level;
  text.textContent = entry.message;
  p.append(time, text);
  box.append(p);
  while (box.childElementCount > 400) box.removeChild(box.firstChild);
  if (stuck) box.scrollTop = box.scrollHeight;
}

function renderLog(log) {
  $('log').replaceChildren();
  for (const entry of log) appendLog(entry);
}

let lastLogLength = -1;

function render(status) {
  fillSettings(status.settings);

  $('clock-now').textContent = clockText(status.serverNow);
  $('clock-offset').textContent = status.clockOffsetMs
    ? `اختلاف ساعت: ${fa(status.clockOffsetMs)} ms`
    : 'ساعت همگام نشده';

  const s = status.session;
  $('st-day').textContent = fa(status.tradingDay);
  $('st-state').textContent = s.firing ? 'در حال شلیک'
    : s.armed ? 'مسلح'
    : s.finished ? 'پایان‌یافته'
    : 'آماده';
  $('st-start').textContent = clockText(status.fireStartAt);
  $('st-attempts').textContent = fa(s.attempts);
  $('st-accepted').textContent = fa(s.accepted);
  $('st-learned').textContent = status.learned.sideFormat || '—';

  $('btn-arm').disabled = s.armed || s.firing;
  $('btn-disarm').disabled = !s.armed && !s.firing;

  if (s.log.length !== lastLogLength) {
    renderLog(s.log);
    lastLogLength = s.log.length;
  }
}

function bindAction(id, path, body) {
  $(id).addEventListener('click', async () => {
    const button = $(id);
    button.disabled = true;
    try {
      await api('/api/settings', { method: 'PUT', body: collectSettings() });
      const result = await api(path, { method: 'POST', body });
      render(result.status || result);
    } catch (err) {
      appendLog({ at: new Date().toISOString(), level: 'error', message: err.message });
    } finally {
      button.disabled = false;
      refresh();
    }
  });
}

async function refresh() {
  try {
    render(await api('/api/status'));
  } catch {
    $('clock-offset').textContent = 'ارتباط با سرور قطع است';
  }
}

for (const key of FIELDS) {
  const el = $(key);
  if (el) el.addEventListener('input', scheduleSave);
}

bindAction('btn-arm', '/api/arm');
bindAction('btn-disarm', '/api/disarm');
bindAction('btn-fire', '/api/fire');
bindAction('btn-validate', '/api/validate');
bindAction('btn-sync', '/api/sync-clock');
bindAction('btn-reset-session', '/api/reset', { session: true, learned: false });
bindAction('btn-reset-learned', '/api/reset', { session: false, learned: true });

const events = new EventSource('/api/events');
events.onmessage = (event) => {
  appendLog(JSON.parse(event.data));
  lastLogLength += 1;
};

refresh();
setInterval(refresh, 1000);
