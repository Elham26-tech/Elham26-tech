'use strict';

// --- باگ ۲، از ریشه ----------------------------------------------------
// دیگر قالب فیلدها (Side و بقیه) حدس زده نمی‌شود. برنامه سفارشی را که
// خودتان یک بار دستی داخل ایزی‌تریدر ثبت می‌کنید می‌بیند و همان درخواست
// واقعی — با همان نام فیلدها و همان مقدار Side که کارگزاری پذیرفته — را
// به‌عنوان «دستور» نگه می‌دارد. خطای «Order.Side سفارش معتبر نمی‌باشد»
// وقتی رخ می‌داد که این مقدار ساختگی بود.
// -----------------------------------------------------------------------

// مسیرهایی که بوی ثبت سفارش می‌دهند — فقط روی path بررسی می‌شود، نه دامنه،
// چون نام دامنهٔ کارگزاری («easyTRADEr») خودش کلمهٔ trade را دارد و هر
// درخواستی به آن دامنه را شبیه سفارش نشان می‌داد.
const ORDER_PATH = /(order|سفارش|trade|deal|buy|sell)/i;

// سرویس‌های آمار و تبلیغات که صفحهٔ کارگزاری صدایشان می‌زند و هرگز سفارش نیستند
const THIRD_PARTY = new RegExp([
  'google-analytics', 'googletagmanager', 'google\\.com', 'gstatic', 'doubleclick',
  'facebook', 'clarity\\.ms', 'yektanet', 'metrix', 'sentry', 'hotjar',
  'mixpanel', 'segment\\.', 'intercom', 'crisp\\.chat', 'zarinpal',
].join('|'), 'i');

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

/** دامنهٔ ریشه، مثل «easytrader.ir» از «d.easytrader.ir» */
function baseDomain(hostname) {
  const parts = String(hostname || '').split('.').filter(Boolean);
  return parts.slice(-2).join('.');
}

/**
 * آیا این درخواستِ ضبط‌شده واقعاً یک ثبت سفارش است؟
 *
 * تشخیص بر پایهٔ محتواست نه آدرس: باید بدنهٔ JSON داشته باشد و داخلش
 * فیلدهای شناخته‌شدهٔ سفارش (نوع، تعداد، قیمت) پیدا شود. آدرس فقط
 * می‌تواند کمک کند، هیچ‌وقت به‌تنهایی کافی نیست.
 */
function looksLikeOrder(request, { origin } = {}) {
  const method = String(request.method || '').toUpperCase();
  if (method !== 'POST' && method !== 'PUT') return false;
  if (!request.postData) return false;

  let url;
  try { url = new URL(request.url); } catch { return false; }

  if (THIRD_PARTY.test(url.hostname)) return false;

  let parsed;
  try { parsed = JSON.parse(request.postData); } catch { return false; }
  if (!parsed || typeof parsed !== 'object') return false;

  const fields = mapFields(parsed);
  const hasQuantityOrPrice = Boolean(fields.quantity || fields.price);
  // نشانهٔ قطعی: هم نوع سفارش و هم تعداد در بدنه هست
  const definite = Boolean(fields.side && fields.quantity);

  let sameBroker = true;
  if (origin) {
    try {
      const brokerDomain = baseDomain(new URL(origin).hostname);
      sameBroker = !brokerDomain || baseDomain(url.hostname) === brokerDomain;
    } catch { /* آدرس کارگزاری نامعتبر بود */ }
  }

  // API کارگزاری ممکن است روی دامنهٔ دیگری باشد؛ در آن حالت فقط با
  // نشانهٔ قطعی قبول می‌کنیم تا چیزی مثل آمار اشتباهی یاد گرفته نشود.
  if (!sameBroker) return definite;

  if (fields.side && hasQuantityOrPrice) return true;
  if (ORDER_PATH.test(url.pathname) && hasQuantityOrPrice) return true;
  return false;
}

/**
 * کد خرید و فروش را از روی سمتِ سفارشِ یادگرفته‌شده می‌سازد.
 *
 * فقط یکی از دو کد را دیده‌ایم — همانی که کاربر دستی زده — و دیگری از روی
 * الگوی رایج ساخته می‌شود. «۱» مبهم است: هم می‌تواند خرید در الگوی ۱/۲
 * باشد و هم فروش در الگوی ۰/۱؛ پیش‌فرض را خرید می‌گیریم چون سرخطی خرید است.
 */
const COUNTERPART = {
  0: 1, 1: 0, 2: 1,
  buy: 'sell', sell: 'buy', Buy: 'Sell', Sell: 'Buy', BUY: 'SELL', SELL: 'BUY',
  b: 's', s: 'b', خرید: 'فروش', فروش: 'خرید',
};

function sideCodes(sample, capturedIsSell = false) {
  const key = typeof sample === 'number' ? sample : String(sample);
  let counterpart = COUNTERPART[key];
  if (counterpart === undefined) counterpart = sample;
  if (String(sample) === '1' && !capturedIsSell) {
    counterpart = typeof sample === 'number' ? 2 : '2';
  }
  return capturedIsSell
    ? { buy: counterpart, sell: sample }
    : { buy: sample, sell: counterpart };
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

  // سمت سفارش: کدی که کارگزاری می‌فهمد، از روی همان سفارش واقعی ساخته
  // می‌شود — نه حدس زده.
  const sideField = recipe.fields.side;
  if (sideField && overrides.side) {
    const codes = sideCodes(sideField.sample, Boolean(overrides.capturedIsSell));
    const wanted = overrides.side === 'sell' ? codes.sell : codes.buy;
    if (wanted !== undefined && wanted !== null) {
      setPath(body, sideField.path, wanted);
      applied.side = wanted;
    }
  }

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
  sideCodes,
  ORDER_PATH,
  THIRD_PARTY,
  baseDomain,
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
