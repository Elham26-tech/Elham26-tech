'use strict';

// رابط هیچ چیزی در localStorage نگه نمی‌دارد؛ تنها منبع حقیقت سرور است و
// سرور هم وضعیت جلسه را با کلید روز معاملاتی ذخیره می‌کند. پس باز کردن
// دوبارهٔ برنامه وضعیت اجرای قبلی را احیا نمی‌کند.

const FIELDS = [
  'easyTraderUrl', 'side', 'quantity', 'price', 'priceMode',
  'targetTime', 'targetMillis', 'preArmSeconds',
  'retryGapMs', 'fireSeconds', 'parallel', 'leadMs', 'maxAttempts',
  'capturedIsSell', 'rangePercent',
];

const NUMERIC = new Set([
  'quantity', 'price', 'targetMillis', 'preArmSeconds',
  'retryGapMs', 'fireSeconds', 'parallel', 'leadMs', 'maxAttempts', 'rangePercent',
]);

const BOOLEAN = new Set(['capturedIsSell']);

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

const $ = (id) => document.getElementById(id);
const fa = (value) => String(value ?? '').replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
const pad2 = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');

/** عدد با جداکنندهٔ هزارگان و رقم فارسی */
function num(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return fa(number.toLocaleString('en-US'));
}

function clockText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return fa(`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`);
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

function showError(err) {
  appendLog({ at: new Date().toISOString(), level: 'error', message: err.message });
}

function collectSettings() {
  const patch = {};
  const mode = $('priceMode') ? $('priceMode').value : 'manual';
  for (const key of FIELDS) {
    const el = $(key);
    if (!el) continue;
    // عددی که در حالت سقف/کف نشان داده می‌شود مالِ خودِ کارگزاری است؛
    // نباید جای قیمتِ دستیِ کاربر ذخیره شود.
    if (key === 'price' && mode !== 'manual') continue;
    const raw = el.value.trim();
    if (BOOLEAN.has(key)) patch[key] = raw === 'true';
    else patch[key] = NUMERIC.has(key) ? (raw === '' ? null : Number(raw)) : raw;
  }
  return patch;
}

let saveTimer = null;
// تا وقتی تغییرِ ذخیره‌نشده داریم، پاسخ‌های دوره‌ای سرور نباید فرم را
// عقب برگردانند — همین باعث می‌شد انتخاب «سقف مجاز» به «دستی» برگردد.
let pendingSave = false;

// لحظهٔ آخرین تغییرِ کاربر. پاسخی که *قبل* از آن درخواست شده کهنه است و
// نباید فرم را عقب ببرد؛ وگرنه انتخاب تازه با پاسخِ در راه پاک می‌شود.
let lastChangeAt = 0;

function saveNow() {
  clearTimeout(saveTimer);
  pendingSave = true;
  lastChangeAt = Date.now();
  return api('/api/settings', { method: 'PUT', body: collectSettings() })
    .then((status) => { pendingSave = false; render(status); })
    .catch((err) => { pendingSave = false; showError(err); });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  pendingSave = true;
  lastChangeAt = Date.now();
  saveTimer = setTimeout(saveNow, 350);
}

function fillSettings(settings) {
  if (pendingSave) return;
  for (const key of FIELDS) {
    const el = $(key);
    if (!el || el === document.activeElement) continue;
    el.value = settings[key] == null ? '' : String(settings[key]);
    if (BOOLEAN.has(key)) el.value = settings[key] ? 'true' : 'false';
  }
}

/* ------------------------------------------------------- گزارش */

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

/* --------------------------------------------- شمارش معکوس زنده */

// آخرین وضعیت سرور به‌همراه لحظهٔ دریافتش؛ شمارش معکوس بین دو بار
// به‌روزرسانی هم باید هر ثانیه جلو برود، نه اینکه منتظر پاسخ بعدی بماند.
let lastStatus = null;
let lastStatusAt = 0;

function renderCountdown() {
  const box = $('countdown');
  const label = $('countdown-label');
  const sub = $('countdown-sub');
  if (!lastStatus) return;

  const s = lastStatus.session;
  box.classList.remove('soon', 'firing');

  if (s.firing) {
    label.textContent = 'در حال شلیک';
    box.textContent = fa(s.attempts);
    box.classList.add('firing');
    sub.textContent = `${fa(s.accepted)} پذیرفته، ${fa(s.rejected)} رد`;
    return;
  }
  if (s.finished && s.accepted) {
    label.textContent = 'انجام شد';
    box.textContent = '✓';
    box.classList.add('firing');
    sub.textContent = 'سفارش پذیرفته شد';
    return;
  }
  if (!s.armed) {
    label.textContent = 'تا شروع شلیک';
    box.textContent = '—';
    sub.textContent = 'مسلح نشده';
    return;
  }

  const drift = (Date.now() - lastStatusAt) / 1000;
  const left = Math.max(0, Math.round(lastStatus.secondsToFireStart - drift));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;

  label.textContent = 'تا شروع شلیک';
  box.textContent = fa(h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`);
  if (left <= 60) box.classList.add('soon');
  sub.textContent = `شلیک از ${clockText(lastStatus.fireStartAt)} — هدف ${fa(lastStatus.settings.targetTime)}`;
}

/* ------------------------------------------------------- نمایش */

let lastLogLength = -1;

function render(status) {
  lastStatus = status;
  lastStatusAt = Date.now();
  fillSettings(status.settings);

  const s = status.session;
  const r = status.recipe;

  $('clock-now').textContent = clockText(status.serverNow);
  $('clock-offset').textContent = status.clockOffsetMs
    ? `اختلاف ${fa(status.clockOffsetMs)}ms`
    : '';

  const browserPill = $('pill-browser');
  browserPill.textContent = status.browserConnected ? 'مرورگر: وصل' : 'مرورگر: وصل نیست';
  browserPill.classList.toggle('on', status.browserConnected);

  const statePill = $('pill-state');
  statePill.textContent = s.firing ? 'در حال شلیک'
    : s.armed ? 'مسلح'
    : s.learning ? 'در حال یادگیری'
    : s.finished ? 'پایان‌یافته'
    : 'آماده';
  statePill.classList.toggle('hot', s.armed || s.firing);

  const badge = $('learn-badge');
  badge.textContent = r ? 'سفارش یاد گرفته شد ✓' : s.learning ? 'در انتظار سفارش دستی…' : 'یاد نگرفته';
  badge.className = `badge ${r ? 'ok' : 'warn'}`;
  if (r) $('learn-detail').textContent = r.label;

  $('symbol-count').textContent = status.symbolCount ? `${fa(status.symbolCount)} نماد` : '';
  $('st-attempts').textContent = fa(s.attempts);
  $('st-accepted').textContent = fa(s.accepted);
  $('st-rejected').textContent = fa(s.rejected);
  $('st-day').textContent = fa(status.tradingDay);

  $('recipe-box').textContent = r
    ? `${r.method} ${r.url}\nفیلدها: ${r.fields.join('، ')}\nنوع سفارش: ${r.side}`
      + `\nمسیر اطلاعات نماد: ${status.hasInstrumentEndpoint ? 'یاد گرفته شد' : 'هنوز نه'}`
    : 'هنوز سفارشی یاد گرفته نشده.';

  renderInstrument(status);
  renderCountdown();

  $('btn-arm').disabled = s.armed || s.firing || !r;
  $('btn-fire').disabled = !r;
  $('btn-disarm').disabled = !s.armed && !s.firing;

  if (s.log.length !== lastLogLength) {
    renderLog(s.log);
    lastLogLength = s.log.length;
  }
}

function renderInstrument(status) {
  const inst = status.settings.instrument;
  $('instrument-box').hidden = !inst;

  if (inst) {
    $('inst-title').textContent = `${inst.symbol || '—'}${inst.name ? ' — ' + inst.name : ''}`;
    $('inst-max').textContent = num(inst.priceMax);
    $('inst-min').textContent = num(inst.priceMin);
    $('inst-yday').textContent = num(inst.yesterdayPrice);
    $('inst-minq').textContent = num(inst.minQuantity);
    $('inst-maxq').textContent = num(inst.maxQuantity);
    $('inst-tick').textContent = num(inst.tick);

    const source = $('inst-source');
    source.textContent = inst.estimated ? 'تخمینی' : 'از کارگزاری';
    source.className = `badge ${inst.estimated ? 'warn' : 'ok'}`;

    $('inst-note').textContent = inst.estimated
      ? (status.hasInstrumentEndpoint
        ? 'کارگزاری عدد نداد؛ این سقف/کف از قیمت دیروز تخمین زده شده. قبل از ارسال بررسی کنید.'
        : 'برای گرفتن سقف/کف واقعی، در ایزی‌تریدر یک نماد را باز کنید تا مسیرش یاد گرفته شود.')
      : `ISIN: ${inst.isin}`;
  }

  // در حالت سقف/کف، عددِ واقعی داخل همان فیلد قیمت نشان داده می‌شود تا
  // کاربر ببیند چه چیزی ارسال می‌شود؛ فقط خواندنی است، نه پنهان.
  const manual = status.settings.priceMode === 'manual';
  const priceField = $('price');
  const priceLabel = $('price-label');

  if (!manual && priceField !== document.activeElement) {
    priceField.value = status.effectivePrice == null ? '' : String(status.effectivePrice);
  }
  priceField.readOnly = !manual;
  priceField.classList.toggle('auto', !manual);
  priceLabel.textContent = manual ? 'قیمت دستی'
    : status.settings.priceMode === 'max' ? 'قیمت (سقف مجاز)' : 'قیمت (کف مجاز)';

  $('effective-price').textContent = num(status.effectivePrice);
  $('btn-max-qty').disabled = !(inst && inst.maxQuantity);
}

/* ------------------------------------- جست‌وجوی نماد حین تایپ */

let searchTimer = null;
let activeIndex = -1;
let hits = [];

function renderResults(rows) {
  const list = $('results');
  hits = rows;
  activeIndex = -1;
  list.replaceChildren();
  list.hidden = rows.length === 0;

  rows.forEach((row, index) => {
    const li = document.createElement('li');
    const symbol = document.createElement('b');
    symbol.textContent = row.symbol;
    const name = document.createElement('span');
    name.textContent = row.name;
    li.append(symbol, name);
    li.addEventListener('mouseenter', () => setActive(index));
    li.addEventListener('click', () => choose(row));
    list.append(li);
  });
}

function setActive(index) {
  const list = $('results');
  activeIndex = index;
  [...list.children].forEach((li, i) => li.classList.toggle('active', i === index));
  if (index >= 0 && list.children[index]) {
    list.children[index].scrollIntoView({ block: 'nearest' });
  }
}

async function choose(row) {
  $('results').hidden = true;
  $('symbolQuery').value = row.symbol;
  try {
    render((await api('/api/symbols/select', { method: 'POST', body: row })).status);
  } catch (err) {
    showError(err);
  }
}

async function runSearch(term) {
  try {
    const result = await api('/api/symbols/search', { method: 'POST', body: { query: term } });
    renderResults(result.rows || []);
    if (!result.ok && result.error) showError(new Error(result.error));
  } catch (err) {
    showError(err);
  }
}

$('symbolQuery').addEventListener('input', () => {
  const term = $('symbolQuery').value.trim();
  clearTimeout(searchTimer);
  if (!term) {
    $('results').hidden = true;
    return;
  }
  // ۱۸۰ میلی‌ثانیه بعد از آخرین کلید: نه به ازای هر حرف، نه با تأخیر محسوس
  searchTimer = setTimeout(() => runSearch(term), 180);
});

$('symbolQuery').addEventListener('keydown', (event) => {
  if ($('results').hidden || !hits.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setActive((activeIndex + 1) % hits.length);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setActive((activeIndex - 1 + hits.length) % hits.length);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(hits[activeIndex >= 0 ? activeIndex : 0]);
  } else if (event.key === 'Escape') {
    $('results').hidden = true;
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-wrap')) $('results').hidden = true;
});

$('btn-max-qty').addEventListener('click', () => {
  const inst = lastStatus && lastStatus.settings.instrument;
  if (!inst || !inst.maxQuantity) return;
  $('quantity').value = String(inst.maxQuantity);
  scheduleSave();
});

/* ------------------------------------------------------- کنش‌ها */

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

for (const key of FIELDS) {
  const el = $(key);
  if (!el) continue;
  // انتخاب از فهرست باید بی‌درنگ اثر کند، نه با تأخیر
  if (el.tagName === 'SELECT') el.addEventListener('change', saveNow);
  else el.addEventListener('input', scheduleSave);
}

bindAction('btn-open', '/api/open-easytrader');
bindAction('btn-learn', '/api/learn', { on: true });
bindAction('btn-arm', '/api/arm');
bindAction('btn-disarm', '/api/disarm');
bindAction('btn-fire', '/api/fire');
bindAction('btn-validate', '/api/validate');
bindAction('btn-sync', '/api/sync-clock');
bindAction('btn-refresh-symbols', '/api/symbols/refresh');
bindAction('btn-reset-session', '/api/reset', { session: true, learned: false });
bindAction('btn-reset-learned', '/api/reset', { session: false, learned: true });

async function refresh() {
  const startedAt = Date.now();
  try {
    const status = await api('/api/status');
    // اگر در این فاصله کاربر چیزی عوض کرده، این پاسخ کهنه است
    if (lastChangeAt > startedAt) return;
    render(status);
  } catch {
    $('pill-browser').textContent = 'ارتباط با سرور قطع است';
  }
}

const events = new EventSource('/api/events');
events.onmessage = (event) => {
  appendLog(JSON.parse(event.data));
  lastLogLength += 1;
};

refresh();
setInterval(refresh, 1000);
setInterval(renderCountdown, 250);  // شمارش معکوس مستقل از پاسخ سرور جلو می‌رود
