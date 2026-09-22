// Mechanical signal from the market read, following the rulebook's two main
// entries: a reaction at a pattern-or-higher zone confirmed by a closed
// trigger candle (pivot / RTP), and the retest of a breakout package. Used
// when no AI key is set, and handed to the AI as a first pass to judge.

import { round } from './analysis.js';

const RANK = { 15: 1, 60: 2, 240: 3, '1D': 4, W: 5 };
const TF_FA = { 15: '۱۵دقیقه', 60: '۱ساعته', 240: '۴ساعته', '1D': 'روزانه', W: 'هفتگی' };

function fmt(snap, x) {
  return x === null || x === undefined ? '—' : x.toFixed(snap.instrument.digits);
}

function pips(snap, x) {
  return round(Math.abs(x) / snap.instrument.pip, 1);
}

function zoneText(snap, l) {
  return `${fmt(snap, l.zone[0])}–${fmt(snap, l.zone[1])} (${TF_FA[l.tf] || l.tf})`;
}

// Targets in steps (TP1: pattern ATR less a trigger ATR; TP2: structure ATR
// less a pattern ATR, at least three trigger ATRs), pulled in before the
// first strong opposite zone. Returns null when there is no room for TP1.
function targets(snap, entry, dir, risk) {
  const { trigger: at, pattern: ap, structure: as } = snap.atr;
  const tol = snap.tolerance;
  let tps = [entry + dir * Math.max(ap - at, at), entry + dir * Math.max(as - ap, 3 * at)];
  const opposing = (dir > 0 ? snap.above : snap.below).find((l) => l.score >= 5);
  let capped = null;
  if (opposing) {
    const limit = dir > 0 ? opposing.zone[0] - tol : opposing.zone[1] + tol;
    if ((tps[0] - limit) * dir > 0) capped = opposing;
    tps = tps.map((tp) => ((tp - limit) * dir > 0 ? limit : tp));
  }
  // A second target squeezed against the first by the cap adds nothing.
  if (Math.abs(tps[1] - tps[0]) < 0.3 * risk) tps = [tps[0]];
  if ((tps[0] - entry) * dir < risk) return { tps: null, capped };
  return { tps, capped };
}

function structureBias(snap) {
  const s = snap.timeframes[snap.roles.structure];
  const p = snap.timeframes[snap.roles.pattern];
  const vote = (t) => (!t ? 0 : t.structure === 'uptrend' ? 1 : t.structure === 'downtrend' ? -1 : 0);
  return vote(s) + vote(p) * 0.5;
}

// Reaction at a zone: price sits on a support (resistance) of the pattern
// timeframe or higher and the last closed trigger candle turned away from it.
function reactionSetup(snap) {
  const at = snap.atr.trigger;
  const tol = snap.tolerance;
  const trig = snap.timeframes[snap.roles.trigger];
  const minRank = RANK[snap.roles.pattern];
  const best = snap.at
    .filter((l) => (RANK[l.tf] ?? 0) >= minRank || l.confluence.some((tf) => (RANK[tf] ?? 0) >= minRank))
    .sort((a, b) => b.score - a.score)[0];
  if (!best || !trig) return null;
  const dir = best.acts === 'support' ? 1 : -1;
  const side = dir > 0 ? 'BUY' : 'SELL';
  const t = trig.trigger;
  const triggerOk =
    t.dir === (dir > 0 ? 'up' : 'down') &&
    (t.size !== 'spinning' || t.master === 'body') &&
    (t.engulfsLastOpposite || t.closesBeyondPrev) &&
    (dir > 0 ? t.low <= best.zone[1] + tol : t.high >= best.zone[0] - tol);
  const stop = dir > 0 ? best.zone[0] - tol : best.zone[1] + tol;
  const risk = (snap.price - stop) * dir;
  const stopOk = risk > 0 && risk <= at;
  const tgt = stopOk ? targets(snap, snap.price, dir, risk) : { tps: null, capped: null };
  const bias = structureBias(snap) * dir;
  const used = snap.movement.dailyAtrUsed;
  const dayDir = snap.timeframes['1D'] ? Math.sign(snap.timeframes['1D'].forming.close - snap.timeframes['1D'].forming.open) : 0;

  const checklist = [
    { rule: 'قیمت روی زون تایم پترن یا بالاتر', ok: true, note: `${best.acts === 'support' ? 'حمایت' : 'مقاومت'} ${zoneText(snap, best)}، امتیاز ${best.score}` },
    {
      rule: 'ارزش سطح (تازه، کمتر از سه برخورد، غیر پول‌بکی)',
      ok: best.touches < 3 && best.type !== 'pullback',
      note: `${best.touches} برخورد${best.fresh ? '، دست‌نخورده' : ''}${best.flips ? '، فلیپ‌شده' : ''}${best.type === 'pullback' ? '، پیوت پول‌بکی' : ''}`,
    },
    {
      rule: 'تریگر بسته‌شده در تایم تریگر',
      ok: triggerOk,
      note: `آخرین کندل ${TF_FA[snap.roles.trigger]}: ${t.dir === 'up' ? 'صعودی' : t.dir === 'down' ? 'نزولی' : 'دوجی'}، ${t.size}${t.master ? `، مستر (${t.master})` : ''}${t.engulfsLastOpposite ? '، نفوذ در آخرین کندل مخالف' : ''}`,
    },
    {
      rule: 'حد ضرر پشت زون و حداکثر یک ATR تریگر',
      ok: stopOk,
      note: `${pips(snap, risk)} پیپ در برابر ATR تریگر ${pips(snap, at)} پیپ`,
    },
    {
      rule: 'جا برای تارگت اول تا سطح قوی مخالف',
      ok: Boolean(tgt.tps),
      note: !stopOk ? 'بدون حد ضرر معتبر محاسبه نشد' : tgt.capped ? `سطح مخالف ${zoneText(snap, tgt.capped)}` : 'سطح قوی مخالفی نزدیک نیست',
    },
    { rule: 'همسویی با ساختار روزانه/۴ساعته', ok: bias >= 0, note: bias > 0 ? 'همسو' : bias < 0 ? 'خلاف ساختار' : 'خنثی' },
  ];

  const warnings = [];
  if (used !== null && used >= 1 && dayDir === dir) warnings.push('گام روزانه (ATR روز) در همین جهت مصرف شده است.');
  if (best.touches === 0 && best.flips === 0) warnings.push('اولین برخورد به سطح است؛ احتمال پیوت تسویه و استاپ‌هانت را در نظر بگیرید.');

  const ready = triggerOk && stopOk && tgt.tps && best.touches < 3 && best.type !== 'pullback';
  let confidence = 35 + Math.min(best.score, 10) * 3 + (bias > 0 ? 10 : bias < 0 ? -10 : 0) + (best.fresh ? 3 : 0) - (best.touches >= 2 ? 8 : 0);
  if (!ready) confidence = Math.min(confidence, 40);
  const levelWord = dir > 0 ? 'حمایت' : 'مقاومت';

  return {
    ready,
    raw: {
      action: ready ? side : 'WAIT',
      orderType: ready ? 'market' : 'none',
      entry: ready ? snap.price : null,
      stopLoss: ready ? stop : null,
      takeProfits: ready ? tgt.tps : [],
      confidence: Math.min(confidence, 80),
      setup: best.flips ? 'flip' : 'rtp',
      summary: ready
        ? `${side === 'BUY' ? 'خرید' : 'فروش'} از ${levelWord} ${zoneText(snap, best)} با تریگر ${TF_FA[snap.roles.trigger]}`
        : `قیمت روی ${levelWord} ${zoneText(snap, best)} است؛ منتظر ${!triggerOk ? `تریگر ${dir > 0 ? 'صعودی' : 'نزولی'} ${TF_FA[snap.roles.trigger]}` : !stopOk ? 'نزدیک‌تر شدن قیمت به زون (حد ضرر بزرگ است)' : 'جای کافی تا تارگت'} بمانید`,
      reasoning: `قیمت ${fmt(snap, snap.price)} داخل ${levelWord} ${zoneText(snap, best)} با امتیاز ${best.score} و هم‌پوشانی ${best.confluence.map((x) => TF_FA[x] || x).join('، ')} قرار دارد. ` +
        (ready
          ? `کندل ${TF_FA[snap.roles.trigger]} بسته‌شده تریگر برگشت داده، حد ضرر پشت زون با تلورانس (${pips(snap, risk)} پیپ) از ATR تریگر کوچک‌تر است و تارگت‌ها بر اساس گام پترن و ساختار چیده شده‌اند.`
          : 'شرایط کامل ورود هنوز برقرار نیست؛ طبق قاعده‌ی «زود وارد نشو» صبر می‌کنیم.'),
      checklist,
      invalidation: `بسته‌شدن کندل ${TF_FA[snap.roles.trigger]} ${dir > 0 ? 'زیر' : 'بالای'} ${fmt(snap, stop)} (${dir > 0 ? 'کف' : 'سقف'} زون با تلورانس).`,
      keyLevels: [
        { price: (best.zone[0] + best.zone[1]) / 2, kind: 'entry-zone', timeframe: best.tf, note: `${levelWord} امتیاز ${best.score}` },
        ...(tgt.capped ? [{ price: (tgt.capped.zone[0] + tgt.capped.zone[1]) / 2, kind: dir > 0 ? 'resistance' : 'support', timeframe: tgt.capped.tf, note: 'سطح مخالف' }] : []),
      ],
      warnings,
    },
  };
}

// Breakout package: a full-body longbar closed through a level out of a
// compression, price accepted outside it. Entry one trigger ATR from the
// zone floor (edge), stop back inside the zone.
function breakoutSetup(snap) {
  const b = [...snap.breakouts].sort((x, y) => (RANK[y.tf] ?? 0) - (RANK[x.tf] ?? 0))[0];
  if (!b) return null;
  const { trigger: at, pattern: ap, structure: as } = snap.atr;
  const tol = snap.tolerance;
  const dir = b.dir === 'up' ? 1 : -1;
  const side = dir > 0 ? 'BUY' : 'SELL';
  const tf = snap.timeframes[b.tf];
  const after = tf.closed.filter((c) => c.time > b.time);
  const accepted = after.every((c) => (c.close - b.edge) * dir > 0);
  const dist = (snap.price - b.edge) * dir;
  const zoneClass = dist <= at ? 'FTR' : dist <= ap ? 'ETR' : dist <= as ? 'CTR' : 'OTR';
  const stop = b.edge - dir * tol;
  const entry = b.edge + dir * (at - tol);
  const market = (snap.price - entry) * dir <= 0 && (snap.price - stop) * dir > 0;
  const fill = market ? snap.price : entry;
  const risk = (fill - stop) * dir;
  const tgt = targets(snap, fill, dir, risk);
  const bias = structureBias(snap) * dir;
  // The package is incomplete without the compression before the break.
  const ready = b.compression && accepted && dist > -tol && zoneClass !== 'OTR' && Boolean(tgt.tps);

  const checklist = [
    { rule: 'شکست سطح هم‌تایم یا بالاتر با لانگ‌بار تمام‌بدنه', ok: true, note: `${TF_FA[b.tf]}، ${zoneText(snap, b.level)}، ${b.barsAgo} کندل پیش` },
    { rule: 'فشردگی (CP) یا بیس قبل از شکست', ok: b.compression, note: b.compression ? 'بود' : 'نبود' },
    { rule: 'پذیرش بیرون سطح (کلوزی به داخل برنگشته)', ok: accepted, note: accepted ? 'پذیرفته شده' : 'کلوز به داخل ناحیه برگشته' },
    { rule: 'ناحیه‌ی فعلی قیمت (FTR/ETR/CTR)', ok: zoneClass !== 'OTR', note: `${zoneClass}، ${pips(snap, dist)} پیپ از لبه‌ی سطح` },
    { rule: 'جا برای تارگت اول', ok: Boolean(tgt.tps), note: tgt.capped ? `سطح مخالف ${zoneText(snap, tgt.capped)}` : 'باز' },
    { rule: 'همسویی با ساختار', ok: bias >= 0, note: bias > 0 ? 'همسو' : bias < 0 ? 'خلاف ساختار' : 'خنثی' },
  ];
  let confidence = 35 + Math.min(b.level.score, 10) * 3 + (b.compression ? 8 : -8) + (bias > 0 ? 10 : bias < 0 ? -10 : 0) + (zoneClass === 'FTR' ? 4 : zoneClass === 'CTR' ? -6 : 0);
  if (!ready) confidence = Math.min(confidence, 40);
  const word = dir > 0 ? 'صعودی' : 'نزولی';

  return {
    ready,
    raw: {
      action: ready ? side : 'WAIT',
      orderType: ready ? (market ? 'market' : 'limit') : 'none',
      entry: ready ? fill : null,
      stopLoss: ready ? stop : null,
      takeProfits: ready ? tgt.tps : [],
      confidence: Math.min(confidence, 80),
      setup: 'breakout',
      summary: ready
        ? `شکست ${word} ${zoneText(snap, b.level)}؛ ${market ? 'ورود در ناحیه‌ی پذیرش' : `لیمیت ${fmt(snap, entry)} (یک ATR تریگر از لبه)`}`
        : `شکست ${word} ${zoneText(snap, b.level)} دیده شد ولی ${!b.compression ? 'پکیج شکست کامل نیست (فشردگی قبلی نبود)' : !accepted ? 'پذیرش ندارد' : zoneClass === 'OTR' ? 'قیمت خیلی دور شده (OTR)؛ دنبالش نکنید' : 'جای تارگت ندارد'}`,
      reasoning: `کندل ${TF_FA[b.tf]} با بدنه‌ی کامل (${b.candle.atrRatio}×ATR) سطح ${zoneText(snap, b.level)} را شکسته${b.compression ? ' و قبل از آن فشردگی بوده' : ''}. قیمت در ناحیه‌ی ${zoneClass} است. نقطه‌ی ورود طبق دوره یک ATR تایم تریگر از لبه‌ی سطح (${fmt(snap, entry)}) و حد ضرر برگشت به داخل سطح با تلورانس است.`,
      checklist,
      invalidation: `بسته‌شدن کندل ${TF_FA[b.tf]} دوباره ${dir > 0 ? 'زیر' : 'بالای'} ${fmt(snap, b.edge)} (شکست ناموفق).`,
      keyLevels: [{ price: b.edge, kind: 'entry-zone', timeframe: b.tf, note: 'لبه‌ی سطح شکسته‌شده' }],
      warnings: b.compression ? [] : ['شکست بدون فشردگی قبلی؛ پکیج شکست کامل نیست.'],
    },
  };
}

function waitSignal(snap) {
  const s = snap.support;
  const r = snap.resistance;
  const parts = [];
  if (s) parts.push(`حمایت ${zoneText(snap, s)} (امتیاز ${s.score})`);
  if (r) parts.push(`مقاومت ${zoneText(snap, r)} (امتیاز ${r.score})`);
  const loc = snap.location;
  return {
    action: 'WAIT',
    orderType: 'none',
    confidence: 0,
    setup: 'none',
    summary: `قیمت روی زون معتبری نیست؛ ${parts.join(' و ') || 'سطح نزدیکی پیدا نشد'}`,
    reasoning:
      `قیمت ${fmt(snap, snap.price)} ${loc === null ? '' : `در ${Math.round(loc * 100)}٪ فاصله‌ی حمایت تا مقاومت`} است. ` +
      'طبق دوره وسط راه جای ورود نیست؛ منتظر رسیدن قیمت به یکی از زون‌ها و تریگر بسته‌شده در تایم تریگر بمانید.' +
      (snap.movement.dailyAtrUsed !== null ? ` ${Math.round(snap.movement.dailyAtrUsed * 100)}٪ از ATR روزانه مصرف شده است.` : ''),
    checklist: [{ rule: 'قیمت روی زون تایم پترن یا بالاتر', ok: false, note: parts.join('؛ ') }],
    invalidation: '',
    keyLevels: [
      ...(s ? [{ price: (s.zone[0] + s.zone[1]) / 2, kind: 'support', timeframe: s.tf, note: `امتیاز ${s.score}` }] : []),
      ...(r ? [{ price: (r.zone[0] + r.zone[1]) / 2, kind: 'resistance', timeframe: r.tf, note: `امتیاز ${r.score}` }] : []),
    ],
  };
}

export function ruleSignal(snap) {
  const { trigger, pattern, structure } = snap.atr;
  if (!trigger || !pattern || !structure) {
    return {
      action: 'WAIT',
      orderType: 'none',
      confidence: 0,
      setup: 'none',
      summary: 'داده‌ی کافی برای همه‌ی تایم‌ها هنوز نرسیده است.',
      reasoning: 'برای خواندن ساختار، پترن و تریگر به تاریخچه‌ی هر سه تایم نیاز است.',
      checklist: [],
      invalidation: '',
    };
  }
  const setups = [reactionSetup(snap), breakoutSetup(snap)].filter(Boolean);
  const ready = setups.filter((s) => s.ready).sort((a, b) => b.raw.confidence - a.raw.confidence);
  if (ready.length) return ready[0].raw;
  // Nothing to take: a setup that is forming beats the generic wait.
  const forming = setups.sort((a, b) => b.raw.confidence - a.raw.confidence)[0];
  return forming ? forming.raw : waitSignal(snap);
}
