import type { Language } from '@/i18n';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Converts ASCII digits to Persian digits; used for every number shown in Persian. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Converts Persian/Arabic digits back to ASCII so input can be parsed. */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function formatNumber(value: number, lang: Language): string {
  const grouped = new Intl.NumberFormat('en-US').format(Math.round(value));
  return lang === 'fa' ? toPersianDigits(grouped) : grouped;
}

/**
 * Prices are stored in IRT (toman). For English we show an approximate USD value
 * using the rate the trade module exposes, so one source of truth stays in the store.
 */
export function formatPrice(
  valueInToman: number,
  lang: Language,
  usdRate: number,
  currencyLabel: string,
): string {
  if (lang === 'en') {
    const usd = valueInToman / usdRate;
    const formatted = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: usd < 100 ? 2 : 0,
    }).format(usd);
    return `${formatted} ${currencyLabel}`;
  }
  return `${formatNumber(valueInToman, lang)} ${currencyLabel}`;
}

const FA_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** Formats an ISO date with the Persian calendar in fa, and a plain date in en. */
export function formatDate(iso: string, lang: Language): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (lang === 'en') {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    numberingSystem: 'latn',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const month = FA_MONTHS[Number(get('month')) - 1] ?? get('month');
  return `${toPersianDigits(get('day'))} ${month} ${toPersianDigits(get('year'))}`;
}

/** Turns a remaining-milliseconds value into HH:MM:SS for auction countdowns. */
export function formatCountdown(ms: number, lang: Language): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return lang === 'fa' ? toPersianDigits(text) : text;
}

/**
 * Normalises an Iranian mobile number to the `9xxxxxxxxx` national form.
 * Accepts 09xxxxxxxxx, +989xxxxxxxxx, 00989xxxxxxxxx and Persian digits.
 */
export function normalizeIranMobile(raw: string): string | null {
  let digits = toLatinDigits(raw).replace(/[^\d+]/g, '');
  digits = digits.replace(/^\+98/, '').replace(/^0098/, '').replace(/^98(?=9\d{9}$)/, '');
  digits = digits.replace(/^0(?=9)/, '');
  return /^9\d{9}$/.test(digits) ? digits : null;
}

/** Renders a national mobile number for display, e.g. `۰۹۱۲ ۳۴۵ ۶۷۸۹`. */
export function formatMobile(national: string, lang: Language): string {
  const text = `0${national}`.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3');
  return lang === 'fa' ? toPersianDigits(text) : text;
}
