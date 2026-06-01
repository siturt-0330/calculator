import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createClient, type Session } from '@supabase/supabase-js';
import { ENV } from './env';

// react-native-url-polyfill は iOS/Android の Hermes / JSC で必要
// (URL/URLSearchParams が部分的にしか実装されていないため)。
// Web には標準 URL があるので polyfill は不要 — Platform 分岐で
// バンドルから外して Web bundle を軽量化する。
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-url-polyfill/auto');
}

// Web: localStorage を Promise ラップ。SSR/Node では in-memory にフォールバック。
const memoryStore = new Map<string, string>();

const webStorage = {
  getItem: async (k: string): Promise<string | null> => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(k);
      }
    } catch { /* localStorage が使えない環境 (Safari ITP 等) → memory にフォールバック */ }
    return memoryStore.get(k) ?? null;
  },
  setItem: async (k: string, v: string): Promise<void> => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(k, v);
        return;
      }
    } catch { /* localStorage が使えない環境 → memory にフォールバック */ }
    memoryStore.set(k, v);
  },
  removeItem: async (k: string): Promise<void> => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(k);
        return;
      }
    } catch { /* localStorage が使えない環境 → memory にフォールバック */ }
    memoryStore.delete(k);
  },
};

// ============================================================
// Native (iOS/Android): SecureStore (Keychain/Keystore) で session token を暗号化保存
// ============================================================
//
// セキュリティ監査 (high finding):
//   AsyncStorage は平文保存 → 物理盗難時に JWT (access_token / refresh_token) が
//   そのまま読まれ session hijack 可能。Native では SecureStore (iOS Keychain /
//   Android Keystore) に移行して OS レベルで暗号化する。
//
// SecureStore の制約:
//   1. key は英数字 + "._-" のみ (ensureValidKey で validation)
//   2. value は 2048 byte 推奨上限 (超えると console.warn + 将来 throw 予定)
//   3. SDK 14 系 (現バージョン) では超過でも書き込み自体は成功する場合あり
//
// Supabase session JSON のサイズ:
//   typical: 1-2KB (access_token JWT ~700-900 byte + refresh_token ~150 byte +
//            user metadata + provider_token 等)
//   max: 3-4KB 超え得る (user_metadata が大きい場合 / 追加 claim)
//
// 対策: 安全側で chunking を実装。
//   - meta key (__meta) に chunk 数を保存
//   - chunk_0, chunk_1, ... に分割保存 (各 1800 byte = 余裕めの上限)
//   - 旧 single-value 形式 (chunk 無し) も後方互換で読める
//
// 注意: 既存ユーザーは AsyncStorage に session を持つため初回起動時に
//   一度 signed out 状態になる (再ログイン必要)。
//   migration は SDK 内部キー形式の差異が大きく fragile なため省略。
const SECURE_PREFIX = 'geekv4_';
const SECURE_CHUNK_SIZE = 1800; // 2048 上限に対する余裕分

function secureKey(k: string): string {
  // SecureStore は [A-Za-z0-9._-] のみ許容。それ以外を _ に置換。
  return SECURE_PREFIX + k.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function chunkKey(baseKey: string, index: number): string {
  return `${baseKey}__c${index}`;
}

function metaKey(baseKey: string): string {
  return `${baseKey}__meta`;
}

const nativeSecureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const base = secureKey(key);
    try {
      // 新形式 (chunked): meta key を見る
      const meta = await SecureStore.getItemAsync(metaKey(base));
      if (meta) {
        const count = parseInt(meta, 10);
        if (Number.isFinite(count) && count > 0) {
          const parts: string[] = [];
          for (let i = 0; i < count; i++) {
            const part = await SecureStore.getItemAsync(chunkKey(base, i));
            if (part === null) return null; // 欠損 → 不整合扱いで null
            parts.push(part);
          }
          return parts.join('');
        }
      }
      // 後方互換: 単一 key 形式 (chunking 導入前の値)
      return await SecureStore.getItemAsync(base);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    const base = secureKey(key);
    // F6: keychainAccessible を AFTER_FIRST_UNLOCK にして、端末ロック中/バックグラウンドの
    // token rotation 書き込みが Keychain アクセス不能で失敗 → session 永久消失するのを防ぐ。
    const saveOpts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
    try {
      // 旧 chunk 数を控える (新規書き込み後に「余った」旧 chunk を掃除するため)。
      let oldCount = 0;
      try {
        const oldMeta = await SecureStore.getItemAsync(metaKey(base));
        if (oldMeta) {
          const n = parseInt(oldMeta, 10);
          if (Number.isFinite(n) && n > 0) oldCount = n;
        }
      } catch {
        /* ignore */
      }

      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += SECURE_CHUNK_SIZE) {
        chunks.push(value.slice(i, i + SECURE_CHUNK_SIZE));
      }
      // 空文字列の場合は 1 chunk (空) を書く
      if (chunks.length === 0) chunks.push('');
      const count = chunks.length;

      // ★ F6: 旧データを「先に消さない」。新 chunk を書き切ってから meta(=コミット点)を
      //   書き、最後に「新 count を超える旧 chunk + 旧単一 key」だけ掃除する。これにより
      //   書き込みが途中失敗しても旧 session が即座に全消失しない (delete-before-write だと
      //   1 回の失敗で session 全損 → 次回起動で login だった)。掃除対象は meta が指す範囲外
      //   なので getItem の読みを壊さない。
      for (let i = 0; i < count; i++) {
        await SecureStore.setItemAsync(chunkKey(base, i), chunks[i] ?? '', saveOpts);
      }
      await SecureStore.setItemAsync(metaKey(base), String(count), saveOpts);

      // コミット後の掃除: 余剰の旧 chunk と旧単一 key 形式の残骸を削除 (失敗は無視)。
      for (let i = count; i < oldCount; i++) {
        await SecureStore.deleteItemAsync(chunkKey(base, i)).catch(() => {});
      }
      await SecureStore.deleteItemAsync(base).catch(() => {});
    } catch (e) {
      // SecureStore 失敗 (Keychain 利用不可・wipe 等) → AsyncStorage への silent fallback は
      // 意図的にしない (権限を下げるため)。結果: 次回起動で再ログイン要求。
      // F6: サイレント消失を観測可能にするため warn を残す。
      console.warn('[securestore] setItem failed (session may be lost):', e);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    const base = secureKey(key);
    try {
      const meta = await SecureStore.getItemAsync(metaKey(base));
      if (meta) {
        const count = parseInt(meta, 10);
        if (Number.isFinite(count) && count > 0) {
          for (let i = 0; i < count; i++) {
            await SecureStore.deleteItemAsync(chunkKey(base, i)).catch(() => {});
          }
        }
        await SecureStore.deleteItemAsync(metaKey(base)).catch(() => {});
      }
      // 旧単一 key 形式も掃除
      await SecureStore.deleteItemAsync(base).catch(() => {});
    } catch {
      /* ignore */
    }
  },
};

// Supabase auth storage interface は async getItem/setItem/removeItem を受け取る。
// - Web: localStorage (HTTPS + SameSite cookie で守られているため平文で OK)
// - Native: SecureStore (Keychain/Keystore で暗号化)
const storage = Platform.OS === 'web' ? webStorage : nativeSecureStorage;

// supabase auth の永続化キー。createClient の storageKey と
// readPersistedSession() の fallback 読み出しで同一キーを共有する。
export const AUTH_STORAGE_KEY = 'geek-v4-auth';

// ============================================================
// Native 限定: 旧 AsyncStorage に残った session を起動時に破棄
// ============================================================
//
// 既存ユーザーの AsyncStorage に session が平文で残ったままだと、
// SecureStore 移行のセキュリティ目的 (平文 token を物理盗難から守る) が無効化される。
// 起動時に fire-and-forget で旧 key を消す (再ログイン後 SecureStore のみ使用される)。
//
// 注意: これは migration ではなく cleanup。session 自体は復元せず、
//       ユーザーは再ログインが必要になる (UX 劣化 < セキュリティ確保)。
if (Platform.OS !== 'web') {
  void (async () => {
    try {
      await AsyncStorage.removeItem('geek-v4-auth');
    } catch {
      /* swallow — 削除失敗しても起動を止めない */
    }
  })();
}

export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
  auth: {
    storage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  // 1000+ 並行ユーザー時に Realtime fanout の過剰配信を抑える。
  // events/sec の上限を 5 にすることで、人気投稿に大量反応が来ても
  // クライアント側の throttle で過剰な invalidate/re-render を防ぐ。
  // (旧 10 → 5 へ更に conservative に。1000 並行ユーザー時の fanout 過剰を抑制)
  realtime: {
    params: { eventsPerSecond: 5 },
  },
  // PostgREST の Accept-Profile を毎回送らない (重複ヘッダで RTT が長くなる小さい最適化)
  // → REST API のリクエストヘッダが軽量化
  global: {
    headers: { 'x-client-info': 'geek-v4' },
  },
});

// ============================================================
// getSession() stall 対策: 永続化された session を直接読む fallback
// ------------------------------------------------------------
// supabase-js の auth.getSession() は web で稀に内部の lock / refresh
// 機構が stall し、有効な session が localStorage にあっても永遠に
// 返らないことがある (バックエンド健全・token 有効でも発生)。
// 結果 authStore.hydrate の safety timeout に落ちて user:null となり、
// ログイン画面に張り付く事故が起きる。
//   → hydrate 側で getSession を timeout させ、stall 時はこの helper で
//     永続 session を直接復元して起動を継続する。
// storage / storageKey は createClient に渡したものと同一を使うので、
// web (localStorage) / native (SecureStore) のどちらでも整合する。
// ============================================================
export async function readPersistedSession(): Promise<Session | null> {
  try {
    const raw = await storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // supabase-js v2 は session を直接保存。旧 v1 形式 (currentSession ラップ) も許容。
    const wrapped = parsed as { currentSession?: unknown };
    const session = (wrapped?.currentSession ?? parsed) as Session | null;
    if (!session || !session.user || !session.access_token) return null;
    return session;
  } catch {
    return null;
  }
}
