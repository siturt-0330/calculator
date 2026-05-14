import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

type AppUser = User & { nickname?: string; onboarded?: boolean };

type AuthState = {
  user: AppUser | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  setUser: (user: AppUser | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  hydrated: false,
  hydrate: async () => {
    try {
      const { data } = await supabase.auth.getSession();
      set({ user: (data.session?.user as AppUser) ?? null, hydrated: true });
      supabase.auth.onAuthStateChange((_event, session) => {
        set({ user: (session?.user as AppUser) ?? null });
      });
    } catch {
      set({ hydrated: true });
    }
  },
  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },
  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null });
  },
  setUser: (user) => set({ user }),
}));
