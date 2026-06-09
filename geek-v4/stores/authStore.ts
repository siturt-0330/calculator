import { create } from 'zustand';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, readPersistedSession } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
import { detachAllChannels } from '../lib/realtime';
import { setUnauthorizedHandler } from '../lib/resilient';
import { swallow } from '../lib/swallow';
import { getBool, setBool, remove as storageRemove, contains as storageContains } from '../lib/storage';
import { checkRate, rateLimitMessage } from '../lib/rateLimit';
import { useOfflineQueueStore } from './offlineQueueStore';
import { useDraftStore } from './draftStore';
import { useBlockStore } from './blockStore';

// onboarded 状態のローカルキャッシュ — プロフィール取得失敗時のフォールバック
//
// MMKV (native) / localStorage (web) を同期で叩く。AsyncStorage の bridge
// round-trip が cold start から消えるので、 hydrate 時の onboarded 復元が
// ~50-150ms 短縮される。
const ONBOARDED_KEY = 'geek-v4-onboarded';
function onboardedKey(userId: string): string {
  return `${ONBOARDED_KEY}:${userId}`;
}
function getCachedOnboardedSync(userId: string): boolean | null {
  const v = getBool(onboardedKey(userId));
  return v === undefined ? null : v;
}
function setCachedOnboardedSync(userId: string, onboarded: boolean): void {
  setBool(onboardedKey(userId), onboarded);
}

// 旧 AsyncStorage キーから 1 度だけ MMKV へ移行 (native のみ)。
// fire-and-forget で kick — hydrate 完了は待たない (旧ユーザーは初回起動 1 回だけ
// MMKV に値が無いので server から正しい値を取得できる)。
async function migrateOnboardedKey(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const key = onboardedKey(userId);
  // 既に MMKV にあればスキップ — AsyncStorage の旧値より新しい
  if (storageContains(key)) return;
  try {
    const v = await AsyncStorage.getItem(key);
    if (v === '1') setBool(key, true);
    else if (v === '0') setBool(key, false);
  } catch {
    /* swallow */
  }
}

type AppUser = User & {
  nickname?: string;
  onboarded?: boolean;
  phone?: string;
  account_state?: 'healthy' | 'caution' | 'restricted' | 'warned' | 'suspended';
};

type SignInResult = {
  error: string | null;
  /** エラー分類コード (UI が文言/導線を分岐するため。raw Supabase メッセージは出さない) */
  code?: 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'network' | 'unknown';
  user?: AppUser;
  next?: 'feed' | 'onboarding';
};

type AuthState = {
  user: AppUser | null;
  /** true になったら auth の初期化 (session 復元 / 有効期限確認) が完了している。 */
  hydrated: boolean;

  /**
   * アプリ起動時に 1 回だけ呼ぶ初期化アクション。
   * - auth listener / storage listener を登録する
   * - 401 → refreshSession → signOut の自動ハンドラを設定する
   * - 永続化 session を復元し、有効期限が切れていれば refreshSession を試みる
   * - 完了後に `hydrated: true` を set する (最悪 13s のタイムアウトで強制完了)
   */
  hydrate: () => Promise<void>;

  /**
   * メール/パスワードでサインインする。
   * @returns `next: 'feed'` = onboarded ユーザー / `next: 'onboarding'` = 初回セットアップが必要
   */
  signIn: (email: string, password: string) => Promise<SignInResult>;

  /**
   * 新規アカウントを作成する。
   * Supabase の email confirmation 設定に応じて 3 通りの結果を返す:
   * - `autoLoggedIn: true` — confirmation 不要ですぐにログイン済
   * - `needsConfirmEmail: true` — confirmation メールを送信済
   * - `error` — 登録失敗
   */
  signUp: (email: string, password: string, phone?: string) => Promise<{ error: string | null; autoLoggedIn: boolean; needsConfirmEmail: boolean }>;

  /**
   * ログアウトする。シングルフライト lock で二重実行を防ぐ。
   * - Supabase session を破棄し、全 realtime channel を detach する
   * - オフラインキュー / 下書き / ブロックリスト / onboarded キャッシュをクリアする
   */
  signOut: () => Promise<void>;

  /**
   * user を直接セットする (onboarding 完了時など)。
   * `onboarded: true` の場合は MMKV / localStorage にも同期キャッシュを書く。
   */
  setUser: (user: AppUser | null) => void;

  /**
   * プロフィールを再取得して user state に merge する。
   * セッション中にアカウント状態が変化した場合 (suspended) は signOut を呼ぶ。
   */
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

// 任意の Promise に timeout を付ける (timeout または rejection 時は null を返す)
// ★ 注意: rejection と timeout は区別されず両方 null を返す。
//   呼び出し元は「null = タイムアウト or ネットワークエラー」として扱い、
//   いずれも安全側 (session 喪失とみなしてリカバリを試みる) に倒す設計。
//   rejection の詳細を知りたい場合は p 側で catch して Sentry に送ること。
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch((err: unknown) => {
      // rejection をログに残して Sentry が拾えるようにする (timeout との区別は
      // できないが、エラー内容は breadcrumb として残る)
      if (err instanceof Error) {
        console.warn('[withTimeout] promise rejected:', err.message);
      }
      return null;
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function buildUser(authUser: User): Promise<AppUser> {
  // 旧 AsyncStorage キーがあれば MMKV へ非同期 migrate (初回のみ)。
  // hydrate 完了は待たない — 旧ユーザー初回限定の 1 回処理。
  void migrateOnboardedKey(authUser.id);
  // プロフィール取得は 3 秒でタイムアウト → ログインを絶対詰まらせない
  const profile = await withTimeout(fetchProfile(authUser.id), 3000);
  let onboarded: boolean | undefined = profile?.onboarded;
  if (onboarded === undefined || onboarded === null) {
    // プロフィール取得失敗 → キャッシュから同期復元 (MMKV/localStorage)
    const cached = getCachedOnboardedSync(authUser.id);
    if (cached !== null) onboarded = cached;
  } else {
    // 同期保存 (失敗時は内部で swallow)
    setCachedOnboardedSync(authUser.id, onboarded);
  }
  return { ...authUser, ...(profile ?? {}), onboarded };
}

// アカウント状態が問題なら強制 signOut してエラーを返す
// 戻り値: null = OK (ログイン続行), string = エラーメッセージ (強制 signOut)
//
// 重要 policy (2026-06): ハードブロックは廃止。suspended でもログインは許可し、
// アプリ内の AccountStateBanner で「停止中・異議申し立て」を表示する方針に変更。
// (誤発火による締め出しを避ける。書き込み等の機能制限はサーバ側 RLS/トリガで担保)
//
// ★ dead-code 注意: この関数は常に null を返す。下記 3 箇所のコールサイト
//   (tryRecoverSession / signIn / refreshProfile) の if (stateError) ブランチは
//   現在デッドコードだが、将来「法的 ban」等で復活させる可能性があるため残す。
//   ブランチを除去するのではなく、本体を差し替えるだけで機能する構造にしておく。
function checkAccountState(_user: AppUser): string | null {
  // suspended ユーザーは AccountStateBanner で in-app 通知 → ここでは拒否しない。
  // 将来 legal_ban 等の新 state が必要になったら: return 'アカウントが停止されました。';
  return null;
}

// ============================================================
// module-scope mutable locks
// ------------------------------------------------------------
// ★ 設計上の注意: これらは module スコープの `let` 変数。
//   Zustand の create() が複数回呼ばれる状況 (テスト / hot-reload) では
//   すべての store インスタンスが同じ変数を共有する。
//   テストでは afterEach に `_resetAuthLocks()` を呼ぶこと。
//   hot-reload 後に `listenerRegistered=true` のまま残ると新 store インスタンスが
//   auth listener を再登録しなくなる (既知の tradeoff — 開発中は要注意)。
// ============================================================
let listenerRegistered = false;
let storageListenerRegistered = false;
// 二重 signOut を防ぐ — module-scope lock
let signOutInFlight = false;

/** テスト用リセット: afterEach で呼ぶことで module-scope lock を初期化する。 */
export function _resetAuthLocks(): void {
  listenerRegistered = false;
  storageListenerRegistered = false;
  signOutInFlight = false;
  recoverInFlight = false;
  lastKnownTokens = null;
}

// ============================================================
// F1/F5: 「投稿中・タブ/アプリ復帰時に急に login に戻る」対策の session 復活
// ------------------------------------------------------------
// auth-js は getUser/refresh/visibility 復帰の失敗時に内部で自律的に SIGNED_OUT を
// 発火し、その前に storage を消す。これを authStore が即 user:null にすると、refresh
// token がまだ生きていてもログイン画面に飛ぶ。直近の有効 session の token を控えておき、
// 明示 signOut 以外の喪失シグナル(SIGNED_OUT / 他タブ storage 消失)では setSession で
// 復活を 1 回試し、本当に失効しているときだけ user:null にする。
// (storage は SIGNED_OUT より前に消されるため、引数なし refreshSession では復活でき
//  ない。控えた refresh_token を setSession に明示的に渡すのが要点。)
// ============================================================
let lastKnownTokens: { access_token: string; refresh_token: string } | null = null;
let recoverInFlight = false;

async function tryRecoverSession(set: (partial: Partial<AuthState>) => void): Promise<void> {
  // setSession 失敗は再度 SIGNED_OUT を発火し得るので二重実行を防ぐ
  if (recoverInFlight) return;
  recoverInFlight = true;
  try {
    const toks = lastKnownTokens;
    if (!toks) {
      set({ user: null });
      return;
    }
    const res = await withTimeout(supabase.auth.setSession(toks), 6000);
    if (res && !res.error && res.data.session?.user) {
      lastKnownTokens = {
        access_token: res.data.session.access_token,
        refresh_token: res.data.session.refresh_token,
      };
      try {
        const recovered = await buildUser(res.data.session.user);
        // 復活させた user が凍結/制限なら復活させない (signIn の stateError と一貫)。
        if (checkAccountState(recovered)) {
          lastKnownTokens = null;
          set({ user: null });
          return;
        }
        set({ user: recovered });
      } catch {
        set({ user: res.data.session.user as AppUser });
      }
      return;
    }
    // 復活不能 = 本当に session 失効
    lastKnownTokens = null;
    set({ user: null });
  } catch (e) {
    swallow('auth.recoverSession', e);
    set({ user: null });
  } finally {
    recoverInFlight = false;
  }
}

function registerAuthListener(set: (partial: Partial<AuthState>) => void) {
  if (listenerRegistered) return;
  listenerRegistered = true;
  supabase.auth.onAuthStateChange(async (event, session) => {
    // 有効 session の token を控える (F1: SIGNED_OUT 時の setSession 復活に使う)。
    // session が無いイベント(SIGNED_OUT)では上書きしないので直前の値が残る。
    if (session?.access_token && session?.refresh_token) {
      lastKnownTokens = { access_token: session.access_token, refresh_token: session.refresh_token };
    }
    // 全イベント明示処理 — ログで debug 可能に
    if (event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_OUT') {
      // 自タブの明示 signOut は素直に user:null (無限復活を防ぐ)。
      if (signOutInFlight) {
        lastKnownTokens = null;
        set({ user: null });
        return;
      }
      // それ以外の SIGNED_OUT は auth-js が getUser/refresh/visibility 失敗で内部発火した
      // もの。即 null 化せず、控えた token で setSession 復活を試す (F1)。
      void tryRecoverSession(set);
      return;
    }
    if (event === 'PASSWORD_RECOVERY') {
      console.log('[authStore] PASSWORD_RECOVERY event — user is in reset flow');
      return;
    }
    if (event === 'TOKEN_REFRESHED') {
      console.log('[authStore] token refreshed');
      // Audit E#4: realtime client は token rotation を自動追従しない。
      // 旧 token を保持し続けた結果、期限切れ後に RLS-gated postgres_changes が
      // silent に配信停止し、UI が古いデータのまま固まる事故が起きる。
      // 新 access_token を全 open channel に再注入する必要がある。
      supabase.realtime.setAuth(session?.access_token ?? null);
      return;
    }
    // SIGNED_IN or USER_UPDATED
    const authUser = session?.user ?? null;
    if (!authUser) {
      set({ user: null });
      return;
    }
    try {
      const next = await buildUser(authUser);
      // 制限アカウントは listener 側で signOut しない (race を避ける) — signIn 側で対処
      set({ user: next });
    } catch (e) {
      console.warn('build user (listener) failed:', e);
      set({ user: authUser as AppUser });
    }
  });
}

// Web 専用: 他タブの storage 変更を検知して同一セッションを共有
function registerStorageListener(set: (partial: Partial<AuthState>) => void) {
  if (storageListenerRegistered) return;
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  storageListenerRegistered = true;
  window.addEventListener('storage', (e) => {
    if (e.key === 'geek-v4-auth') {
      // 他タブで auth storage が消えた。だが token rotation の一瞬の remove や別タブの
      // 一過性 _removeSession でも発火するので、即 logout せず控えた token で setSession
      // 復活を試す (F5)。本当に失効していれば復活に失敗して user:null になる。
      if (e.newValue === null || e.newValue === '') {
        console.log('[authStore] cross-tab auth storage cleared — verifying');
        void tryRecoverSession(set);
      }
    }
  });
}

// ============================================================
// ログアウト時の全ユーザーデータクリア
// ------------------------------------------------------------
// signOut から呼ばれる。store を直接 import して getState() 経由で
// 各 store をリセットする (hook の外でも安全に呼べる getState パターン)。
// ★ 新しいユーザー固有 store が増えたらここにも追加すること。
// ============================================================
function clearAllUserData(userId: string | undefined): void {
  // 下書き: ローカルキャッシュを全消去 (サーバー側は削除しない)
  try { useDraftStore.getState().clearAllDrafts(); } catch (e) { swallow('signOut.clearDrafts', e); }
  // ブロックリスト: ローカルキャッシュを全消去
  try { useBlockStore.getState().clear(); } catch (e) { swallow('signOut.clearBlocks', e); }
  // onboarded キャッシュ
  try {
    if (userId) storageRemove(onboardedKey(userId));
  } catch (e) { swallow('signOut.clearOnboarded', e); }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  hydrated: false,
  hydrate: async () => {
    // 何があってもリスナは登録する
    registerAuthListener(set);
    registerStorageListener(set);
    // 401 (token 期限切れ) を resilient 経由で検知したら signOut する
    setUnauthorizedHandler(async () => {
      const u = get().user;
      if (!u) return; // 既に logged out
      // 401 = アクセストークン期限切れの可能性。即 signOut すると「投稿しようと
      // したら急に login 画面に飛ぶ」事故になる (タブ非アクティブ / アプリ復帰時に
      // auto-refresh が取りこぼすと最初の呼び出しが 401 になる)。
      // まず refreshSession で回復を試し、refresh token が有効なら user を維持。
      // 本当に無効 (refresh も失敗) のときだけ signOut する。
      try {
        const res = await withTimeout(supabase.auth.refreshSession(), 6000);
        if (res && !res.error && res.data.session?.user) {
          console.warn('[authStore] 401 → session refreshed, staying logged in');
          return; // user は維持。onAuthStateChange の TOKEN_REFRESHED が profile を更新
        }
      } catch (e) {
        swallow('auth.refresh.unauthorized', e);
      }
      console.warn('[authStore] 401 detected and refresh failed, forcing signOut');
      await get().signOut();
    });
    // ★ Safety: 一定時間返らなければ hydrated:true で起動継続。
    // 値は hydrate の最悪逐次コスト getSession(3s)+refreshSession(6s)+buildUser(3s)=12s を
    // 上回る 13s にする。7s だと低速回線で「refresh は成功したのにタイマーが先に
    // user:null を確定 → false logout」になっていた (各 await は個別 timeout 済なので
    // 実際に 13s 超ハングはしない。UI は別途 forceReady 500ms で先に出る)。
    let hydrationDone = false;
    const safetyTimer = setTimeout(() => {
      if (!hydrationDone) {
        console.warn('auth hydrate timeout — forcing hydrated:true');
        hydrationDone = true;
        set({ user: null, hydrated: true });
      }
    }, 13000);
    try {
      // ★ getSession() は web で稀に内部 lock/refresh が stall して永遠に返らない
      //   ことがある (backend 健全・token 有効でも発生)。3 秒で race し、stall 時は
      //   永続化済み session を直接読んで起動を継続する (login 画面への張り付き防止)。
      const sessionRes = await withTimeout(supabase.auth.getSession(), 3000);
      if (sessionRes && sessionRes.error) console.warn('getSession error:', sessionRes.error.message);
      let session = sessionRes?.data?.session ?? null;
      if (!sessionRes) {
        console.warn('[authStore] getSession stalled — falling back to persisted session');
        session = await readPersistedSession();
      }
      const authUser = session?.user ?? null;
      let user: AppUser | null = null;
      if (authUser) {
        // session の token expiry を check。
        const expiresAt = session?.expires_at;
        // 期限切れ + 期限が近い(60s 以内)も refresh 対象にする (F7: 起動直後の最初の
        // API 呼び出しが期限切れ目前 token で 401 になるのを防ぐ)。
        if (expiresAt && expiresAt * 1000 < Date.now() + 60_000) {
          // アクセストークン期限切れ/間近。即 signOut せず、まず refreshSession で回復を
          // 試す (アプリを 1 時間以上閉じてから再開すると毎回 login に飛ぶのを防ぐ)。
          // refresh token が無効だったときだけ signOut する。
          console.warn('[authStore] hydrate: token expired/expiring, trying refresh');
          let refreshedUser: User | null = null;
          try {
            const res = await withTimeout(supabase.auth.refreshSession(), 6000);
            if (res && !res.error && res.data.session?.user) {
              refreshedUser = res.data.session.user;
            }
          } catch (e) {
            swallow('auth.refresh.hydrate', e);
          }
          if (refreshedUser) {
            console.warn('[authStore] hydrate: session refreshed, staying logged in');
            try {
              user = await buildUser(refreshedUser);
            } catch (e) {
              console.warn('build user (hydrate refresh) failed:', e);
              user = refreshedUser as AppUser;
            }
          } else {
            console.warn('[authStore] hydrate: refresh failed, forcing signOut');
            // signOut も auth client 経由で stall し得るため timeout を付ける
            try { await withTimeout(supabase.auth.signOut(), 2000); } catch (e) { swallow('auth.signOut.hydrate', e); }
            // F9: bare signOut は channel detach を通らないので明示 detach する
            // (残留 channel が後続の 401 を二次誘発するのを防ぐ)。
            try { detachAllChannels(); } catch (e) { swallow('auth.detach.hydrate', e); }
            lastKnownTokens = null;
          }
        } else {
          try {
            user = await buildUser(authUser);
          } catch (e) {
            console.warn('build user (hydrate) failed:', e);
            user = authUser as AppUser;
          }
        }
      }
      if (!hydrationDone) {
        hydrationDone = true;
        clearTimeout(safetyTimer);
        set({ user, hydrated: true });
      }
    } catch (e) {
      // ★ hydrate 全体の catch — ここに到達するのは上記 try 内の予期しない例外のみ
      //   (各 withTimeout / supabase 呼び出しは個別に catch している)。
      //   user: null にして hydrated: true を必ずセットし、起動を継続する。
      console.warn('auth hydrate failed:', e);
      if (!hydrationDone) {
        hydrationDone = true;
        clearTimeout(safetyTimer);
        set({ user: null, hydrated: true });
      }
    }
  },
  signIn: async (email, password) => {
    // クライアント側レート制限 (brute-force 抑止の一段目)
    const rl = checkRate('login');
    if (!rl.ok) return { error: rateLimitMessage('login', rl.retryAfterMs) };
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
      if (error) {
        // error.message の英語完全一致に頼らず error.code でも分類する
        // (GoTrue のバージョン/ロケール差で message が変わっても死に導線にしない)。
        const ecode = (error as { code?: string }).code ?? '';
        const raw = (error.message ?? '').toLowerCase();
        if (ecode === 'email_not_confirmed' || raw.includes('not confirmed') || raw.includes('confirm')) {
          return { error: 'メールアドレスが未確認です。確認メールのリンクから認証してください。', code: 'email_not_confirmed' };
        }
        if (ecode === 'invalid_credentials' || raw.includes('invalid login credentials') || raw.includes('invalid credentials')) {
          return { error: 'メールアドレスまたはパスワードが正しくありません。', code: 'invalid_credentials' };
        }
        if (ecode === 'over_request_rate_limit' || raw.includes('rate limit') || raw.includes('too many')) {
          return { error: '試行回数が多すぎます。しばらくしてからお試しください。', code: 'rate_limited' };
        }
        console.warn('[signIn] unhandled error:', ecode || error.message);
        return { error: 'ログインに失敗しました。しばらくしてからお試しください。', code: 'unknown' };
      }
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
      // 凍結 / 制限アカウントなら強制 signOut してエラー返却
      const stateError = checkAccountState(user);
      if (stateError) {
        // 凍結/制限アカウントを確実にログアウトさせる。lastKnownTokens を先に消し、
        // signOutInFlight を立てることで、直後の SIGNED_OUT が tryRecoverSession に
        // 渡って凍結ユーザーを復活させる race を防ぐ (security)。
        signOutInFlight = true;
        lastKnownTokens = null;
        try {
          await supabase.auth.signOut();
        } catch (e) {
          swallow('auth.signOut.signIn-stateError', e);
        } finally {
          signOutInFlight = false;
        }
        set({ user: null });
        return { error: stateError };
      }
      set({ user });
      // onboarded が undefined (profile fetch failed) なら安全側 = onboarding に飛ばす
      const next: 'feed' | 'onboarding' = user.onboarded === true ? 'feed' : 'onboarding';
      return { error: null, user, next };
    } catch (e) {
      console.error('signIn exception:', e);
      const msg = e instanceof Error ? e.message : 'ログイン中にエラーが発生しました。';
      return { error: msg };
    }
  },
  signUp: async (email, password, phone) => {
    // クライアント側レート制限 (spam-account 抑止の一段目)
    const rl = checkRate('signup');
    if (!rl.ok) {
      return { error: rateLimitMessage('signup', rl.retryAfterMs), autoLoggedIn: false, needsConfirmEmail: false };
    }
    try {
      const cleanEmail = email.trim().toLowerCase();
      // signUp 自体に 12 秒タイムアウト (ハング防止)
      const signUpRes = await withTimeout(
        supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { phone } },
        }),
        12000,
      );
      if (!signUpRes) {
        return {
          error: 'ネットワークが遅すぎます。接続を確認してもう一度お試しください。',
          autoLoggedIn: false,
          needsConfirmEmail: false,
        };
      }
      const { data, error } = signUpRes;
      if (error) return { error: error.message, autoLoggedIn: false, needsConfirmEmail: false };

      // 電話番号があれば profile に保存 (失敗しても登録自体は成功扱い)
      if (data.user && phone) {
        try {
          await supabase.from('profiles').upsert({ id: data.user.id, phone }).select();
        } catch (e) {
          console.warn('[signUp] profile phone upsert failed:', e);
        }
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
      let lastSignInErr: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 350 * attempt));
        const signInRes = await withTimeout(
          supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          }),
          8000,
        );
        if (!signInRes) {
          // timeout — 次の attempt へ
          lastSignInErr = 'timeout';
          continue;
        }
        const { data: signIn, error: signInErr } = signInRes;
        if (signIn?.session?.user) {
          try {
            const user = await buildUser(signIn.session.user);
            set({ user });
          } catch {
            set({ user: signIn.session.user as AppUser });
          }
          return { error: null, autoLoggedIn: true, needsConfirmEmail: false };
        }
        // "Email not confirmed" → email confirmation が ON 設定
        const errMsg = (signInErr?.message ?? '').toLowerCase();
        lastSignInErr = errMsg || null;
        if (errMsg.includes('email not confirmed') || errMsg.includes('confirm')) {
          return { error: null, autoLoggedIn: false, needsConfirmEmail: true };
        }
        // 認証情報エラー: パスワード間違いなどではここに来ないはず (signUp 成功してるので)
        // 何か別の問題なので次の attempt へ
      }
      // 3 回試して session が取れなかった
      // ネットワーク timeout だった場合はそれを伝える
      if (lastSignInErr === 'timeout') {
        return {
          error: 'ネットワークが不安定です。ログイン画面から再度お試しください。',
          autoLoggedIn: false,
          needsConfirmEmail: false,
        };
      }
      // それ以外: confirmation が必要な可能性が高い (Supabase 設定次第)
      return { error: null, autoLoggedIn: false, needsConfirmEmail: true };
    } catch (e) {
      console.error('signUp exception:', e);
      const msg = e instanceof Error ? e.message : '登録中にエラーが発生しました。';
      return { error: msg, autoLoggedIn: false, needsConfirmEmail: false };
    }
  },
  signOut: async () => {
    // 二重 signOut を防ぐ — シングルフライト lock
    if (signOutInFlight) return;
    signOutInFlight = true;
    try {
      // 先に local state をクリア (UI 即時反映 + 同タブの他コンポーネントが新規 channel を
      // 作るのを防ぐ)
      const u = get().user;
      set({ user: null });
      // 復活用に控えた token も破棄 (明示 logout なので setSession 復活させない)
      lastKnownTokens = null;
      // Supabase 側 — supabase.auth.signOut() が内部 storage adapter 経由で
      // auth key ('geek-v4-auth') を消してくれる。手動 removeItem は不要かつ
      // key 名が変わった場合に no-op になるリスクがあるため撤去 (audit 指摘)。
      try { await supabase.auth.signOut(); } catch (e) { console.warn('signOut error:', e); }
      // 全 realtime channel を強制 detach
      try { detachAllChannels(); } catch (e) { console.warn('detachAllChannels error:', e); }
      // オフラインキューをクリア — 別ユーザーでログイン時に前ユーザーのキューが実行されないように
      try { useOfflineQueueStore.getState().clear(); } catch (e) { console.warn('offlineQueue clear error:', e); }
      // ユーザー固有データを全クリア (下書き / ブロックリスト / onboarded キャッシュ)
      clearAllUserData(u?.id);
      // 旧 AsyncStorage 残骸も掃除 (native のみ。web は supabase.auth.signOut() が処理済)
      if (Platform.OS !== 'web') {
        try { await AsyncStorage.removeItem('geek-v4-auth'); } catch (e) { swallow('storage.auth-key.remove', e); }
      }
    } finally {
      signOutInFlight = false;
    }
  },
  setUser: (user) => {
    // オンボ完了 (onboarded=true) は同期キャッシュにも焼く。これが無いと次回 cold start
    // で profile fetch がタイムアウトした際、buildUser のフォールバックが古い false を
    // 返し、完了済みユーザーがオンボに戻される (再オンボループ) 原因になっていた。
    if (user?.onboarded === true && user.id) {
      setCachedOnboardedSync(user.id, true);
    }
    set({ user });
  },
  refreshProfile: async () => {
    const { user } = get();
    if (!user) return;
    const profile = await fetchProfile(user.id).catch(() => null);
    if (!profile) return;
    const merged = { ...user, ...profile };
    // セッション中に suspended へ移行していたら、ここでも確実にログアウトさせる
    // (signIn / tryRecoverSession は gate するが refreshProfile は素通りだった)
    if (checkAccountState(merged)) {
      await get().signOut();
      return;
    }
    set({ user: merged });
  },
}));
