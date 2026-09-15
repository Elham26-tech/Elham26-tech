import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { Language } from '@/i18n';
import type { ThemeMode } from '@/theme';

const KEY = 'sangbazar.settings';

interface PersistedSettings {
  language: Language;
  theme: ThemeMode;
  favorites: string[];
}

interface SettingsState extends PersistedSettings {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: Language) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleFavorite: (productId: string) => void;
}

const defaults: PersistedSettings = { language: 'fa', theme: 'dark', favorites: [] };

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const stored = raw ? (JSON.parse(raw) as Partial<PersistedSettings>) : {};
      set({ ...defaults, ...stored, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setLanguage: (language) => {
    set({ language });
    persist(get());
  },

  setTheme: (theme) => {
    set({ theme });
    persist(get());
  },

  toggleFavorite: (productId) => {
    const favorites = get().favorites.includes(productId)
      ? get().favorites.filter((id) => id !== productId)
      : [...get().favorites, productId];
    set({ favorites });
    persist(get());
  },
}));

function persist(state: SettingsState) {
  const payload: PersistedSettings = {
    language: state.language,
    theme: state.theme,
    favorites: state.favorites,
  };
  void AsyncStorage.setItem(KEY, JSON.stringify(payload));
}
