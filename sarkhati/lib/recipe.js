'use strict';

// --- باگ ۲، از ریشه ----------------------------------------------------
// دیگر قالب فیلدها (Side و بقیه) حدس زده نمی‌شود. برنامه سفارشی را که
// خودتان یک بار دستی داخل ایزی‌تریدر ثبت می‌کنید می‌بیند و همان درخواست
// واقعی — با همان نام فیلدها و همان مقدار Side که کارگزاری پذیرفته — را
// به‌عنوان «دستور» نگه می‌دارد. خطای «Order.Side سفارش معتبر نمی‌باشد»
// وقتی رخ می‌داد که این مقدار ساختگی بود.
// -----------------------------------------------------------------------

const ORDER_URL = /(order|سفارش|trade|deal)/i;

// هدرهایی که نباید تکرار شوند (مرورگر خودش می‌سازدشان یا منقضی می‌شوند)
const VOLATILE_HEADERS = new Set([
  'host', 'content-length', 'connection', 'cookie', 'origin', 'referer',
  'accept-encoding', 'user-agent', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
]);

const FIELD_HINTS = {
  side: /^(side|orderside|ordertype|buysell|tradeside|type)$/i,
  quantity: /^(quantity|qty|count|volume|amount|ordercount|sharecount)$/i,
  price: /^(price|orderprice|limitprice|unitprice)$/i,
  symbol: /^(isin|symbol|instrument|instrumentid|symbolisin|ins(code)?)$/i,
};

function cleanHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (VOLATILE_HEADERS.has(key.toLowerCase())) continue;
    if (key.startsWith(':')) continue;
    out[key] = value;
  }
  return out;
}

/** همهٔ مسیرهای برگ در یک شیء JSON، مثل ["order","price"] */
function walk(value, prefix = []) {
  if (value === null || typeof value !== 'object') return [[prefix, value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => walk(item, [...prefix, String(i)]));
  }
  return Object.entries(value).flatMap(([key, item]) => walk(item, [...prefix, key]));
}

function getPath(obj, pathParts) {
  return pathParts.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function setPath(obj, pathParts, value) {
  let cursor = obj;
  for (let i = 0; i < pathParts.length - 1; i += 1) cursor = cursor[pathParts[i]];
  cursor[pathParts[pathParts.length - 1]] = value;
}

/** نقشهٔ فیلدهای مهم داخل بدنهٔ سفارشِ یادگرفته‌شده */
function mapFields(parsedBody) {
  const fields = {};
  if (!parsedBody || typeof parsedBody !== 'object') return fields;
  for (const [pathParts, value] of walk(parsedBody)) {
    const leaf = pathParts[pathParts.length - 1];
    for (const [name, pattern] of Object.entries(FIELD_HINTS)) {
      if (!fields[name] && pattern.test(leaf)) {
        fields[name] = { path: pathParts, sample: value };
      }
    }
  }
  return fields;
}

/** آیا این درخواستِ ضبط‌شده یک ثبت سفارش است؟ */
function looksLikeOrder(request) {
  const method = String(request.method || '').toUpperCase();
  if (method !== 'POST' && method !== 'PUT') return false;
  if (ORDER_URL.test(request.url || '')) return true;
  if (!request.postData) return false;
  try {
    const fields = mapFields(JSON.parse(request.postData));
    return Boolean(fields.side && fields.quantity);
  } catch {
    return false;
  }
}

/** از یک درخواست ضبط‌شده، دستور قابل تکرار می‌سازد */
function fromRequest(request, response = {}) {
  let parsed = null;
  try { parsed = JSON.parse(request.postData); } catch { parsed = null; }

  return {
    method: String(request.method || 'POST').toUpperCase(),
    url: request.url,
    headers: cleanHeaders(request.headers),
    rawBody: request.postData || null,
    parsedBody: parsed,
    fields: mapFields(parsed),
    json: Boolean(parsed),
    learnedAt: new Date().toISOString(),
    acceptedStatus: response.status || null,
    label: describe(parsed, request.url),
  };
}

function describe(parsed, url) {
  const fields = mapFields(parsed);
  const parts = [];
  if (fields.symbol) parts.push(`نماد ${fields.symbol.sample}`);
  if (fields.side) parts.push(`نوع ${fields.side.sample}`);
  if (fields.quantity) parts.push(`تعداد ${fields.quantity.sample}`);
  if (fields.price) parts.push(`قیمت ${fields.price.sample}`);
  return parts.length ? parts.join('، ') : new URL(url).pathname;
}

/**
 * دستور یادگرفته‌شده را با تعداد/قیمت/نمادِ دلخواه امروز آماده می‌کند.
 * فیلد Side دست‌نخورده می‌ماند — دقیقاً همان مقداری که کارگزاری پذیرفته بود.
 */
function build(recipe, overrides = {}) {
  if (!recipe) throw new Error('هنوز هیچ سفارشی یاد گرفته نشده است.');
  if (!recipe.json) {
    return { method: recipe.method, url: recipe.url, headers: recipe.headers, body: recipe.rawBody };
  }

  const body = JSON.parse(JSON.stringify(recipe.parsedBody));
  const applied = {};

  for (const name of ['quantity', 'price', 'symbol']) {
    const field = recipe.fields[name];
    const value = overrides[name];
    if (!field || value == null || value === '') continue;
    const numeric = typeof field.sample === 'number';
    setPath(body, field.path, numeric ? Number(value) : String(value));
    applied[name] = getPath(body, field.path);
  }

  return {
    method: recipe.method,
    url: recipe.url,
    headers: { 'content-type': 'application/json', ...recipe.headers },
    body: JSON.stringify(body),
    applied,
  };
}

/** بررسی اینکه دستور آمادهٔ اجراست */
function validate(recipe, overrides = {}) {
  const problems = [];
  if (!recipe) {
    problems.push('هنوز سفارشی یاد گرفته نشده — یک بار دستی داخل ایزی‌تریدر سفارش بزنید.');
    return { ok: false, problems };
  }
  if (!recipe.fields.side) {
    problems.push('فیلد نوع سفارش در درخواست یادگرفته‌شده پیدا نشد؛ دوباره یک سفارش دستی ثبت کنید.');
  }
  if (overrides.quantity != null && !(Number(overrides.quantity) > 0)) {
    problems.push('تعداد باید بزرگ‌تر از صفر باشد.');
  }
  if (overrides.price != null && overrides.price !== '' && !(Number(overrides.price) > 0)) {
    problems.push('قیمت باید بزرگ‌تر از صفر باشد.');
  }
  return { ok: problems.length === 0, problems };
}

module.exports = {
  ORDER_URL,
  cleanHeaders,
  mapFields,
  looksLikeOrder,
  fromRequest,
  build,
  validate,
  walk,
  getPath,
  setPath,
};
