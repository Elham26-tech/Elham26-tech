import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

// The three instruments the app watches. `tvSymbol` is what TradingView's data
// feed resolves; override one with e.g. TV_SYMBOL_XAUUSD=TVC:GOLD.
export const INSTRUMENTS = [
  {
    id: 'EURUSD',
    tvSymbol: process.env.TV_SYMBOL_EURUSD || 'OANDA:EURUSD',
    nameFa: 'یورو / دلار',
    nameEn: 'EUR/USD',
    digits: 5,
    pip: 0.0001,
  },
  {
    id: 'XAUUSD',
    tvSymbol: process.env.TV_SYMBOL_XAUUSD || 'OANDA:XAUUSD',
    nameFa: 'طلا (انس / دلار)',
    nameEn: 'Gold XAU/USD',
    digits: 2,
    pip: 0.1,
  },
  {
    id: 'GBPJPY',
    tvSymbol: process.env.TV_SYMBOL_GBPJPY || 'OANDA:GBPJPY',
    nameFa: 'پوند / ین',
    nameEn: 'GBP/JPY',
    digits: 3,
    pip: 0.01,
  },
];

// TradingView resolution codes. Order matters: highest timeframe last, the
// analysis reads top-down from `D` to `15`.
export const TIMEFRAMES = [
  { id: '15', label: '15m', bars: 300 },
  { id: '60', label: '1H', bars: 300 },
  { id: '240', label: '4H', bars: 300 },
  { id: '1D', label: '1D', bars: 300 },
];

export const config = {
  root,
  port: int('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  // Protects every page and API route with HTTP Basic auth. Without it anyone
  // who finds the server can upload files and spend your API credit.
  appUser: process.env.APP_USER || 'admin',
  appPassword: process.env.APP_PASSWORD || '',
  dataSource: (process.env.DATA_SOURCE || 'tradingview').toLowerCase(),
  // Optional TradingView session token for accounts with real-time data; the
  // public token gets the same delayed/real-time feed a logged-out chart sees.
  tvAuthToken: process.env.TV_AUTH_TOKEN || 'unauthorized_user_token',
  tvUrl: process.env.TV_WS_URL || 'wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart',
  tvOrigin: process.env.TV_ORIGIN || 'https://www.tradingview.com',
  model: process.env.AI_MODEL || 'claude-opus-5',
  effort: process.env.AI_EFFORT || 'high',
  // Server-side refusal fallback: a declined request is re-run on Anthropic's
  // recommended model instead of coming back empty. Set AI_FALLBACKS=off to drop it.
  fallbacks: (process.env.AI_FALLBACKS || 'default').toLowerCase() !== 'off',
  // Minutes between automatic AI runs per instrument; 0 = only when asked.
  autoAnalyzeMinutes: int('AUTO_ANALYZE_MINUTES', 0),
  dataDir: path.resolve(root, process.env.DATA_DIR || 'data'),
  maxUploadBytes: int('MAX_UPLOAD_MB', 20) * 1024 * 1024,
};

export function instrument(id) {
  return INSTRUMENTS.find((i) => i.id === id) || null;
}
