import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================
// 同期 key-value storage ラッパ (MMKV native / localStorage web)
// ============================================================
// 目的:
//   - cold start で hydrate に async/await を一切使わずに済むようにする
//   - AsyncStorage の bridge round-trip (~50-150ms / store) を消す
//   - Web では localStorage を同期で wrap (SSR / 例外時は in-memory)
//   - 旧 AsyncStorage キーからの自動移行ヘルパを提供
//
// 設計メモ:
//   - MMKV は Web をネイティブにサポートしないので Platform 分岐
//   - Web の localStorage は完全同期 API → 直接ラップで OK
//   - JSON は呼び出し側で JSON.stringify / parse する (型安全のため)
// ============================================================

type SyncStorage = {
  set: (key: string, value: boolean | string | number) => void;
  getBoolean: (key: string) => boolean | undefined;
  getString: (key: string) => string | undefined;
  getNumber: (key: string) => number | undefined;
  contains: (key: string) => boolean;
  delete: (key: string) => void;
  getAllKeys: () => string[];
  clearAll: () => void;
};

// ----- Web 実装: localStorage を同期 wrap -----
// SSR / 例外時は in-memory map にフォールバックして API 互換を保つ
function createWebStorage(): SyncStorage {
  const memory = new Map<string, string>();
  const hasLocalStorage = (): boolean => {
    try {
      return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
      return false;
    }
  };
  const getRaw = (key: string): string | null => {
    if (hasLocalStorage()) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        /* fallthrough to memory */
      }
    }
    const v = memory.get(key);
    return v === undefined ? null : v;
  };
  const setRaw = (key: string, value: string): void => {
    if (hasLocalStorage()) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        /* fallthrough to memory */
      }
    }
    memory.set(key, value);
  };
  const delRaw = (key: string): void => {
    if (hasLocalStorage()) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* fallthrough */
      }
    }
    memory.delete(key);
  };
  return {
    set: (key, value) => {
      // MMKV の set と意味を揃える: bool/number は string 化して保存
      if (typeof value === 'boolean') setRaw(key, value ? '1' : '0');
      else if (typeof value === 'number') setRaw(key, String(value));
      else setRaw(key, value);
    },
    getBoolean: (key) => {
      const v = getRaw(key);
      if (v === null) return undefined;
      if (v === '1' || v === 'true') return true;
      if (v === '0' || v === 'false') return false;
      return undefined;
    },
    getString: (key) => {
      const v = getRaw(key);
      return v === null ? undefined : v;
    },
    getNumber: (key) => {
      const v = getRaw(key);
      if (v === null) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    },
    contains: (key) => getRaw(key) !== null,
    delete: (key) => delRaw(key),
    getAllKeys: () => {
      if (hasLocalStorage()) {
        try {
          const keys: string[] = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k !== null) keys.push(k);
          }
          return keys;
        } catch {
          /* fallthrough */
        }
      }
      return Array.from(memory.keys());
    },
    clearAll: () => {
      if (hasLocalStorage()) {
        try {
          window.localStorage.clear();
        } catch {
          /* fallthrough */
        }
      }
      memory.clear();
    },
  };
}

// ----- Native 実装: MMKV を lazy ロード -----
// require は Platform.OS === 'web' のときに評価されないので Web bundle に
// 含まれず、bundler 警告 (mmkv は web 非対応) を避けられる。
function createNativeStorage(): SyncStorage {
  // require は Web では実行されない (Platform.OS で gated)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
  const mmkv = new MMKV({ id: 'geek-v4' });
  return {
    set: (key, value) => mmkv.set(key, value),
    getBoolean: (key) => mmkv.getBoolean(key),
    getString: (key) => mmkv.getString(key),
    getNumber: (key) => mmkv.getNumber(key),
    contains: (key) => mmkv.contains(key),
    delete: (key) => mmkv.delete(key),
    getAllKeys: () => mmkv.getAllKeys(),
    clearAll: () => mmkv.clearAll(),
  };
}

export const storage: SyncStorage =
  Platform.OS === 'web' ? createWebStorage() : createNativeStorage();

// ============================================================
// 同期 helper — 通常はこちらを呼び出す
// ============================================================

export function getString(key: string): string | undefined {
  try {
    return storage.getString(key);
  } catch {
    return undefined;
  }
}

export function setString(key: string, val: string): void {
  try {
    storage.set(key, val);
  } catch {
    /* swallow — storage 書き込み失敗で app を壊さない */
  }
}

export function getBool(key: string): boolean | undefined {
  try {
    return storage.getBoolean(key);
  } catch {
    return undefined;
  }
}

export function setBool(key: string, val: boolean): void {
  try {
    storage.set(key, val);
  } catch {
    /* swallow */
  }
}

export function getNumber(key: string): number | undefined {
  try {
    return storage.getNumber(key);
  } catch {
    return undefined;
  }
}

export function setNumber(key: string, val: number): void {
  try {
    storage.set(key, val);
  } catch {
    /* swallow */
  }
}

export function getJson<T>(key: string): T | undefined {
  try {
    const raw = storage.getString(key);
    if (raw === undefined) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function setJson<T>(key: string, val: T): void {
  try {
    storage.set(key, JSON.stringify(val));
  } catch {
    /* swallow */
  }
}

export function remove(key: string): void {
  try {
    storage.delete(key);
  } catch {
    /* swallow */
  }
}

export function contains(key: string): boolean {
  try {
    return storage.contains(key);
  } catch {
    return false;
  }
}

// ============================================================
// 旧 AsyncStorage からの自動移行ヘルパ
// ============================================================
// - 初回起動時に 1 度だけ実行することを想定
// - 各キーの旧値を AsyncStorage から読み、MMKV / localStorage 側に存在しなければ
//   string としてそのままコピー (callers は JSON.parse で復元する)
// - 旧キーは消さない (rollback 余地を残す) — 必要なら個別 store 側で
//   AsyncStorage.removeItem を呼ぶ。
// - sentinel キーを使って 2 回目以降はスキップ
//
// Web は AsyncStorage が同 localStorage 上に存在するため migrate 不要 — 完全 skip。
//
// 非同期 API なまま (AsyncStorage.multiGet は async) だが、呼び出し側は
// await せずに fire-and-forget で良い — 旧キーは hydrate 後に
// バックグラウンドで MMKV に同期するだけなので、起動 path を blocking しない。
// ただし「初回ユーザーは即時 MMKV に値が無い」ので、stores の hydrate は
// 旧値の同期取得もフォールバックする (各 store 側で実装)。
// ============================================================
export async function migrateFromAsyncStorage(keys: string[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) {
      if (v === null) continue;
      // 既に MMKV にあれば上書きしない (新しい値を保持)
      if (storage.contains(k)) continue;
      storage.set(k, v);
    }
  } catch {
    /* swallow — 移行失敗は致命的でないので app は起動継続 */
  }
}

// 同期版 (旧 AsyncStorage キーを「即座に」MMKV に取り込めるか試みる)。
// 実際には AsyncStorage は非同期なので、これは「既に MMKV にあるか?」の
// 確認のみ。caller は false なら async migrate を kick して、それまでは
// デフォルト値で動く。
export function hasInMmkv(key: string): boolean {
  return contains(key);
}
