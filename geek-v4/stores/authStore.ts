import { create } from 'zustand';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

// onboarded 状態のローカルキャッシュ — プロフィール取得失敗時のフォールバック
const ONBOARDED_KEY = 'geek-v4-onboarded';
async function getCachedOnboarded(userId: string): Promise<boolean | null> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const v = window.localStorage.getItem(`${ONBOARDED_KEY}:${userId}`);
      return v === '1' ? true : v === '0' ? false : null;
    }
    const v = await AsyncStorage.getItem(`${ONBOARDED_KEY}:${userId}`);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}
async function setCachedOnboarded(userId: string, onboarded: boolean) {
  try {
    const v = onboarded ? '1' : '0';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.localStorage.setItem(`${ONBOARDED_KEY}:${userId}`, v);
      return;
    }
    await AsyncStorage.setItem(`${ONBOARDED_KEY}:${userId}`, v);
  } catch {}
}

type AppUser = User & {
  nickname?: string;
  onboarded?: boolean;
  phone?: string;
  account_state?: 'healthy' | 'caution' | 'restricted' | 'warned' | 'suspended';
};

type SignInResult = {
  error: string | null;
  user?: AppUser;
  next?: 'feed' | 'onboarding';
};

type AuthState = {
  user: AppUser | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signUp: (email: string, password: string, phone?: string) => Promise<{ error: string | null; autoLoggedIn: boolean; needsConfirmEmail: boolean }>;
  signOut: () => Promise<void>;
  setUser: (user: AppUser | null) => void;
  refreshProfile: () => Promise<void>;
};

async function fetchProfile(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('nickname, onboarded, phone, account_state')
    .eq('id', userId)
    .single();
  return data as { nickname?: string; onboarded?: boolean; phone?: string; account_state?: 'healthy' | 'caution' | 'restricted' | 'warned' | 'suspended' } | null;
}

// 任意の Promise に timeout を付ける (timeout 時は null を返す)
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function buildUser(authUser: User): Promise<AppUser> {
  // プロフィール取得は 3 秒でタイムアウト → ログインを絶対詰まらせない
  const profile = await withTimeout(fetchProfile(authUser.id), 3000);
  let onboarded = profile?.onboarded;
  if (onboarded === undefined || onboarded === null) {
    // プロフィール取得失敗 → キャッシュから復元
    const cached = await withTimeout(getCachedOnboarded(authUser.id), 1000);
    if (cached !== null) onboarded = cached ?? undefined;
  } else {
    void setCachedOnboarded(authUser.id, onboarded);
  }
  return { ...authUser, ...(profile ?? {}), onboarded };
}

let listenerRegistered = false;

function registerAuthListener(set: (partial: Partial<AuthState>) => void) {
  if (listenerRegistered) return;
  listenerRegistered = true;
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_OUT') {
      set({ user: null });
      return;
    }
    const authUser = session?.user ?? null;
    if (!authUser) {
      set({ user: null });
      return;
    }
    try {
      const next = await buildUser(authUser);
      set({ user: next });
    } catch (e) {
      console.warn('build user (listener) failed:', e);
      set({ user: authUser as AppUser });
    }
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  hydrated: false,
  hydrate: async () => {
    // 何があってもリスナは登録する
    registerAuthListener(set);
    // ★ Safety: getSession / buildUser が何らかの理由で 5 秒以内に返らなければ
    //   hydrated を強制的に true にしてアプリ起動を継続させる
    let hydrationDone = false;
    const safetyTimer = setTimeout(() => {
      if (!hydrationDone) {
        console.warn('auth hydrate timeout — forcing hydrated:true');
        set({ user: null, hydrated: true });
        hydrationDone = true;
      }
    }, 5000);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.warn('getSession error:', error.message);
      const authUser = data?.session?.user ?? null;
      let user: AppUser | null = null;
      if (authUser) {
        try {
          user = await buildUser(authUser);
        } catch (e) {
          console.warn('build user (hydrate) failed:', e);
          user = authUser as AppUser;
        }
      }
      if (!hydrationDone) {
        hydrationDone = true;
        clearTimeout(safetyTimer);
        set({ user, hydrated: true });
      }
    } catch (e) {
      console.warn('auth hydrate failed:', e);
      if (!hydrationDone) {
        hydrationDone = true;
        clearTimeout(safetyTimer);
        set({ user: null, hydrated: true });
      }
    }
  },
  signIn: async (email, password) => {
    try {
      // signInWithPassword 自体に 10 秒タイムアウト
      const signInRes = await withTimeout(
        supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        }),
        10000,
      );
      if (!signInRes) {
        return { error: 'ネットワークが遅すぎます。接続を確認してもう一度お試しください。' };
      }
      const { data, error } = signInRes;
      if (error) return { error: error.message };
      if (!data?.session?.user) {
        return { error: 'セッションを取得できませんでした。もう一度お試しください。' };
      }
      // buildUser はもう内部でタイムアウト処理済み (3秒)
      let user: AppUser;
      try {
        user = await buildUser(data.session.user);
      } catch (e) {
        console.warn('build user (signIn) failed:', e);
        user = data.session.user as AppUser;
      }
      set({ user });
      const next: 'feed' | 'onboarding' = user.onboarded ? 'feed' : 'onboarding';
      return { error: null, user, next };
    } catch (e) {
      console.error('signIn exception:', e);
      const msg = e instanceof Error ? e.message : 'ログイン中にエラーが発生しました。';
      return { error: msg };
    }
  },
  signUp: async (email, password, phone) => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { phone } },
      });
      if (error) return { error: error.message, autoLoggedIn: false, needsConfirmEmail: false };

      if (data.user && phone) {
        try {
          await supabase.from('profiles').upsert({ id: data.user.id, phone }).select();
        } catch {}
      }

      // ケース 1: signUp 直後に session が返ってきた = email confirmation 無効
      if (data.session?.user) {
        try {
          const user = await buildUser(data.session.user);
          set({ user });
        } catch {
          set({ user: data.session.user as AppUser });
        }
        return { error: null, autoLoggedIn: true, needsConfirmEmail: false };
      }

      // ケース 2: セッション無し → 自動ログイン試行 (短い backoff で 3 回)
      // タイミング race と Supabase の伝播遅延を吸収
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 350 * attempt));
        const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signIn?.session?.user) {
          try {
            const user = await buildUser(signIn.session.user);
            set({ user });
          } catch {
            set({ user: signIn.session.user as AppUser });
          }
          return { error: null, autoLoggedIn: true, needsConfirmEmail: false };
        }
        // "Email not confirmed" エラーが返ってくるなら email confirmation が ON 設定
        if (signInErr?.message?.toLowerCase().includes('email not confirmed')
            || signInErr?.message?.toLowerCase().includes('confirm')) {
          return { error: null, autoLoggedIn: false, needsConfirmEmail: true };
        }
      }
      // 3 回試して session が取れなかった (理由不明)
      return { error: null, autoLoggedIn: false, needsConfirmEmail: true };
    } catch (e) {
      console.error('signUp exception:', e);
      const msg = e instanceof Error ? e.message : '登録中にエラーが発生しました。';
      return { error: msg, autoLoggedIn: false, needsConfirmEmail: false };
    }
  },
  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('signOut error:', e);
    }
    set({ user: null });
  },
  setUser: (user) => set({ user }),
  refreshProfile: async () => {
    const { user } = get();
    if (!user) return;
    const profile = await fetchProfile(user.id).catch(() => null);
    if (profile) set({ user: { ...user, ...profile } });
  },
}));
