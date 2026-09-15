import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { setAuthToken } from '@/api/client';
import { completeProfile, verifyOtp } from '@/api/services';
import type { Session, User, UserRole } from '@/api/types';

const TOKEN_KEY = 'anbarsang.session.token';
const REFRESH_KEY = 'anbarsang.session.refresh';
const USER_KEY = 'anbarsang.session.user';

/**
 * SecureStore is unavailable on web, so the token falls back to AsyncStorage
 * there. Native builds keep it in the keychain / keystore.
 */
const secureSet = async (key: string, value: string) =>
  Platform.OS === 'web' ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value);

const secureGet = async (key: string) =>
  Platform.OS === 'web' ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);

const secureDelete = async (key: string) =>
  Platform.OS === 'web' ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key);

interface AuthState {
  hydrated: boolean;
  token: string | null;
  user: User | null;
  /** True between OTP verification and profile completion for a brand-new account. */
  needsProfile: boolean;
  hydrate: () => Promise<void>;
  signIn: (phone: string, code: string) => Promise<{ needsProfile: boolean }>;
  finishProfile: (input: { name: string; company?: string; role: UserRole }) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  hydrated: false,
  token: null,
  user: null,
  needsProfile: false,

  hydrate: async () => {
    try {
      const [token, rawUser] = await Promise.all([secureGet(TOKEN_KEY), AsyncStorage.getItem(USER_KEY)]);
      const user = rawUser ? (JSON.parse(rawUser) as User) : null;
      setAuthToken(token);
      set({
        token,
        user,
        needsProfile: Boolean(token && user && !user.name),
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  signIn: async (phone, code) => {
    const result = await verifyOtp(phone, code);
    await persistSession(result);
    setAuthToken(result.token);
    const needsProfile = result.isNewUser || !result.user.name;
    set({ token: result.token, user: result.user, needsProfile });
    return { needsProfile };
  },

  finishProfile: async ({ name, company, role }) => {
    const current = get().user;
    if (!current) throw new Error('No signed-in user to update.');
    const updated = await completeProfile({ name, company, role, user: current });
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
    set({ user: updated, needsProfile: false });
  },

  signOut: async () => {
    await Promise.all([
      secureDelete(TOKEN_KEY),
      secureDelete(REFRESH_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
    setAuthToken(null);
    set({ token: null, user: null, needsProfile: false });
  },
}));

async function persistSession(session: Session) {
  await Promise.all([
    secureSet(TOKEN_KEY, session.token),
    secureSet(REFRESH_KEY, session.refreshToken),
    AsyncStorage.setItem(USER_KEY, JSON.stringify(session.user)),
  ]);
}
