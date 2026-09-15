'use strict';

// جست‌وجوی نماد و گرفتن سقف/کف مجاز از tsetmc.com
//
// نکتهٔ طراحی: نام فیلدهای TSETMC گاهی عوض می‌شود، پس هیچ‌جا به نام یا
// شمارهٔ ثابتِ فیلد تکیه نمی‌کنیم. مقدارها با الگوی نام و با منطق «بزرگ‌ترین
// و کوچک‌ترین عددِ شیءِ آستانه» پیدا می‌شوند، و پاسخ خام هم نگه داشته
// می‌شود تا اگر چیزی نخواند بشود دیدش.

const CDN = 'https://cdn.tsetmc.com/api';
const LEGACY = 'http://www.tsetmc.com/tsev2/data';

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  accept: 'application/json, text/plain, */*',
};

const ISIN = /^IR[A-Z0-9]{10}$/;

async function getText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, timeoutMs) {
  return JSON.parse(await getText(url, timeoutMs));
}

// ---- جست‌وجو ----------------------------------------------------------

/** پاسخ JSON جست‌وجوی TSETMC را به فهرست نماد تبدیل می‌کند */
function parseSearchJson(json) {
  const rows = (json && (json.instrumentSearch || json.InstrumentSearch)) || [];
  return rows.map((row) => ({
    symbol: String(row.lVal18AFC || row.LVal18AFC || '').trim(),
    name: String(row.lVal30 || row.LVal30 || '').trim(),
    insCode: String(row.insCode || row.InsCode || '').trim(),
    active: Number(row.lastDate || row.LastDate || 0) > 0,
  })).filter((row) => row.symbol && row.insCode);
}

/** پاسخ متنیِ سرویس قدیمی: رکوردها با «؛» و فیلدها با «،» جدا می‌شوند */
function parseSearchLegacy(text) {
  return String(text).split(';')
    .map((record) => record.split(','))
    .filter((parts) => parts.length >= 3 && parts[0] && parts[2])
    .map((parts) => ({
      symbol: parts[0].trim(),
      name: (parts[1] || '').trim(),
      insCode: parts[2].trim(),
      active: parts[7] !== '0',
    }));
}

async function search(query) {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return { rows: [], source: null };
  try {
    const json = await getJson(`${CDN}/Instrument/GetInstrumentSearch/${q}`);
    const rows = parseSearchJson(json);
    if (rows.length) return { rows, source: 'cdn' };
  } catch { /* سرویس قدیمی را امتحان می‌کنیم */ }

  const text = await getText(`${LEGACY}/search.aspx?skey=${q}`);
  return { rows: parseSearchLegacy(text), source: 'legacy' };
}

// ---- سقف و کف --------------------------------------------------------

/** همهٔ زوج‌های کلید/مقدار یک شیء تودرتو */
function flatten(value, prefix = '', out = {}) {
  if (value === null || typeof value !== 'object') {
    out[prefix] = value;
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    flatten(item, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/** اولین مقدار عددیِ مثبت که کلیدش با الگو می‌خواند */
function pickNumber(flat, pattern) {
  for (const [key, value] of Object.entries(flat)) {
    const leaf = key.split('.').pop();
    if (!pattern.test(leaf)) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function pickIsin(flat) {
  for (const value of Object.values(flat)) {
    if (typeof value === 'string' && ISIN.test(value.trim())) return value.trim();
  }
  return null;
}

/**
 * از شیء آستانهٔ TSETMC، سقف و کف را بدون تکیه بر نام فیلد درمی‌آورد:
 * شناسه‌ها (insCode و تاریخ) کنار گذاشته می‌شوند و از باقی اعداد،
 * بزرگ‌ترین = سقف و کوچک‌ترین = کف.
 */
function thresholdsFromObject(obj) {
  const skip = /(inscode|deven|dateen|idn|id)$/i;
  const numbers = Object.entries(obj || {})
    .filter(([key, value]) => !skip.test(key) && Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([, value]) => Number(value));
  if (numbers.length < 2) return { max: null, min: null };
  return { max: Math.max(...numbers), min: Math.min(...numbers) };
}

function todayStamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/**
 * سقف/کف قیمت مجاز، و در صورت وجود حداقل/حداکثر تعداد هر سفارش.
 * اگر TSETMC آستانه نداد، از قیمت پایانی دیروز و درصد دامنه تخمین می‌زند
 * و نتیجه را «تخمینی» علامت می‌گذارد.
 */
async function limits(insCode, { rangePercent = 5 } = {}) {
  const code = String(insCode || '').trim();
  if (!code) throw new Error('کد نماد (insCode) لازم است.');

  const raw = {};
  let priceMax = null;
  let priceMin = null;
  let estimated = false;

  try {
    const json = await getJson(`${CDN}/Instrument/GetStaticThreshold/${code}/${todayStamp()}`);
    raw.threshold = json;
    const list = json.staticThreshold || json.StaticThreshold || [];
    const found = list.map(thresholdsFromObject).find((t) => t.max && t.min);
    if (found) {
      priceMax = found.max;
      priceMin = found.min;
    }
  } catch (err) {
    raw.thresholdError = err.message;
  }

  let info = {};
  try {
    info = await getJson(`${CDN}/Instrument/GetInstrumentInfo/${code}`);
    raw.info = info;
  } catch (err) {
    raw.infoError = err.message;
  }

  let closing = {};
  try {
    closing = await getJson(`${CDN}/ClosingPrice/GetClosingPriceInfo/${code}`);
    raw.closing = closing;
  } catch (err) {
    raw.closingError = err.message;
  }

  const flatInfo = flatten(info);
  const flatClosing = flatten(closing);

  const yesterday = pickNumber(flatClosing, /^(priceYesterday|pricey|pClosing)$/i)
    || pickNumber(flatInfo, /^(priceYesterday|pricey)$/i);

  if ((!priceMax || !priceMin) && yesterday) {
    const span = (yesterday * rangePercent) / 100;
    priceMax = Math.round(yesterday + span);
    priceMin = Math.round(yesterday - span);
    estimated = true;
  }

  return {
    insCode: code,
    isin: pickIsin(flatInfo),
    symbol: (info.instrumentInfo && info.instrumentInfo.lVal18AFC) || null,
    name: (info.instrumentInfo && info.instrumentInfo.lVal30) || null,
    priceMax,
    priceMin,
    estimated,
    yesterdayPrice: yesterday || null,
    lastPrice: pickNumber(flatClosing, /^(pDrCotVal|lastPrice)$/i),
    maxQuantity: pickNumber(flatInfo, /^(maxOrderQty|maxOrderQuantity|maxQty)$/i),
    minQuantity: pickNumber(flatInfo, /^(minOrderQty|minOrderQuantity|minQty)$/i),
    baseVolume: pickNumber(flatInfo, /^(baseVol|baseVolume)$/i),
    raw,
  };
}

module.exports = {
  search,
  limits,
  parseSearchJson,
  parseSearchLegacy,
  thresholdsFromObject,
  flatten,
  pickNumber,
  pickIsin,
  todayStamp,
};
