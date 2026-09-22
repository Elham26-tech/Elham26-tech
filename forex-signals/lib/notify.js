// Pushes signals to a Telegram chat, so automatic analyses reach you without
// the page open. Failures are logged and never block a signal.

const ACTION_FA = { BUY: '🔵 خرید', SELL: '🔴 فروش', WAIT: '⏸ صبر' };
const ORDER_FA = { market: 'مارکت', limit: 'لیمیت' };
const SETUP_FA = {
  rtp: 'بازگشت به پیوت',
  pivot: 'پیوت',
  breakout: 'پکیج شکست',
  flip: 'سطح فلیپ‌شده',
  nature: 'ماهیت سطح',
  magnet: 'مگنت',
  'stop-hunt': 'استاپ‌هانت',
  none: '—',
};

export function formatSignal(signal, inst) {
  const d = inst.digits;
  const p = (x) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
  const lines = [`${ACTION_FA[signal.action]} ${inst.nameEn}${signal.orderType in ORDER_FA ? ` (${ORDER_FA[signal.orderType]})` : ''}`];
  if (signal.action !== 'WAIT') {
    lines.push(`ورود ${p(signal.entry)} | حد ضرر ${p(signal.stopLoss)} (${signal.stopPips} pip)`);
    lines.push(`تارگت‌ها: ${signal.takeProfits.map((tp, k) => `${p(tp)} (${signal.riskReward[k]}R)`).join(' / ')}`);
  } else {
    lines.push(`قیمت ${p(signal.price)}`);
  }
  lines.push(`ستاپ: ${SETUP_FA[signal.setup] || signal.setup} | کیفیت ${signal.confidence}/100 | ${signal.source === 'ai' ? 'هوش مصنوعی' : 'موتور قواعد'}`);
  if (signal.summary) lines.push('', signal.summary);
  if (signal.invalidation && signal.action !== 'WAIT') lines.push(`ابطال: ${signal.invalidation}`);
  for (const w of signal.warnings || []) lines.push(`⚠ ${w}`);
  if (signal.dataSource === 'demo') lines.push('', '(داده‌ی نمایشی — برای معامله نیست)');
  return lines.join('\n');
}

export function createNotifier({ token, chatId, mode = 'actionable', fetchImpl = globalThis.fetch, log = console.log }) {
  if (!token || !chatId || mode === 'off') return null;
  return async function notify(signal, inst) {
    if (mode === 'actionable' && signal.action === 'WAIT') return false;
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: formatSignal(signal, inst), disable_web_page_preview: true }),
      });
      if (!res.ok) log(`Telegram send failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return res.ok;
    } catch (err) {
      log(`Telegram send failed: ${err.message}`);
      return false;
    }
  };
}
