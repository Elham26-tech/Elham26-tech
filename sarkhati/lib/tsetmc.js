'use strict';

// فهرست کل نمادهای بازار را یک‌بار از TSETMC می‌گیرد تا جست‌وجو محلی و آنی
// باشد — بدون رفت‌وبرگشت شبکه به ازای هر حرفی که تایپ می‌شود.
//
// اینجا فقط نام و کد نماد و قیمت‌های تابلو گرفته می‌شود. سقف و کف مجاز از
// خودِ کارگزار می‌آید (lib/limits.js)، چون مرجع واقعی همان است.

const ISIN = /^IR[A-Z0-9]{10}$/;
const INDEX_ISIN = /^IRX/; // شاخص‌ها، نه سهم

// نشانی‌ها به ترتیب امتحان می‌شوند. ترتیب از روی اندازه‌گیری واقعی روی
// اینترنت ایران است: cdn کامل‌ترین پاسخ را می‌دهد و old هم معمولاً باز است.
const DEFAULT_URLS = [
  'https://cdn.tsetmc.com/api/ClosingPrice/GetMarketWatch?market=0'
    + '&paperTypes[0]=1&paperTypes[1]=2&paperTypes[2]=3&paperTypes[3]=4'
    + '&paperTypes[4]=5&paperTypes[5]=6&paperTypes[6]=7&paperTypes[7]=8'
    + '&paperTypes[8]=9&showTraded=false&withBestLimits=false&hEven=0&RefID=0',
  'https://old.tsetmc.com/tsev2/data/MarketWatchPlus.aspx?h=0&r=0',
  'https://main.tsetmc.com/tsev2/data/MarketWatchPlus.aspx?h=0&r=0',
  'https://tsetmc.ir/tsev2/data/MarketWatchPlus.aspx?h=0&r=0',
  'http://www.tsetmc.com/tsev2/data/MarketWatchPlus.aspx?h=0&r=0',
];

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    + ' (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fa,en;q=0.8',
};

const LAST_KEY = /^(pdrcotval|lasttradedprice|last|pl|pdr)$/i;
const CLOSING_KEY = /^(pclosing|closingprice|pc|closing)$/i;
const YESTERDAY_KEY = /^(priceyesterday|pricey|py|yesterdayprice|pcy)$/i;
const SYMBOL_KEY = /^(lval18afc|lval18|symbol|sym)$/i;
const NAME_KEY = /^(lval30|name|title|fullname)$/i;
const INSCODE_KEY = /^(inscode|code|id)$/i;

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

/** یک شیء JSON را به یک ردیف نماد تبدیل می‌کند، اگر ISIN داشته باشد */
function rowFromObject(object) {
  let isin = null;
  let symbol = '';
  let name = '';
  const price = { last: null, closing: null, yesterday: null };
  let insCode = '';

  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'string' && ISIN.test(value.trim())) {
      if (!isin) isin = value.trim();
      continue;
    }
    if (typeof value === 'string') {
      if (!symbol && SYMBOL_KEY.test(key)) symbol = value.trim();
      else if (!name && NAME_KEY.test(key)) name = value.trim();
      else if (!insCode && INSCODE_KEY.test(key)) insCode = value.trim();
      continue;
    }
    const number = toNumber(value);
    if (number === null) continue;
    if (!insCode && INSCODE_KEY.test(key)) insCode = String(value);
    if (LAST_KEY.test(key)) price.last = number;
    else if (CLOSING_KEY.test(key)) price.closing = number;
    else if (YESTERDAY_KEY.test(key)) price.yesterday = number;
  }

  if (!isin || !symbol || INDEX_ISIN.test(isin)) return null;
  return { isin, symbol, name, insCode, ...price };
}

/** شکل تازهٔ پاسخ: JSON تودرتو */
function parseJson(body) {
  let decoded;
  try { decoded = JSON.parse(body); } catch { return []; }

  const rows = [];
  const seen = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return undefined;
    const row = rowFromObject(value);
    if (row && !seen.has(row.isin)) {
      seen.add(row.isin);
      rows.push(row);
    }
    return Object.values(value).forEach(walk);
  };
  walk(decoded);
  return rows;
}

/**
 * شکل قدیمی و متنی. به‌جای تکیه بر شمارهٔ ستون، اول ISIN را با الگو پیدا
 * می‌کنیم و از روی آن جلو می‌رویم؛ اگر روزی ستونی اضافه شود، نمی‌شکند.
 */
function parseText(body) {
  const rows = [];
  const seen = new Set();

  for (const section of String(body).split('@')) {
    for (const record of section.split(';')) {
      const fields = record.split(',');
      if (fields.length < 5) continue;

      const isinAt = fields.findIndex((field) => ISIN.test(field.trim()));
      if (isinAt < 0 || isinAt + 2 >= fields.length) continue;

      const isin = fields[isinAt].trim();
      const symbol = fields[isinAt + 1].trim();
      const name = fields[isinAt + 2].trim();
      if (!symbol || seen.has(isin) || INDEX_ISIN.test(isin)) continue;
      seen.add(isin);

      const numbers = [];
      for (const field of fields.slice(isinAt + 3)) {
        const number = toNumber(field);
        if (number === null) break;
        numbers.push(number);
      }

      rows.push({
        isin,
        symbol,
        name,
        insCode: '',
        last: numbers.length > 1 ? numbers[1] : null,
        closing: numbers.length > 2 ? numbers[2] : null,
        yesterday: numbers.length >= 3 ? numbers[numbers.length - 1] : null,
      });
    }
  }
  return rows;
}

function parse(body) {
  const trimmed = String(body).trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? parseJson(trimmed) : parseText(trimmed);
}

/** فهرست کل بازار را از اولین نشانیِ پاسخ‌ده می‌گیرد */
async function fetchMarketWatch({ urls = DEFAULT_URLS, timeoutMs = 20000 } = {}) {
  const tried = [];
  for (const url of urls) {
    const startedAt = Date.now();
    try {
      const body = await fetchText(url, timeoutMs);
      const rows = parse(body);
      tried.push({ url, ok: rows.length > 0, symbols: rows.length, ms: Date.now() - startedAt });
      if (rows.length) return { rows, url, tried };
    } catch (err) {
      tried.push({ url, ok: false, error: err.message, ms: Date.now() - startedAt });
    }
  }
  const reasons = tried.map((t) => `${new URL(t.url).hostname}: ${t.error || 'نمادی نداشت'}`).join(' | ');
  throw new Error(`هیچ‌کدام از نشانی‌های TSETMC پاسخ ندادند — ${reasons}`);
}

/** جست‌وجوی محلی روی فهرستی که از قبل گرفته شده */
function search(rows, term, limit = 20) {
  const needle = String(term || '').trim();
  if (!needle) return [];

  const exact = [];
  const starts = [];
  const contains = [];
  for (const row of rows) {
    if (row.symbol === needle) exact.push(row);
    else if (row.symbol.startsWith(needle)) starts.push(row);
    else if (row.symbol.includes(needle) || row.name.includes(needle)) contains.push(row);
    if (exact.length + starts.length >= limit) break;
  }
  return [...exact, ...starts, ...contains].slice(0, limit);
}

module.exports = { DEFAULT_URLS, fetchMarketWatch, search, parse, parseJson, parseText, rowFromObject };
