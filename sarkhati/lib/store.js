'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SARKHATI_DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const LEARNED_FILE = path.join(DATA_DIR, 'learned.json');

// --- باگ ۱ -------------------------------------------------------------
// سه لایهٔ جدا از هم نگه می‌داریم:
//   settings : تنظیمات ماندگار کاربر (آدرس کارگزاری، نماد، تعداد، ...)
//   session  : وضعیت یک روز معاملاتی (مسلح بودن، شمارش تلاش‌ها، گزارش)
//              — با کلید روز نگهداری می‌شود و روز بعد دور ریخته می‌شود
//   learned  : چیزهایی که برنامه از پاسخ کارگزاری یاد گرفته (قالب فیلدها)
// با این کار «حافظهٔ قبلی» دیگر بین اجراها نشت نمی‌کند.
// -----------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  baseUrl: '',
  orderPath: '/Order',
  token: '',
  isinOrSymbol: '',
  side: 'buy',
  quantity: 1,
  price: 0,
  minQuantity: null,
  maxQuantity: null,
  priceStep: 1,
  targetTime: '08:45:00',
  // --- باگ ۳ ---
  preArmSeconds: 60,      // چند ثانیه زودتر از ساعت هدف شلیک شروع شود
  sendRate: 12,           // تلاش در ثانیه
  parallel: 2,            // اتصال موازی
  stopAfterSeconds: 10,   // سقف مدت شلیک
  maxAttempts: 400,
  // --- باگ ۲ ---
  sideFormat: 'auto',     // auto | numeric | pascal | lower | upper
  autoLearnSide: true,
  clockOffsetMs: 0,
  timeSyncUrl: '',
};

const DEFAULT_LEARNED = { sideFormat: null, learnedAt: null, learnedFrom: null };

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** شناسهٔ روز معاملاتی جاری به وقت محلی، مثلاً «2026-09-15» */
function tradingDay(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function freshSession(day = tradingDay()) {
  return {
    day,
    armed: false,
    armedAt: null,
    firing: false,
    finished: false,
    attempts: 0,
    accepted: 0,
    rejected: 0,
    lastError: null,
    successOrderId: null,
    log: [],
  };
}

function loadSettings() {
  const saved = readJson(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  writeJson(SETTINGS_FILE, next);
  return next;
}

/**
 * وضعیت جلسه را می‌خواند. اگر مربوط به روز معاملاتی دیگری باشد
 * (یعنی برنامه دیروز باز بوده و امروز دوباره باز شده) یک جلسهٔ خالی
 * برمی‌گرداند — این همان باگی بود که «حافظهٔ قبلی» را نگه می‌داشت.
 */
function loadSession() {
  const today = tradingDay();
  const saved = readJson(SESSION_FILE, null);
  if (!saved || saved.day !== today) {
    const clean = freshSession(today);
    writeJson(SESSION_FILE, clean);
    return clean;
  }
  // حتی در همان روز، «مسلح بودن» را از اجرای قبلی به ارث نمی‌بریم:
  // بعد از بسته و باز شدن برنامه باید کاربر دوباره آگاهانه مسلح کند.
  return { ...saved, armed: false, firing: false };
}

function saveSession(session) {
  writeJson(SESSION_FILE, session);
  return session;
}

function resetSession() {
  return saveSession(freshSession());
}

function loadLearned() {
  return { ...DEFAULT_LEARNED, ...readJson(LEARNED_FILE, {}) };
}

function saveLearned(patch) {
  const next = { ...loadLearned(), ...patch };
  writeJson(LEARNED_FILE, next);
  return next;
}

function resetLearned() {
  writeJson(LEARNED_FILE, DEFAULT_LEARNED);
  return { ...DEFAULT_LEARNED };
}

module.exports = {
  DATA_DIR,
  DEFAULT_SETTINGS,
  tradingDay,
  freshSession,
  loadSettings,
  saveSettings,
  loadSession,
  saveSession,
  resetSession,
  loadLearned,
  saveLearned,
  resetLearned,
};
