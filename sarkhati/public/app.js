'use strict';

// --- باگ ۱ (سمت رابط) --------------------------------------------------
// رابط هیچ چیزی در localStorage نگه نمی‌دارد؛ تنها منبع حقیقت سرور است و
// سرور هم وضعیت جلسه را با کلید روز معاملاتی ذخیره می‌کند. پس باز کردن
// دوبارهٔ برنامه وضعیت اجرای قبلی را احیا نمی‌کند.
// -----------------------------------------------------------------------

const FIELDS = [
  'easyTraderUrl', 'symbol', 'quantity', 'price', 'targetTime', 'preArmSeconds',
  'sendRate', 'parallel', 'stopAfterSeconds', 'maxAttempts',
];

const NUMERIC = new Set([
  'quantity', 'price', 'preArmSeconds', 'sendRate', 'parallel', 'stopAfterSeconds', 'maxAttempts',
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
    patch[key] = NUMERIC.has(key) ? (raw === '' ? null : Number(raw)) : raw;
  }
  return patch;
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/settings', { method: 'PUT', body: collectSettings() })
      .then(render)
      .catch(showError);
  }, 400);
}

function showError(err) {
  appendLog({ at: new Date().toISOString(), level: 'error', message: err.message });
}

function fillSettings(settings) {
  for (const key of FIELDS) {
    const el = $(key);
    if (!el || el === document.activeElement) continue;
    el.value = settings[key] == null ? '' : String(settings[key]);
  }
  $('prearm-echo').textContent = fa(settings.preArmSeconds ?? 0);
}

function appendLog(entry) {
  const box = $('log');
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 12;
  const line = document.createElement('p');
  const time = document.createElement('span');
  time.className = 't';
  time.textContent = clockText(entry.at);
  const text = document.createElement('span');
  text.className = entry.level;
  text.textContent = entry.message;
  line.append(time, text);
  box.append(line);
  while (box.childElementCount > 400) box.removeChild(box.firstChild);
  if (atBottom) box.scrollTop = box.scrollHeight;
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
  const r = status.recipe;

  $('st-day').textContent = fa(status.tradingDay);
  $('st-browser').textContent = status.browserConnected ? 'وصل' : 'وصل نیست';
  $('st-state').textContent = s.firing ? 'در حال شلیک'
    : s.armed ? 'مسلح'
    : s.learning ? 'در حال یادگیری'
    : s.finished ? 'پایان‌یافته'
    : 'آماده';
  $('st-start').textContent = clockText(status.fireStartAt);
  $('st-attempts').textContent = fa(s.attempts);
  $('st-accepted').textContent = fa(s.accepted);

  $('learn-box').classList.toggle('ready', Boolean(r));
  $('learn-state').textContent = r
    ? 'سفارش یاد گرفته شد ✓'
    : s.learning ? 'در انتظار سفارش دستی…' : 'یادگیری خاموش است';
  $('learn-detail').textContent = r ? r.label : '—';
  $('recipe-box').textContent = r
    ? `${r.method} ${r.url}\nفیلدها: ${r.fields.join('، ')}\nمقدار نوع سفارش: ${r.side}\nزمان یادگیری: ${new Date(r.learnedAt).toLocaleString('fa-IR')}`
    : 'هنوز سفارشی یاد گرفته نشده.';

  $('btn-arm').disabled = s.armed || s.firing || !r;
  $('btn-fire').disabled = !r;
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
      showError(err);
    } finally {
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

bindAction('btn-open', '/api/open-easytrader');
bindAction('btn-learn', '/api/learn', { on: true });
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
