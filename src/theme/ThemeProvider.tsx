import React, { createContext, useContext, useMemo } from 'react';

import { dictionaries, interpolate, isRtlLanguage, type Dictionary, type Language } from '@/i18n';
import { useSettingsStore } from '@/store/settings';
import { palettes, type Palette, type ThemeMode } from '@/theme';

interface AppTheme {
  mode: ThemeMode;
  colors: Palette;
  language: Language;
  isRtl: boolean;
  /** Writing direction for the current language; applied per-view rather than globally. */
  direction: 'rtl' | 'ltr';
  t: Dictionary;
  /** Fills `{{name}}` style placeholders in a translated string. */
  tr: (template: string, params?: Record<string, string | number>) => string;
}

const ThemeContext = createContext<AppTheme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);

  const value = useMemo<AppTheme>(() => {
    const isRtl = isRtlLanguage(language);
    return {
      mode,
      colors: palettes[mode],
      language,
      isRtl,
      direction: isRtl ? 'rtl' : 'ltr',
      t: dictionaries[language],
      tr: interpolate,
    };
  }, [mode, language]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return ctx;
}
