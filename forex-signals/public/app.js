// Front end: instrument cards fed by the server's event stream, the signal
// card, a canvas candle chart with the course zones and the signal's lines,
// the embedded TradingView chart, the market-read tables, the tutorials
// library and the signal history. All server text is inserted as textContent.

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const TF_FA = { 15: '۱۵ دقیقه', 60: '۱ ساعته', 240: '۴ ساعته', '1D': 'روزانه', W: 'هفتگی' };
const ROLE_FA = { context: 'بستر', structure: 'ساختار', pattern: 'پترن (گام)', trigger: 'تریگر', tolerance: 'تلورانس' };
const ACTION_FA = { BUY: 'خرید', SELL: 'فروش', WAIT: 'صبر' };
const ORDER_FA = { market: 'مارکت', limit: 'لیمیت', none: '' };
const SETUP_FA = {
  rtp: 'بازگشت به پیوت (RTP)',
  pivot: 'پیوت',
  breakout: 'پکیج شکست',
  flip: 'سطح فلیپ‌شده',
  nature: 'ماهیت سطح',
  magnet: 'مگنت',
  'stop-hunt': 'استاپ‌هانت',
  none: 'بدون ستاپ',
};
const SIZE_FA = { spinning: 'اسپینینگ', standard: 'استاندارد', longbar: 'لانگ‌بار', spike: 'اسپایک' };
const STRUCT_FA = { uptrend: 'صعودی', downtrend: 'نزولی', range: 'رنج', unknown: 'نامشخص' };
const TV_INTERVAL = { 15: '15', 60: '60', 240: '240', '1D': 'D', W: 'W' };

const state = {
  config: null,
  selected: null,
  tf: '60',
  chartMode: 'levels',
  quotes: {},
  latest: {},
  read: null,
  rules: null,
  chart: null,
  hover: null,
  historyFilter: '',
};

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function inst(id = state.selected) {
  return state.config.instruments.find((i) => i.id === id);
}

function price(x, digits = inst().digits) {
  return x === null || x === undefined ? '—' : Number(x).toFixed(digits);
}

function num(text, cls = 'num') {
  return h('span', { class: cls }, text);
}

function when(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function isDark() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

/* ---------------- header & instruments ---------------- */

function renderBadges() {
  const c = state.config;
  const feed = $('#feed-badge');
  feed.className = `badge ${c.dataSource === 'demo' ? 'demo' : 'live'}`;
  feed.textContent = c.dataSource === 'demo' ? 'داده‌ی نمایشی (DEMO)' : 'داده‌ی زنده TradingView';
  $('#ai-badge').textContent = c.ai.enabled ? `هوش مصنوعی: ${c.ai.model}` : 'هوش مصنوعی خاموش — فقط موتور قواعد';
  const auto =
    c.auto.mode === 'smart'
      ? 'تحلیل خودکار: هوشمند (هر کندل ۱ساعته روی زون)'
      : c.auto.mode === 'interval'
        ? `تحلیل خودکار: هر ${c.auto.minutes} دقیقه`
        : 'تحلیل خودکار: خاموش';
  $('#auto-badge').textContent = [auto, c.webhook ? 'هشدار TradingView' : null, c.telegram ? 'تلگرام' : null].filter(Boolean).join(' · ');
}

function renderInstruments() {
  const box = $('#instruments');
  box.textContent = '';
  for (const i of state.config.instruments) {
    const q = state.quotes[i.id] || {};
    const latest = state.latest[i.id];
    const chg = q.change;
    const status = q.status ? Object.values(q.status).map((s) => s && s.status) : [];
    const statusText =
      state.config.dataSource === 'demo'
        ? 'شبیه‌سازی'
        : status.every((s) => s === 'live')
          ? 'متصل'
          : status.some((s) => s === 'error')
            ? 'خطای اتصال'
            : 'در حال اتصال…';
    box.append(
      h(
        'button',
        {
          class: 'inst',
          role: 'radio',
          'aria-checked': String(i.id === state.selected),
          'data-id': i.id,
          onclick: () => select(i.id),
        },
        h('span', { class: 'name' }, i.nameFa),
        latest ? h('span', { class: `action ${latest.action.toLowerCase()}`, style: 'font-size:12px;padding:0 8px' }, ACTION_FA[latest.action]) : h('span'),
        h('span', { class: 'price num' }, price(q.price, i.digits)),
        h(
          'span',
          { class: 'change' },
          chg === null || chg === undefined
            ? ''
            : [h('span', { class: chg >= 0 ? 'arrow-up' : 'arrow-down', 'aria-hidden': 'true' }, chg >= 0 ? '▲ ' : '▼ '), num(`${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`)],
        ),
        h('span', { class: 'status' }, `${i.nameEn} · ${statusText}${q.analyzing ? ' · در حال تحلیل…' : ''}`),
      ),
    );
  }
}

function updateQuotes(prices) {
  for (const [id, q] of Object.entries(prices)) state.quotes[id] = { ...state.quotes[id], ...q };
  renderInstruments();
  const q = state.quotes[state.selected];
  $('#analyze-btn').disabled = Boolean(q && q.analyzing);
}

/* ---------------- signal card ---------------- */

function renderSignal() {
  const box = $('#signal');
  box.textContent = '';
  const s = state.latest[state.selected];
  if (!s) {
    box.append(h('p', { class: 'empty' }, 'هنوز سیگنالی برای این نماد ثبت نشده. «تحلیل تازه» را بزنید.'));
    return;
  }
  const i = inst(s.instrument);
  const src = s.source === 'ai' ? `هوش مصنوعی (${s.model || ''}${s.fallbackUsed ? '، مدل جایگزین' : ''})` : 'موتور قواعد';
  box.append(
    h(
      'div',
      { class: 'signal-top' },
      h('span', { class: `action ${s.action.toLowerCase()}` }, ACTION_FA[s.action], s.orderType !== 'none' ? h('small', {}, ` · ${ORDER_FA[s.orderType]}`) : null),
      h('span', {}, SETUP_FA[s.setup] || s.setup),
    ),
    h('div', { class: 'signal-meta' }, `${src} · ${when(s.createdAt)} · قیمت هنگام تحلیل `, num(price(s.price, i.digits)), s.dataSource === 'demo' ? ' · نمایشی' : ''),
    h('p', { class: 'summary' }, s.summary),
  );

  if (s.action !== 'WAIT') {
    const rows = [
      h('tr', {}, h('th', {}, `ورود (${ORDER_FA[s.orderType]})`), h('td', {}, num(price(s.entry, i.digits)))),
      h('tr', { class: 'sl' }, h('td', {}, 'حد ضرر'), h('td', {}, num(price(s.stopLoss, i.digits)), ' ', h('span', { class: 'muted' }, num(`${s.stopPips} pip`)))),
      ...s.takeProfits.map((tp, k) =>
        h('tr', { class: 'tp' }, h('td', {}, `تارگت ${k + 1}`), h('td', {}, num(price(tp, i.digits)), ' ', h('span', { class: 'muted' }, num(`R:R 1:${s.riskReward[k]}`)))),
      ),
    ];
    box.append(h('table', { class: 'levels-list' }, h('tbody', {}, rows)));
    box.append(h('p', { class: 'muted', style: 'margin:0' }, `ریسک پیشنهادی: ${state.config.riskPercent}٪ سرمایه در این معامله.`));
  }

  box.append(
    h(
      'div',
      { class: 'confidence' },
      'کیفیت ستاپ',
      h('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(s.confidence) }, h('span', { style: `width:${s.confidence}%` })),
      num(`${s.confidence}/100`),
    ),
  );

  if (s.warnings && s.warnings.length) box.append(h('ul', { class: 'warnings' }, s.warnings.map((w) => h('li', {}, w))));

  if (s.checklist && s.checklist.length) {
    box.append(
      h(
        'ul',
        { class: 'checklist', 'aria-label': 'چک‌لیست دوره' },
        s.checklist.map((c) =>
          h(
            'li',
            {},
            h('span', { class: c.ok ? 'ok' : 'no', 'aria-label': c.ok ? 'برقرار' : 'برقرار نیست' }, c.ok ? '✓' : '✗'),
            h('span', {}, c.rule),
            c.note ? h('span', { class: 'note' }, c.note) : null,
          ),
        ),
      ),
    );
  }

  box.append(
    h(
      'details',
      { class: 'reasoning', open: s.source === 'ai' },
      h('summary', {}, 'استدلال'),
      h('p', {}, s.reasoning),
      s.invalidation ? h('p', {}, h('b', {}, 'ابطال: '), s.invalidation) : null,
    ),
  );
}

function renderLiveRead() {
  const r = state.rules;
  const el = $('#live-read');
  el.textContent = '';
  if (!r) return;
  el.append(h('b', {}, 'وضعیت لحظه‌ای (موتور قواعد، ذخیره نمی‌شود): '), `${ACTION_FA[r.action]} — ${r.summary}`);
}

async function analyzeNow() {
  const btn = $('#analyze-btn');
  btn.disabled = true;
  btn.textContent = state.config.ai.enabled ? 'هوش مصنوعی در حال تحلیل…' : 'در حال تحلیل…';
  try {
    const s = await api(`/api/analyze/${state.selected}`, { method: 'POST' });
    state.latest[s.instrument] = s;
    renderSignal();
    renderInstruments();
    drawChart();
  } catch (err) {
    const box = $('#signal');
    const msg = err.status === 429 ? `کمی صبر کنید (${err.body.retryAfter} ثانیه) و دوباره امتحان کنید.` : `تحلیل انجام نشد: ${err.message}`;
    box.prepend(h('ul', { class: 'warnings' }, h('li', {}, msg)));
  } finally {
    btn.disabled = false;
    btn.textContent = 'تحلیل تازه';
  }
}

/* ---------------- market read ---------------- */

async function loadRead() {
  const id = state.selected;
  try {
    const { read, rules } = await api(`/api/analysis/${id}`);
    if (id !== state.selected) return;
    state.read = read;
    state.rules = rules;
  } catch (err) {
    state.read = null;
    state.rules = null;
    $('#read-summary').textContent = err.status === 503 ? 'هنوز داده‌ی کافی از TradingView نرسیده است…' : `خطا: ${err.message}`;
    return;
  }
  renderRead();
  renderLiveRead();
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label));
}

function renderRead() {
  const r = state.read;
  if (!r) return;
  $('#read-time').textContent = `به‌روز: ${when(r.asOf)}`;
  const sum = $('#read-summary');
  sum.textContent = '';
  const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  sum.append(
    stat(num(price(r.price, r.digits)), 'قیمت'),
    stat(num(`${r.atr.structure.pips} pip`), 'ATR روزانه (۲۲)'),
    stat(num(`${r.thDaily.pips} pip`), 'توان حرکتی TH روزانه'),
    stat(num(pct(r.movement.dailyAtrUsed)), 'مصرف گام امروز'),
    stat(num(r.movement.patternSteps === null ? '—' : `${r.movement.patternSteps > 0 ? '+' : ''}${r.movement.patternSteps}`), 'گام ۴ساعته از آخرین پیوت'),
    stat(num(pct(r.location)), 'جایگاه بین حمایت و مقاومت'),
    stat(num(`${r.tolerance.pips} pip`), 'تلورانس'),
  );

  const roleOf = Object.fromEntries(Object.entries(r.roles).map(([role, tf]) => [tf, role]));
  const tfRows = ['W', '1D', '240', '60', '15'].map((id) => {
    const t = r.timeframes[id];
    if (!t) return h('tr', {}, h('td', {}, TF_FA[id]), h('td', { colspan: '6', class: 'muted' }, 'داده‌ی کافی نیست'));
    const last = t.lastCandles[t.lastCandles.length - 1];
    return h(
      'tr',
      {},
      h('td', {}, TF_FA[id]),
      h('td', {}, ROLE_FA[roleOf[id]] || ''),
      h('td', {}, num(`${t.atrPips}`), h('span', { class: 'muted' }, ` (${t.atrPeriod})`)),
      h('td', {}, num(t.atrToTh === null ? '—' : `${Math.round(t.atrToTh * 100)}%`)),
      h('td', {}, STRUCT_FA[t.structure] || t.structure),
      h('td', {}, last ? `${last.dir === 'up' ? '▲' : last.dir === 'down' ? '▼' : '•'} ${SIZE_FA[last.size]}${last.master ? ' · مستر' : ''}` : ''),
      h('td', {}, t.base ? `${t.base.count} کندل` : '—'),
    );
  });
  const tfTable = $('#tf-table');
  tfTable.textContent = '';
  tfTable.append(
    h('thead', {}, h('tr', {}, ['تایم', 'نقش', 'ATR (pip)', 'ATR/TH', 'ساختار', 'آخرین کندل', 'بیس'].map((x) => h('th', {}, x)))),
    h('tbody', {}, tfRows),
  );

  const lv = $('#levels-table');
  lv.textContent = '';
  const row = (l, at) =>
    h(
      'tr',
      { class: at ? 'at-price' : '' },
      h('td', {}, num(`${price(l.zone[0], r.digits)} – ${price(l.zone[1], r.digits)}`)),
      h('td', {}, TF_FA[l.tf]),
      h('td', {}, h('span', { class: `pill ${l.acts}` }, l.acts === 'support' ? 'حمایت S' : 'مقاومت R')),
      h('td', {}, num(String(l.score))),
      h('td', {}, num(String(l.touches))),
      h('td', {}, [l.fresh ? 'تازه' : null, l.flipped ? 'فلیپ' : null, l.type === 'pullback' ? 'پول‌بکی' : null].filter(Boolean).join('، ') || '—'),
      h('td', {}, at ? 'روی قیمت' : num(`${l.distancePips > 0 ? '+' : ''}${l.distancePips}`)),
      h('td', {}, l.confluence.map((x) => TF_FA[x]).join('، ')),
    );
  lv.append(
    h('thead', {}, h('tr', {}, ['زون', 'تایم', 'نقش', 'امتیاز', 'برخورد', 'وضعیت', 'فاصله (pip)', 'هم‌پوشانی'].map((x) => h('th', {}, x)))),
    h(
      'tbody',
      {},
      [...r.levelsAbove].reverse().map((l) => row(l, false)),
      r.levelsAtPrice.map((l) => row(l, true)),
      r.levelsBelow.map((l) => row(l, false)),
    ),
  );
}

/* ---------------- canvas chart ---------------- */

async function loadCandles() {
  const id = state.selected;
  const tf = state.tf;
  try {
    const data = await api(`/api/candles/${id}/${tf}?limit=200`);
    if (id !== state.selected || tf !== state.tf) return;
    state.chart = data;
  } catch {
    state.chart = null;
  }
  drawChart();
}

function niceStep(range, count) {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

function timeLabel(t, tf) {
  const d = new Date(t * 1000);
  const p2 = (x) => String(x).padStart(2, '0');
  if (tf === '1D' || tf === 'W') return `${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}`;
  return `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

function drawChart() {
  const canvas = $('#chart');
  const wrap = canvas.parentElement;
  if (wrap.hidden) return;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const col = {
    surface: css('--surface'),
    ink: css('--ink'),
    ink2: css('--ink-2'),
    muted: css('--muted'),
    grid: css('--grid'),
    axis: css('--axis'),
    up: css('--up'),
    down: css('--down'),
    good: css('--good'),
    critical: css('--critical'),
  };
  ctx.fillStyle = col.surface;
  ctx.fillRect(0, 0, W, H);
  ctx.font = '11px Vazirmatn, Tahoma, system-ui, sans-serif';
  const data = state.chart;
  if (!data || !data.candles.length) {
    ctx.fillStyle = col.muted;
    ctx.textAlign = 'center';
    ctx.fillText('در انتظار داده…', W / 2, H / 2);
    state.geom = null;
    return;
  }

  const padL = 8;
  const padR = 72;
  const padT = 12;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.min(data.candles.length, Math.max(20, Math.floor(plotW / 7)));
  const view = data.candles.slice(-n);
  const step = plotW / n;
  let lo = Math.min(...view.map((c) => c.low));
  let hi = Math.max(...view.map((c) => c.high));
  const span0 = hi - lo || hi * 0.001;

  const sig = state.latest[state.selected];
  const lines = [];
  if (sig && sig.action !== 'WAIT') {
    lines.push({ p: sig.entry, label: 'ورود', color: col.ink, dash: [6, 4] });
    lines.push({ p: sig.stopLoss, label: 'حد ضرر', color: col.critical, dash: [6, 4] });
    sig.takeProfits.forEach((tp, k) => lines.push({ p: tp, label: `تارگت ${k + 1}`, color: col.good, dash: [6, 4] }));
  }
  for (const l of lines) {
    if (l.p >= lo - span0 && l.p <= hi + span0) {
      lo = Math.min(lo, l.p);
      hi = Math.max(hi, l.p);
    }
  }
  const pad = (hi - lo) * 0.06 || hi * 0.0005;
  lo -= pad;
  hi += pad;
  const y = (p) => padT + ((hi - p) / (hi - lo)) * plotH;
  const x = (i) => padL + (i + 0.5) * step;
  const digits = data.digits;

  // Gridlines and price axis.
  const tick = niceStep(hi - lo, 6);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil(lo / tick) * tick; v <= hi; v += tick) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(padL + plotW, yy);
    ctx.stroke();
    ctx.fillStyle = col.muted;
    ctx.fillText(v.toFixed(digits), padL + plotW + 8, yy);
  }

  // Zones: strongest first, at most eight on screen.
  const zones = data.zones
    .filter((z) => z.zone[1] >= lo && z.zone[0] <= hi)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  for (const z of zones) {
    const c = z.acts === 'support' ? col.up : col.down;
    const top = y(Math.min(z.zone[1], hi));
    const bot = y(Math.max(z.zone[0], lo));
    ctx.globalAlpha = z.fresh ? 0.16 : 0.1;
    ctx.fillStyle = c;
    ctx.fillRect(padL, top, plotW, Math.max(2, bot - top));
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(top) + 0.5);
    ctx.lineTo(padL + plotW, Math.round(top) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const label = `${z.acts === 'support' ? 'S' : 'R'} ${state.config.timeframes.find((t) => t.id === z.tf)?.label || z.tf} · ${z.score}`;
    ctx.fillStyle = col.surface;
    ctx.fillRect(padL + 2, top - 15, ctx.measureText(label).width + 6, 14);
    ctx.fillStyle = col.ink2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, padL + 5, top - 2);
  }

  // Candles: hollow bodies up, filled bodies down.
  const bodyW = Math.max(1, Math.min(10, step * 0.62));
  view.forEach((c, i) => {
    const up = c.close >= c.open;
    const color = up ? col.up : col.down;
    const cx = Math.round(x(i)) + 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, y(c.high));
    ctx.lineTo(cx, y(Math.max(c.open, c.close)));
    ctx.moveTo(cx, y(Math.min(c.open, c.close)));
    ctx.lineTo(cx, y(c.low));
    ctx.stroke();
    const top = y(Math.max(c.open, c.close));
    const hgt = Math.max(1, y(Math.min(c.open, c.close)) - top);
    if (up && bodyW >= 3) {
      ctx.lineWidth = 1.25;
      ctx.strokeRect(Math.round(cx - bodyW / 2) + 0.5, Math.round(top) + 0.5, Math.round(bodyW) - 1, Math.max(1, Math.round(hgt) - 1));
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(cx - bodyW / 2), top, Math.round(bodyW), hgt);
    }
  });

  // Signal lines with their labels (label text in ink, the line carries color).
  ctx.lineWidth = 1.5;
  for (const l of lines) {
    if (l.p < lo || l.p > hi) continue;
    const yy = Math.round(y(l.p)) + 0.5;
    ctx.strokeStyle = l.color;
    ctx.setLineDash(l.dash);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(padL + plotW, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    const text = `${l.label} ${l.p.toFixed(digits)}`;
    const tw = ctx.measureText(text).width + 12;
    const bx = padL + plotW - tw - 8;
    ctx.fillStyle = col.surface;
    ctx.fillRect(bx, yy - 9, tw, 18);
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, yy - 8.5, tw - 1, 17);
    ctx.fillStyle = col.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + tw / 2, yy);
    ctx.lineWidth = 1.5;
  }

  // Last price tag on the axis.
  const last = view[view.length - 1];
  const ly = Math.round(y(last.close)) + 0.5;
  ctx.strokeStyle = col.ink2;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(padL, ly);
  ctx.lineTo(padL + plotW, ly);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = col.ink;
  ctx.fillRect(padL + plotW + 2, ly - 9, padR - 4, 18);
  ctx.fillStyle = col.surface;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(last.close.toFixed(digits), padL + plotW + 8, ly);

  // Time axis.
  ctx.fillStyle = col.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const every = Math.max(1, Math.round(110 / step));
  for (let i = view.length - 1; i >= 0; i -= every) ctx.fillText(timeLabel(view[i].time, state.tf), x(i), padT + plotH + 8);
  ctx.strokeStyle = col.axis;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH + 0.5);
  ctx.lineTo(padL + plotW, padT + plotH + 0.5);
  ctx.stroke();

  state.geom = { view, step, padL, padT, plotW, plotH, x, y, digits };

  // Crosshair on the hovered candle.
  if (state.hover !== null && state.hover < view.length) {
    const cx = Math.round(x(state.hover)) + 0.5;
    ctx.strokeStyle = col.ink2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, padT);
    ctx.lineTo(cx, padT + plotH);
    ctx.stroke();
  }
}

function showTooltip(idx, px, py) {
  const g = state.geom;
  const tip = $('#tooltip');
  if (!g || idx === null) {
    tip.hidden = true;
    return;
  }
  const c = g.view[idx];
  const d = g.digits;
  const pipSize = inst().pip;
  tip.textContent = '';
  tip.append(
    h('div', { class: 't' }, `${timeLabel(c.time, state.tf)} UTC`),
    h('div', {}, 'O ', h('b', {}, c.open.toFixed(d)), '  H ', h('b', {}, c.high.toFixed(d))),
    h('div', {}, 'L ', h('b', {}, c.low.toFixed(d)), '  C ', h('b', {}, c.close.toFixed(d))),
    h('div', { class: 't' }, `range ${((c.high - c.low) / pipSize).toFixed(1)} pip`),
  );
  tip.hidden = false;
  const wrap = $('#chart').parentElement;
  const left = Math.min(px + 14, wrap.clientWidth - tip.offsetWidth - 4);
  tip.style.left = `${left < 4 ? 4 : left}px`;
  tip.style.top = `${Math.max(4, Math.min(py + 14, wrap.clientHeight - tip.offsetHeight - 4))}px`;
}

function setupChartHover() {
  const canvas = $('#chart');
  canvas.tabIndex = 0;
  const pick = (ev) => {
    const g = state.geom;
    if (!g) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    if (px < g.padL || px > g.padL + g.plotW) return null;
    return { idx: Math.min(g.view.length - 1, Math.max(0, Math.floor((px - g.padL) / g.step))), px, py };
  };
  canvas.addEventListener('pointermove', (ev) => {
    const p = pick(ev);
    state.hover = p ? p.idx : null;
    drawChart();
    showTooltip(p ? p.idx : null, p ? p.px : 0, p ? p.py : 0);
  });
  canvas.addEventListener('pointerleave', () => {
    state.hover = null;
    drawChart();
    showTooltip(null);
  });
  canvas.addEventListener('keydown', (ev) => {
    const g = state.geom;
    if (!g || !['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    ev.preventDefault();
    const cur = state.hover === null ? g.view.length - 1 : state.hover;
    state.hover = Math.min(g.view.length - 1, Math.max(0, cur + (ev.key === 'ArrowRight' ? 1 : -1)));
    drawChart();
    showTooltip(state.hover, g.x(state.hover), g.padT + 8);
  });
  canvas.addEventListener('blur', () => {
    state.hover = null;
    showTooltip(null);
    drawChart();
  });
  new ResizeObserver(() => drawChart()).observe(canvas.parentElement);
}

/* ---------------- TradingView widget ---------------- */

let tvScript = null;
function loadTvScript() {
  if (!tvScript) {
    tvScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://s3.tradingview.com/tv.js';
      s.onload = resolve;
      s.onerror = () => {
        tvScript = null;
        reject(new Error('blocked'));
      };
      document.head.append(s);
    });
  }
  return tvScript;
}

async function renderTradingView() {
  const box = $('#tv-container');
  box.textContent = '';
  const id = `tv_${Date.now()}`;
  box.append(h('div', { id, style: 'height:100%' }));
  try {
    await loadTvScript();
    // eslint-disable-next-line no-undef
    new TradingView.widget({
      container_id: id,
      autosize: true,
      symbol: inst().tvSymbol,
      interval: TV_INTERVAL[state.tf],
      timezone: 'Etc/UTC',
      theme: isDark() ? 'dark' : 'light',
      style: '1',
      locale: 'fa_IR',
      allow_symbol_change: false,
      withdateranges: true,
    });
  } catch {
    box.textContent = 'بارگذاری ویجت TradingView ممکن نشد (ممکن است در شبکه‌ی شما مسدود باشد). نمودار سطوح دوره همچنان کار می‌کند.';
  }
}

function setChartMode(mode) {
  state.chartMode = mode;
  for (const b of document.querySelectorAll('[data-chart]')) b.setAttribute('aria-selected', String(b.dataset.chart === mode));
  $('#chart-levels').hidden = mode !== 'levels';
  $('#chart-tv').hidden = mode !== 'tv';
  if (mode === 'tv') renderTradingView();
  else drawChart();
}

function renderTfButtons() {
  const box = $('#tf-buttons');
  box.textContent = '';
  for (const t of state.config.timeframes) {
    box.append(
      h(
        'button',
        {
          'aria-selected': String(t.id === state.tf),
          onclick: () => {
            state.tf = t.id;
            renderTfButtons();
            if (state.chartMode === 'tv') renderTradingView();
            loadCandles();
          },
        },
        t.label,
      ),
    );
  }
}

/* ---------------- selection ---------------- */

function select(id) {
  state.selected = id;
  state.chart = null;
  state.read = null;
  state.rules = null;
  state.hover = null;
  renderInstruments();
  renderSignal();
  renderLiveRead();
  if (state.chartMode === 'tv') renderTradingView();
  loadCandles();
  loadRead();
}

/* ---------------- knowledge ---------------- */

function kb(bytes) {
  if (!bytes) return '0 KB';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function loadKnowledge() {
  const k = await api('/api/knowledge');
  $('#rulebook').value = k.rulebook.text;
  $('#rulebook-state').textContent = k.rulebook.custom ? 'نسخه‌ی ویرایش‌شده‌ی شما' : 'متن پیش‌فرض (خلاصه‌ی دوره)';
  const u = k.usage;
  $('#budget').textContent = `فعال: ${kb(u.bytes)} از ${kb(u.maxBytes)} فایل · ${u.chars.toLocaleString('en')} از ${u.maxChars.toLocaleString('en')} نویسه متن`;
  const table = $('#tutorials-table');
  table.textContent = '';
  if (!k.tutorials.length) {
    table.append(h('tbody', {}, h('tr', {}, h('td', { class: 'muted' }, 'هنوز آموزشی اضافه نشده است.'))));
    return;
  }
  table.append(
    h('thead', {}, h('tr', {}, ['فایل', 'نوع', 'اندازه', 'فعال در تحلیل', ''].map((x) => h('th', {}, x)))),
    h(
      'tbody',
      {},
      k.tutorials.map((t) =>
        h(
          'tr',
          {},
          h('td', { class: 'wrap' }, t.name),
          h('td', {}, t.kind === 'pdf' ? 'PDF' : t.kind === 'image' ? 'تصویر' : 'متن'),
          h('td', {}, num(t.kind === 'text' ? `${t.chars.toLocaleString('en')} chars` : kb(t.bytes))),
          h(
            'td',
            {},
            h('input', {
              type: 'checkbox',
              checked: t.active,
              'aria-label': `فعال بودن ${t.name}`,
              onchange: async (ev) => {
                try {
                  await api(`/api/tutorials/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: ev.target.checked }) });
                } catch (err) {
                  $('#upload-status').textContent = err.status === 409 ? 'فعال‌کردن این فایل از سقف حجم آموزش‌ها بیشتر می‌شود؛ ابتدا فایل دیگری را غیرفعال کنید.' : err.message;
                }
                loadKnowledge();
              },
            }),
          ),
          h(
            'td',
            {},
            h(
              'button',
              {
                class: 'link-btn',
                type: 'button',
                onclick: async () => {
                  if (!confirm(`«${t.name}» حذف شود؟`)) return;
                  await api(`/api/tutorials/${t.id}`, { method: 'DELETE' });
                  loadKnowledge();
                },
              },
              'حذف',
            ),
          ),
        ),
      ),
    ),
  );
}

async function upload(files) {
  const status = $('#upload-status');
  for (const file of files) {
    status.textContent = `در حال بارگذاری ${file.name}…`;
    try {
      const item = await api('/api/tutorials', {
        method: 'POST',
        headers: { 'x-file-name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      status.textContent = item.active
        ? `«${item.name}» اضافه شد.`
        : `«${item.name}» ذخیره شد ولی به‌خاطر سقف حجم غیرفعال است.`;
    } catch (err) {
      status.textContent = `«${file.name}»: ${err.message}`;
    }
  }
  loadKnowledge();
}

function setupKnowledge() {
  const zone = $('#dropzone');
  $('#file-input').addEventListener('change', (ev) => {
    upload([...ev.target.files]);
    ev.target.value = '';
  });
  zone.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (ev) => {
    ev.preventDefault();
    zone.classList.remove('over');
    upload([...ev.dataTransfer.files]);
  });
  const save = async (text) => {
    const st = $('#rulebook-status');
    try {
      await api('/api/knowledge/rulebook', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      st.textContent = 'ذخیره شد.';
    } catch (err) {
      st.textContent = err.message;
    }
    loadKnowledge();
  };
  $('#save-rulebook').addEventListener('click', () => save($('#rulebook').value));
  $('#reset-rulebook').addEventListener('click', () => {
    if (confirm('متن ویرایش‌شده حذف و متن پیش‌فرض برگردانده شود؟')) save('');
  });
}

/* ---------------- history ---------------- */

async function loadHistory() {
  const q = state.historyFilter ? `&instrument=${state.historyFilter}` : '';
  const rows = await api(`/api/signals?limit=100${q}`);
  const table = $('#history-table');
  table.textContent = '';
  if (!rows.length) {
    table.append(h('tbody', {}, h('tr', {}, h('td', { class: 'muted' }, 'هنوز سیگنالی ثبت نشده است.'))));
    return;
  }
  table.append(
    h('thead', {}, h('tr', {}, ['زمان', 'نماد', 'سیگنال', 'ورود', 'حد ضرر', 'تارگت‌ها', 'R:R', 'منبع', 'کیفیت', 'خلاصه'].map((x) => h('th', {}, x)))),
    h(
      'tbody',
      {},
      rows.map((s) => {
        const d = inst(s.instrument).digits;
        return h(
          'tr',
          {},
          h('td', {}, when(s.createdAt)),
          h('td', {}, inst(s.instrument).nameEn),
          h('td', {}, h('span', { class: `action ${s.action.toLowerCase()}`, style: 'font-size:12px;padding:0 8px' }, ACTION_FA[s.action])),
          h('td', {}, num(price(s.entry, d))),
          h('td', {}, num(price(s.stopLoss, d))),
          h('td', {}, num(s.takeProfits.map((x) => price(x, d)).join(' / ') || '—')),
          h('td', {}, num(s.riskReward.length ? s.riskReward.join(' / ') : '—')),
          h('td', {}, s.source === 'ai' ? 'هوش مصنوعی' : 'قواعد'),
          h('td', {}, num(String(s.confidence))),
          h('td', { class: 'wrap' }, s.summary),
        );
      }),
    ),
  );
}

/* ---------------- views, theme, stream ---------------- */

function showView(view) {
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  for (const v of ['dashboard', 'knowledge', 'history']) $(`#view-${v}`).hidden = v !== view;
  if (view === 'knowledge') loadKnowledge();
  if (view === 'history') loadHistory();
  if (view === 'dashboard') drawChart();
}

function setupTheme() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.dataset.theme = saved;
  } catch {
    // storage unavailable: follow the OS theme
  }
  $('#theme-toggle').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // not remembered, still applied
    }
    drawChart();
    if (state.chartMode === 'tv') renderTradingView();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawChart());
}

function connectStream() {
  const es = new EventSource('/api/stream');
  let lastCandleFetch = 0;
  es.addEventListener('prices', (ev) => {
    updateQuotes(JSON.parse(ev.data));
    if (state.chartMode === 'levels' && Date.now() - lastCandleFetch > 5000 && !$('#view-dashboard').hidden) {
      lastCandleFetch = Date.now();
      loadCandles();
    }
  });
  es.addEventListener('signal', (ev) => {
    const s = JSON.parse(ev.data);
    state.latest[s.instrument] = s;
    renderInstruments();
    if (s.instrument === state.selected) {
      renderSignal();
      drawChart();
    }
    if (!$('#view-history').hidden) loadHistory();
  });
}

async function init() {
  setupTheme();
  state.config = await api('/api/config');
  renderBadges();
  const st = await api('/api/state');
  for (const i of st.instruments) {
    state.quotes[i.id] = { price: i.price, change: i.change, time: i.time, status: i.status, analyzing: i.analyzing };
    if (i.latest) state.latest[i.id] = i.latest;
  }
  const filter = $('#history-filter');
  filter.append(h('option', { value: '' }, 'همه‌ی نمادها'), ...state.config.instruments.map((i) => h('option', { value: i.id }, i.nameFa)));
  filter.addEventListener('change', () => {
    state.historyFilter = filter.value;
    loadHistory();
  });
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => showView(b.dataset.view));
  for (const b of document.querySelectorAll('[data-chart]')) b.addEventListener('click', () => setChartMode(b.dataset.chart));
  $('#analyze-btn').addEventListener('click', analyzeNow);
  renderTfButtons();
  setupChartHover();
  setupKnowledge();
  select(state.config.instruments[0].id);
  connectStream();
  setInterval(() => {
    if (!$('#view-dashboard').hidden) loadRead();
  }, 30_000);
  // Refresh statuses (connection state per timeframe) now and then.
  setInterval(async () => {
    try {
      const s = await api('/api/state');
      for (const i of s.instruments) state.quotes[i.id] = { ...state.quotes[i.id], status: i.status };
      renderInstruments();
    } catch {
      // next tick
    }
  }, 15_000);
}

init().catch((err) => {
  document.querySelector('main').prepend(h('p', { class: 'warnings' }, `بارگذاری برنامه ممکن نشد: ${err.message}`));
});
