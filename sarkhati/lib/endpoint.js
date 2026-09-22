'use strict';

// یک درخواست یادگرفته‌شده، به‌همراه اینکه کدام پارامترش متغیر است.
//
// دانستن نامِ پارامتر مهم است: برای پرسیدن دربارهٔ نماد دیگر، باید دقیقاً
// همان پارامتر عوض شود، نه چیزی که حدس زده‌ایم.

const ISIN = /^IR[A-Z0-9]{10}$/;
const ISIN_ANYWHERE = /IR[A-Z0-9]{10}/;

const SEARCH_PARAM_NAME =
  /^(q|term|query|search|searchterm|keyword|key|value|text|name|symbol|filter|phrase)$/i;

/** عبارتِ جست‌وجوی تایپ‌شده: کوتاه، حرف‌دار، نه عدد خالص و نه ISIN */
function looksLikeSearchTerm(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || [...trimmed].length > 12) return false;
  if (ISIN.test(trimmed)) return false;
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return false;
  if (/^(true|false)$/i.test(trimmed)) return false;
  return /\p{L}/u.test(trimmed);
}

function parseJson(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * از یک درخواستِ دیده‌شده، نقطه‌ای قابل تکرار می‌سازد.
 * isinMode یعنی دنبال درخواستِ «اطلاعات نماد» بگرد، نه جست‌وجو.
 */
function build({ method, url, postData, headers }, { isinMode = false } = {}) {
  const base = {
    method: String(method || 'GET').toUpperCase(),
    url,
    postData: postData || '',
    headers: headers || {},
    param: '',
    inBody: false,
    contains: false,
    sample: '',
  };

  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const body = parseJson(postData);
  const matches = (value) => (isinMode ? ISIN.test(String(value).trim()) : looksLikeSearchTerm(value));

  // ۱) پارامتر در خودِ نشانی
  const named = [...parsed.searchParams.entries()];
  const byName = named.find(([name, value]) => !isinMode && SEARCH_PARAM_NAME.test(name) && matches(value));
  const byValue = named.find(([, value]) => matches(value));
  const hit = byName || byValue;
  if (hit) return { ...base, param: hit[0], sample: hit[1] };

  // ۲) فیلد در بدنهٔ JSON
  if (body) {
    for (const [name, value] of Object.entries(body)) {
      if (typeof value === 'string' && matches(value)) {
        return { ...base, param: name, sample: value, inBody: true };
      }
    }
    // ۳) کد نماد داخلِ متنِ یک فیلد (مثل پرس‌وجوی GraphQL)
    if (isinMode) {
      for (const [name, value] of Object.entries(body)) {
        if (typeof value !== 'string') continue;
        const found = value.match(ISIN_ANYWHERE);
        if (found) return { ...base, param: name, sample: found[0], inBody: true, contains: true };
      }
    }
  }

  // ۴) کد نماد داخل خودِ مسیر، بدون پارامتر
  if (isinMode && ISIN_ANYWHERE.test(url)) {
    const found = url.match(ISIN_ANYWHERE);
    return { ...base, param: '', sample: found[0] };
  }
  return null;
}

/**
 * همان درخواست را با مقدار تازه می‌سازد.
 * اگر هیچ‌کدام از راه‌ها نگرفت ولی کد نمادی جایی در نشانی هست، همان را
 * جایگزین می‌کنیم — بعضی مسیرها کد را داخل خودِ مسیر دارند.
 */
function withValue(endpoint, value) {
  if (!endpoint) return null;
  const fresh = String(value);
  const fallback = () => (ISIN_ANYWHERE.test(endpoint.url)
    ? { ...endpoint, url: endpoint.url.replace(ISIN_ANYWHERE, fresh), body: endpoint.postData || null }
    : null);

  if (endpoint.contains && endpoint.inBody) {
    const body = parseJson(endpoint.postData);
    if (!body || typeof body[endpoint.param] !== 'string') return fallback();
    const text = body[endpoint.param];
    if (!text.includes(endpoint.sample)) return fallback();
    body[endpoint.param] = text.split(endpoint.sample).join(fresh);
    return { ...endpoint, url: endpoint.url, body: JSON.stringify(body) };
  }

  if (endpoint.inBody) {
    const body = parseJson(endpoint.postData);
    if (!body || !(endpoint.param in body)) return fallback();
    body[endpoint.param] = fresh;
    return { ...endpoint, url: endpoint.url, body: JSON.stringify(body) };
  }

  // بدون پارامتر: کد نماد داخل خودِ مسیر است
  if (!endpoint.param) {
    if (!endpoint.sample) return fallback();
    return {
      ...endpoint,
      url: endpoint.url.split(endpoint.sample).join(fresh),
      body: endpoint.postData || null,
    };
  }

  let parsed;
  try { parsed = new URL(endpoint.url); } catch { return fallback(); }
  if (!parsed.searchParams.has(endpoint.param)) return fallback();
  parsed.searchParams.set(endpoint.param, fresh);
  return { ...endpoint, url: parsed.toString(), body: endpoint.postData || null };
}

/**
 * هدرهایی که تکرارشان معنا دارد. طول بدنه و هدرهای وابسته به اتصال را
 * مرورگر خودش می‌سازد؛ بقیه — از جمله هدرهای اختصاصی کارگزار — باید بمانند.
 */
const DROP_HEADERS = new Set([
  'host', 'content-length', 'connection', 'accept-encoding', 'cookie',
]);

function replayableHeaders(headers = {}) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (DROP_HEADERS.has(name.toLowerCase()) || name.startsWith(':') || !value) continue;
    out[name] = value;
  }
  return out;
}

// مسیری که ساعت سرور کارگزار را می‌دهد — دقتش میلی‌ثانیه است، برخلاف
// هدر Date که فقط ثانیه دارد.
const SERVER_TIME_PATH = /(server-?time|servertime|time\/now|systemtime|currenttime)/i;

// مسیرهایی که معمولاً مشخصات نماد می‌دهند، در برابر مسیرهایی که فقط داده
// نمودار می‌دهند. اولی اول امتحان می‌شود.
const GOOD_PATH = /(instrument|symbol|detail|info|quote|state|bestlimit|watch|security)/i;
const POOR_PATH = /(chart|history|datafeed|candle|ohlc|minichart|intraday|news|announce)/i;

/** هرچه بیشتر، احتمال اینکه سقف/کف بدهد بیشتر */
function scoreEndpoint(endpoint) {
  let path = '';
  try { path = new URL(endpoint.url).pathname; } catch { path = String(endpoint.url || ''); }
  let score = 0;
  if (GOOD_PATH.test(path)) score += 2;
  if (POOR_PATH.test(path)) score -= 3;
  if (endpoint.method === 'GET') score += 1;
  return score;
}

/** دو نامزد وقتی یکی‌اند که مسیر و پارامترشان یکی باشد */
function sameEndpoint(a, b) {
  const base = (e) => {
    try {
      const u = new URL(e.url);
      return `${e.method} ${u.host}${u.pathname} ${e.param}`;
    } catch { return `${e.method} ${e.url} ${e.param}`; }
  };
  return base(a) === base(b);
}

module.exports = {
  ISIN, looksLikeSearchTerm, build, withValue, replayableHeaders,
  scoreEndpoint, sameEndpoint, GOOD_PATH, POOR_PATH, SERVER_TIME_PATH,
};
