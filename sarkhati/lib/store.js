'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SARKHATI_DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const LEARNED_FILE = path.join(DATA_DIR, 'learned.json');
const PROFILE_DIR = path.join(DATA_DIR, 'chrome-profile');

// --- باگ ۱ -------------------------------------------------------------
// سه لایهٔ جدا:
//   settings : تنظیمات ماندگار (نماد، تعداد، قیمت، ساعت هدف، ...)
//   session  : وضعیت یک روز معاملاتی (مسلح بودن، تلاش‌ها، گزارش) —
//              با کلید روز نگهداری می‌شود و روز بعد دور ریخته می‌شود
//   learned  : دستور سفارشی که از ایزی‌تریدر یاد گرفته شده
// به این ترتیب باز کردن دوبارهٔ برنامه، وضعیت اجرای قبلی را برنمی‌گرداند.
// -----------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  easyTraderUrl: 'https://easy.mofidonline.com',
  symbol: '',
  quantity: null,
  price: null,
  targetTime: '08:45:00',
  preArmSeconds: 60,      // باگ ۳ — چند ثانیه زودتر شلیک شروع شود
  sendRate: 8,
  parallel: 2,
  stopAfterSeconds: 15,
  maxAttempts: 300,
  clockOffsetMs: 0,
};

const DEFAULT_LEARNED = { recipe: null, history: [] };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** شناسهٔ روز معاملاتی جاری به وقت محلی، مثل «2026-09-15» */
function tradingDay(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function freshSession(day = tradingDay()) {
  return {
    day,
    armed: false,
    armedAt: null,
    firing: false,
    finished: false,
    learning: false,
    attempts: 0,
    accepted: 0,
    rejected: 0,
    lastError: null,
    successText: null,
    log: [],
  };
}

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  writeJson(SETTINGS_FILE, next);
  return next;
}

/**
 * وضعیت جلسه. اگر مربوط به روز معاملاتی دیگری باشد، یک جلسهٔ خالی
 * برمی‌گرداند؛ و «مسلح/در حال شلیک» هرگز از اجرای قبلی به ارث نمی‌رسد.
 */
function loadSession() {
  const today = tradingDay();
  const saved = readJson(SESSION_FILE, null);
  if (!saved || saved.day !== today) {
    const clean = freshSession(today);
    writeJson(SESSION_FILE, clean);
    return clean;
  }
  return { ...saved, armed: false, firing: false, learning: false };
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

function saveRecipe(recipe) {
  const current = loadLearned();
  const history = [
    { learnedAt: recipe.learnedAt, label: recipe.label, url: recipe.url },
    ...current.history,
  ].slice(0, 10);
  const next = { recipe, history };
  writeJson(LEARNED_FILE, next);
  return next;
}

function resetLearned() {
  writeJson(LEARNED_FILE, DEFAULT_LEARNED);
  return { ...DEFAULT_LEARNED, history: [] };
}

module.exports = {
  DATA_DIR,
  PROFILE_DIR,
  DEFAULT_SETTINGS,
  tradingDay,
  freshSession,
  loadSettings,
  saveSettings,
  loadSession,
  saveSession,
  resetSession,
  loadLearned,
  saveRecipe,
  resetLearned,
};
