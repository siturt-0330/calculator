import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { ENV } from './env';

// Web: localStorage を Promise ラップ。SSR/Node では in-memory にフォールバック。
const memoryStore = new Map<string, string>();

const webStorage = {
  getItem: async (k: string): Promise<string | null> => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(k);
      }
    } catch {}
    return memoryStore.get(k) ?? null;
  },
  setItem: async (k: string, v: string): Promise<void> => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(k, v);
        return;
      }
    } catch {}
    memoryStore.set(k, v);
  },
  removeItem: async (k: string): Promise<void> => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(k);
        return;
      }
    } catch {}
    memoryStore.delete(k);
  },
};

const storage = Platform.OS === 'web' ? webStorage : AsyncStorage;

export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
  auth: {
    storage,
    storageKey: 'geek-v4-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});
