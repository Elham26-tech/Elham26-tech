'use strict';

// --- باگ ۲ -------------------------------------------------------------
// خطای «HTTP 400 — Order.Side ... سفارش معتبر نمی‌باشد» خطای بسته بودن
// بازار نیست؛ خطای اعتبارسنجی خود کارگزاری است و یعنی مقدار فیلد Side
// آن چیزی نبوده که سرور انتظار داشته. کارگزاری‌های مختلف یکی از این
// قالب‌ها را می‌پذیرند، پس همه را می‌شناسیم و در صورت رد شدن یکی،
// بعدی را امتحان و نتیجه را حفظ می‌کنیم.
// -----------------------------------------------------------------------

const SIDE_FORMATS = {
  numeric: { buy: 1, sell: 2 },
  pascal: { buy: 'Buy', sell: 'Sell' },
  lower: { buy: 'buy', sell: 'sell' },
  upper: { buy: 'BUY', sell: 'SELL' },
};

const FORMAT_ORDER = ['numeric', 'pascal', 'lower', 'upper'];

/** ورودی کاربر («خرید»، «buy»، 1، ...) را به «buy»/«sell» یکدست می‌کند */
function canonicalSide(raw) {
  if (raw === 1 || raw === '1') return 'buy';
  if (raw === 2 || raw === '2') return 'sell';
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (['buy', 'b', 'خرید'].includes(s)) return 'buy';
  if (['sell', 's', 'فروش'].includes(s)) return 'sell';
  return null;
}

function encodeSide(side, format) {
  const table = SIDE_FORMATS[format] || SIDE_FORMATS.numeric;
  return table[side];
}

/** ترتیب قالب‌هایی که باید امتحان شوند، با اولویت قالب یادگرفته‌شده */
function sideFormatCandidates(settings, learned) {
  if (settings.sideFormat && settings.sideFormat !== 'auto') {
    return [settings.sideFormat];
  }
  const preferred = learned && learned.sideFormat;
  if (preferred && FORMAT_ORDER.includes(preferred)) {
    return [preferred, ...FORMAT_ORDER.filter((f) => f !== preferred)];
  }
  return [...FORMAT_ORDER];
}

/** تعداد را داخل بازهٔ مجاز و قیمت را روی گام قیمت می‌نشاند */
function normalizeQuantityAndPrice(settings) {
  let quantity = Math.floor(Number(settings.quantity) || 0);
  const min = settings.minQuantity == null ? null : Number(settings.minQuantity);
  const max = settings.maxQuantity == null ? null : Number(settings.maxQuantity);
  if (min != null && Number.isFinite(min) && quantity < min) quantity = min;
  if (max != null && Number.isFinite(max) && quantity > max) quantity = max;

  const step = Number(settings.priceStep) || 1;
  let price = Number(settings.price) || 0;
  if (step > 1) price = Math.round(price / step) * step;

  return { quantity, price };
}

/**
 * بدنهٔ سفارش را می‌سازد. همیشه قبل از ارسال صدا زده می‌شود تا هیچ‌وقت
 * سفارشی با Side خالی/نامعتبر روی خط نرود (علت اصلی ۴۰۰ گرفتن‌ها).
 */
function buildOrder(settings, format) {
  const errors = [];
  const side = canonicalSide(settings.side);
  if (!side) errors.push('نوع سفارش (خرید/فروش) مشخص نشده است.');

  const symbol = String(settings.isinOrSymbol || '').trim();
  if (!symbol) errors.push('نماد یا ISIN وارد نشده است.');

  const { quantity, price } = normalizeQuantityAndPrice(settings);
  if (!(quantity > 0)) errors.push('تعداد باید بزرگ‌تر از صفر باشد.');
  if (!(price > 0)) errors.push('قیمت باید بزرگ‌تر از صفر باشد.');

  const body = {
    isin: symbol,
    side: side ? encodeSide(side, format) : null,
    quantity,
    price,
    validity: settings.validity || 'Day',
  };

  return { ok: errors.length === 0, errors, body, side, format };
}

/** آیا پاسخ ۴۰۰ کارگزاری دربارهٔ همین فیلد Side است؟ */
function isSideValidationError(status, text) {
  if (status !== 400) return false;
  return /order\.?side/i.test(String(text || ''));
}

module.exports = {
  SIDE_FORMATS,
  FORMAT_ORDER,
  canonicalSide,
  encodeSide,
  sideFormatCandidates,
  normalizeQuantityAndPrice,
  buildOrder,
  isSideValidationError,
};
