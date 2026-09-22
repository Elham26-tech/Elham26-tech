'use strict';

// سقف و کف مجاز و محدودیت حجم را از پاسخ خودِ کارگزار درمی‌آورد.
//
// چرا از کارگزار و نه TSETMC: مرجع واقعیِ «چقدر مجازی بفرستی» همان کارگزار
// است. دامنهٔ نوسانِ حساب‌شده از قیمت دیروز فقط یک تخمین است و تعداد مجاز
// هر سفارش هم اصلاً در داده‌های تابلو نیست.
//
// نام فیلدها بین کارگزاری‌ها فرق دارد، پس به‌جای نام ثابت، با الگو می‌گردیم.

const PATTERNS = {
  upperPrice: [
    /(maxallow|allowedmax|highallow|pricemax|maxprice|upperlimit|ceil|tmax|psgelstamax|highthreshold)/i,
    /(^max$|highest|top)/i,
  ],
  lowerPrice: [
    /(minallow|allowedmin|lowallow|pricemin|minprice|lowerlimit|floor|tmin|psgelstamin|lowthreshold)/i,
    /(^min$|lowest|bottom)/i,
  ],
  lastPrice: [
    /(closingprice|pclosing|finalprice|lastprice|pdrcotval|closeprice)/i,
    /(^last$|^close$|^final$)/i,
  ],
  tick: [/(ticksize|pricetick|^tick$|steppr)/i],
  maxQuantity: [/(maxquantity|maxvolume|maxorderquantity|maxtradequantity|maxorderq)/i],
  minQuantity: [/(minquantity|minvolume|minorderquantity|mintradequantity|minorderq)/i],
};

/** همهٔ زوج‌های «نام برگ → عدد» در یک پاسخ JSON تودرتو */
function numericLeaves(value, leaf = '', out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      numericLeaves(item, Array.isArray(value) ? leaf : key, out);
    }
    return out;
  }
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (leaf && Number.isFinite(number)) out.push([leaf, number]);
  return out;
}

/**
 * الگوها به ترتیب اولویت امتحان می‌شوند: اول نام‌های صریح مثل
 * maxAllowedPrice، بعد نام‌های کلی‌تر مثل max. با این ترتیب، فیلدی مثل
 * «maxPrice» بر «max» مقدم است.
 */
function pick(leaves, patterns) {
  for (const pattern of patterns) {
    for (const [leaf, number] of leaves) {
      if (pattern.test(leaf) && number > 0) return number;
    }
  }
  return null;
}

/** سقف/کف/تیک/حجم مجاز را از پاسخ کارگزار بیرون می‌کشد */
function fromResponse(payload) {
  const leaves = numericLeaves(payload);
  const limits = { source: 'کارگزار', fields: {} };

  for (const [name, patterns] of Object.entries(PATTERNS)) {
    limits[name] = pick(leaves, patterns);
  }
  for (const [leaf, number] of leaves) {
    if (limits.fields[leaf] === undefined) limits.fields[leaf] = number;
  }

  // سقف و کف باید با هم معنا بدهند؛ اگر جابه‌جا خوانده شدند، درستشان می‌کنیم.
  if (limits.upperPrice && limits.lowerPrice && limits.upperPrice < limits.lowerPrice) {
    const swap = limits.upperPrice;
    limits.upperPrice = limits.lowerPrice;
    limits.lowerPrice = swap;
  }
  return limits;
}

/**
 * نتیجهٔ یک پاسخ را روی آنچه تا حالا داریم می‌نشاند، بدون پاک کردن.
 *
 * چرا ترکیب و نه «اولین پاسخِ به‌دردبخور»: هیچ پاسخی همهٔ اعداد را ندارد —
 * یکی سقف و کف قیمت می‌دهد و دیگری حداکثر حجم مجاز. این دقیقاً همان کاری
 * است که نسخهٔ اصلی می‌کرد و نبودش باعث می‌شد سقف/کف پیدا نشود.
 */
function merge(into, found) {
  const target = into || { source: null, fields: {} };
  for (const name of Object.keys(PATTERNS)) {
    if (!target[name] && found[name]) target[name] = found[name];
  }
  for (const [key, value] of Object.entries(found.fields || {})) {
    if (target.fields[key] === undefined) target.fields[key] = value;
  }
  if (target.upperPrice && target.lowerPrice && target.upperPrice < target.lowerPrice) {
    const swap = target.upperPrice;
    target.upperPrice = target.lowerPrice;
    target.lowerPrice = swap;
  }
  return target;
}

function emptyLimits() {
  const out = { source: null, fields: {} };
  for (const name of Object.keys(PATTERNS)) out[name] = null;
  return out;
}

/** آیا از این پاسخ چیز به‌دردبخوری درآمد؟ */
function isUseful(limits) {
  return Boolean(limits && (limits.upperPrice || limits.lowerPrice || limits.maxQuantity));
}

/**
 * تخمین دامنهٔ نوسان از قیمت دیروز — فقط وقتی کارگزار چیزی نداد.
 * همیشه با برچسب «تخمینی» نمایش داده می‌شود تا با عدد رسمی اشتباه نشود.
 */
function estimateFromYesterday(yesterdayPrice, rangePercent = 5) {
  const base = Number(yesterdayPrice);
  if (!(base > 0)) return null;
  const span = (base * rangePercent) / 100;
  return {
    upperPrice: Math.round(base + span),
    lowerPrice: Math.round(base - span),
    lastPrice: base,
    tick: null,
    maxQuantity: null,
    minQuantity: null,
    estimated: true,
    source: `تخمین از قیمت دیروز (±${rangePercent}٪)`,
    fields: {},
  };
}

module.exports = {
  PATTERNS, numericLeaves, pick, fromResponse, merge, emptyLimits,
  isUseful, estimateFromYesterday,
};
