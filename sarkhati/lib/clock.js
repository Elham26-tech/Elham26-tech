'use strict';

// ساعت سرور کارگزار.
//
// هدر Date فقط دقت ثانیه دارد؛ برای ابزاری که سر میلی‌ثانیه شلیک می‌کند
// این خیلی درشت است. اگر صفحهٔ کارگزاری مسیری برای گرفتن ساعت سرور داشته
// باشد، از همان چند نمونه می‌گیریم و کم‌تأخیرترین را برمی‌داریم.

// عددی که مثل «میلی‌ثانیهٔ یونیکس» باشد: بین ۲۰۲۰ و ۲۰۵۰
const MIN_EPOCH = Date.UTC(2020, 0, 1);
const MAX_EPOCH = Date.UTC(2050, 0, 1);

const TIME_KEY = /(time|now|timestamp|epoch|millis|date|ticks)/i;

function plausibleEpochMillis(value) {
  return Number.isFinite(value) && value > MIN_EPOCH && value < MAX_EPOCH;
}

/** همهٔ زوج‌های «نام برگ → عدد» در یک پاسخ JSON */
function numbersByKey(payload, leaf = '', out = {}) {
  if (payload === null || payload === undefined) return out;
  if (typeof payload === 'object') {
    for (const [key, item] of Object.entries(payload)) {
      numbersByKey(item, Array.isArray(payload) ? leaf : key, out);
    }
    return out;
  }
  const number = typeof payload === 'number' ? payload : Number(String(payload).trim());
  if (leaf && Number.isFinite(number) && out[leaf] === undefined) out[leaf] = number;
  return out;
}

/**
 * زمان سرور را از پاسخ بیرون می‌کشد. شکل پاسخ بین کارگزاری‌ها فرق دارد،
 * پس به‌جای نام دقیق کلید، دنبال عددی می‌گردیم که مثل زمان باشد.
 */
function serverTimestampOf(payload) {
  const fields = numbersByKey(payload);

  let best = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (!TIME_KEY.test(key)) continue;
    // بعضی سرورها ثانیه می‌دهند نه میلی‌ثانیه
    for (const millis of [value, value * 1000]) {
      if (plausibleEpochMillis(millis) && millis > best) best = millis;
    }
  }
  if (best > 0) return best;

  for (const value of Object.values(fields)) {
    for (const millis of [value, value * 1000]) {
      if (plausibleEpochMillis(millis)) return millis;
    }
  }
  return null;
}

/**
 * از چند نمونه، کم‌تأخیرترین را برمی‌دارد.
 * فرض متعارف: نصف رفت‌وبرگشت تا رسیدن درخواست، نصف تا برگشت پاسخ — پس
 * لحظهٔ «وسط» بهترین تخمین از زمانی است که سرور عدد را ساخته.
 */
function bestReading(readings) {
  if (!readings.length) return null;
  const sorted = [...readings].sort((a, b) => a.rtt - b.rtt);
  const best = sorted[0];
  return { offsetMs: Math.round(best.offset), rttMs: best.rtt, samples: readings.length };
}

function readingFrom(serverMillis, sentAt, receivedAt) {
  const rtt = receivedAt - sentAt;
  const middle = sentAt + rtt / 2;
  return { offset: serverMillis - middle, rtt };
}

module.exports = {
  plausibleEpochMillis, numbersByKey, serverTimestampOf, bestReading, readingFrom, TIME_KEY,
};
