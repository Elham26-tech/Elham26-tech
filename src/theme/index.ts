/**
 * Design tokens for the SangBazar app.
 * Palette follows the product infographic: deep navy surfaces, cyan/blue accents,
 * amber for commercial actions (bids, commissions) and green for confirmations.
 */

export type ThemeMode = 'light' | 'dark';

const shared = {
  amber: '#F5A524',
  amberSoft: '#FFF2D6',
  green: '#22C55E',
  greenSoft: '#DCFCE7',
  red: '#EF4444',
  redSoft: '#FEE2E2',
  purple: '#8B5CF6',
  white: '#FFFFFF',
  black: '#000000',
};

/** Every palette key present in both modes; `Palette` is the shape screens consume. */
export interface Palette {
  amber: string;
  amberSoft: string;
  green: string;
  greenSoft: string;
  red: string;
  redSoft: string;
  purple: string;
  white: string;
  black: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  primary: string;
  primarySoft: string;
  text: string;
  textMuted: string;
  textFaint: string;
  overlay: string;
}

export const palettes: Record<ThemeMode, Palette> = {
  dark: {
    ...shared,
    background: '#0A1F3C',
    surface: '#102E55',
    surfaceAlt: '#16395F',
    border: '#1F4D7A',
    primary: '#2E7DF7',
    primarySoft: '#123763',
    text: '#F2F7FF',
    textMuted: '#9DB6D4',
    textFaint: '#6E8CB0',
    overlay: 'rgba(5, 16, 32, 0.72)',
  },
  light: {
    ...shared,
    background: '#F4F7FC',
    surface: '#FFFFFF',
    surfaceAlt: '#EBF1FA',
    border: '#D9E3F0',
    primary: '#1D63D8',
    primarySoft: '#E3EDFD',
    text: '#0A1F3C',
    textMuted: '#5A7290',
    textFaint: '#8A9DB5',
    overlay: 'rgba(10, 31, 60, 0.45)',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const fontSize = {
  caption: 11,
  small: 13,
  body: 15,
  title: 17,
  heading: 21,
  display: 27,
} as const;

/** Module colors used on the home dashboard, mirroring the infographic panels. */
export const moduleColors = {
  mine: '#F5A524',
  market: '#2E7DF7',
  auction: '#EF4444',
  visualizer: '#8B5CF6',
  affiliate: '#22C55E',
  logistics: '#06B6D4',
  trade: '#EC4899',
} as const;
