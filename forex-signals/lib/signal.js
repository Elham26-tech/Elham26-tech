// The one signal shape both engines hand out, and the checks every signal
// passes before anyone sees it: geometry that makes sense, and the course's
// hard limit that a stop is never wider than the trigger timeframe's ATR.

import { round } from './analysis.js';

export const ACTIONS = ['BUY', 'SELL', 'WAIT'];

let counter = 0;
function newId() {
  counter = (counter + 1) % 1000;
  return `${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}`;
}

function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

export function finalize(raw, snap, meta = {}) {
  const { digits, pip } = snap.instrument;
  const p = (x) => round(x, digits);
  const warnings = [...(raw.warnings || [])];
  let action = ACTIONS.includes(raw.action) ? raw.action : 'WAIT';
  let orderType = raw.orderType || 'none';
  let entry = num(raw.entry);
  let stopLoss = num(raw.stopLoss);
  let takeProfits = (raw.takeProfits || []).map(num).filter((x) => x !== null);
  const dir = action === 'BUY' ? 1 : action === 'SELL' ? -1 : 0;

  const downgrade = (why) => {
    warnings.push(why);
    action = 'WAIT';
  };

  if (dir) {
    if (entry === null && orderType === 'market') entry = snap.price;
    if (entry === null || stopLoss === null) downgrade('ورود یا حد ضرر مشخص نبود؛ سیگنال به «صبر» تبدیل شد.');
    else if ((entry - stopLoss) * dir <= 0) downgrade('حد ضرر در سمت اشتباه ورود بود؛ سیگنال به «صبر» تبدیل شد.');
    else {
      takeProfits = takeProfits.filter((tp) => (tp - entry) * dir > 0).sort((a, b) => (a - b) * dir);
      if (!takeProfits.length) downgrade('هیچ تارگت معتبری در جهت معامله نبود؛ سیگنال به «صبر» تبدیل شد.');
    }
  }

  let stopPips = null;
  let riskReward = [];
  if (action === 'WAIT') {
    orderType = 'none';
    entry = null;
    stopLoss = null;
    takeProfits = [];
  } else {
    const risk = Math.abs(entry - stopLoss);
    stopPips = round(risk / pip, 1);
    riskReward = takeProfits.map((tp) => round(Math.abs(tp - entry) / risk, 2));
    const at = snap.atr.trigger;
    if (at && risk > at * 1.05) {
      warnings.push(`حد ضرر (${stopPips} پیپ) از ATR تایم تریگر (${round(at / pip, 1)} پیپ) بزرگ‌تر است؛ طبق دوره این ورود ارزش ندارد مگر در تایم پایین‌تر بهینه شود.`);
    }
    if (orderType === 'market' && at && Math.abs(entry - snap.price) > at) {
      warnings.push('قیمت ورود بیش از یک ATR تریگر با قیمت فعلی فاصله دارد؛ به‌عنوان سفارش لیمیت در نظر بگیرید.');
      orderType = 'limit';
    }
    if (orderType === 'none') orderType = 'market';
  }

  return {
    id: newId(),
    instrument: snap.instrument.id,
    createdAt: new Date().toISOString(),
    source: meta.source || 'rules',
    model: meta.model || null,
    fallbackUsed: Boolean(meta.fallbackUsed),
    dataSource: meta.dataSource || null,
    price: p(snap.price),
    action,
    orderType,
    entry: p(entry),
    stopLoss: p(stopLoss),
    takeProfits: takeProfits.map(p),
    stopPips,
    riskReward,
    confidence: Math.max(0, Math.min(100, Math.round(num(raw.confidence) ?? 0))),
    setup: raw.setup || 'none',
    summary: raw.summary || '',
    reasoning: raw.reasoning || '',
    checklist: (raw.checklist || []).map((c) => ({ rule: String(c.rule), ok: Boolean(c.ok), note: String(c.note || '') })),
    invalidation: raw.invalidation || '',
    keyLevels: (raw.keyLevels || []).map((k) => ({ ...k, price: p(k.price) })),
    warnings,
    usage: meta.usage || null,
  };
}
