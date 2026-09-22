'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * پوشهٔ داده: کنار خودِ فایل اجرایی. اگر آنجا نوشتنی نبود (اجرا از داخل
 * فایل فشرده یا پوشهٔ محافظت‌شدهٔ ویندوز)، به پوشهٔ کاربر برمی‌گردیم تا
 * برنامه به‌جای خطا دادن، کار کند.
 */
function pickDataDir() {
  if (process.env.SARKHATI_DATA_DIR) return process.env.SARKHATI_DATA_DIR;

  const candidates = [];
  if (process.pkg || require('node:sea').isSea?.()) {
    candidates.push(path.join(path.dirname(process.execPath), 'sarkhati-data'));
  } else {
    candidates.push(path.join(__dirname, '..', 'data'));
  }
  candidates.push(path.join(os.homedir(), '.sarkhati'));

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch { /* بعدی را امتحان کن */ }
  }
  return candidates[candidates.length - 1];
}

const DATA_DIR = pickDataDir();
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const LEARNED_FILE = path.join(DATA_DIR, 'learned.json');
const SYMBOLS_FILE = path.join(DATA_DIR, 'symbols.json');
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
  easyTraderUrl: 'https://easytrader.ir/',
  symbol: '',
  symbolName: '',
  insCode: '',
  quantity: null,
  price: null,
  priceMode: 'manual',    // manual | max | min  — سقف/کف مجاز یا قیمت دستی
  rangePercent: 5,        // دامنهٔ نوسان، فقط برای تخمین وقتی TSETMC آستانه ندهد
  instrument: null,       // آخرین سقف/کف گرفته‌شده از TSETMC
  side: 'buy',            // خرید یا فروش — کدش از سفارش یادگرفته‌شده ساخته می‌شود
  capturedIsSell: false,  // سفارشی که دستی زدید فروش بود یا خرید

  targetTime: '08:45:00',
  targetMillis: 0,        // میلی‌ثانیهٔ ساعت هدف
  preArmSeconds: 60,      // چند ثانیه زودتر شلیک شروع شود
  retryGapMs: 10,         // فاصلهٔ بین دو ارسال، به میلی‌ثانیه
  parallel: 2,            // درخواست هم‌زمان
  fireSeconds: 15,        // چند ثانیه شلیک ادامه پیدا کند
  maxAttempts: 3000,
  leadMs: 0,              // پیش‌فرست: چند میلی‌ثانیه زودتر از لحظهٔ هدف
  clockOffsetMs: 0,
};

// endpoints: درخواست‌های «جست‌وجو» و «اطلاعات نماد» که از خود ایزی‌تریدر
// یاد گرفته می‌شوند تا بشود دربارهٔ نماد دیگری هم از کارگزار پرسید.
const DEFAULT_LEARNED = { recipe: null, history: [], endpoints: {}, candidates: [] };

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

function saveCandidates(candidates) {
  const current = loadLearned();
  const next = { ...current, candidates };
  writeJson(LEARNED_FILE, next);
  return next;
}

function saveEndpoint(kind, endpoint) {
  const current = loadLearned();
  const next = { ...current, endpoints: { ...current.endpoints, [kind]: endpoint } };
  writeJson(LEARNED_FILE, next);
  return next;
}

function saveSymbols(rows, source) {
  writeJson(SYMBOLS_FILE, { fetchedAt: new Date().toISOString(), source, rows });
  return rows;
}

function loadSymbols() {
  const saved = readJson(SYMBOLS_FILE, null);
  if (!saved || !Array.isArray(saved.rows)) return { rows: [], fetchedAt: null, source: null };
  return saved;
}

function saveRecipe(recipe) {
  const current = loadLearned();
  const history = [
    { learnedAt: recipe.learnedAt, label: recipe.label, url: recipe.url },
    ...current.history,
  ].slice(0, 10);
  const next = { ...current, recipe, history };
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
  saveEndpoint,
  saveCandidates,
  saveSymbols,
  loadSymbols,
  resetLearned,
};
