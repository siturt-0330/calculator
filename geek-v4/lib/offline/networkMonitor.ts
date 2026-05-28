// ============================================================
// Network Monitor — オフライン/オンライン判定の薄い抽象化
// ============================================================
// 目的:
//   - Web (navigator.onLine + online/offline event)
//   - Native (expo-network があれば使う、無ければ常時 online + AppState で粗く)
//   - zustand store (useNetworkStore) で reactive に購読できるようにする
//
// 既存:
//   - hooks/useNetworkStatus.ts (Web 対応のみ) は壊さない。
//     こちらはより一般的な reactive store として並列に提供する。
//
// 注意:
//   - expo-network は dependency に入っていない可能性が高い。
//     require は try/catch で囲み、無ければ Web polyfill 経路にフォールバック。
//   - service worker / cache strategy は別 PR (web 専用で複雑) → ここでは扱わない。
// ============================================================

import { Platform } from 'react-native';
import { create } from 'zustand';
import { swallow } from '../swallow';

// ----- 型 -----
type Listener = (online: boolean) => void;

type NetworkStore = {
  online: boolean;
  setOnline: (v: boolean) => void;
};

// ----- zustand store -----
// 初期値は同期的に評価できる範囲で「楽観的に online」とする。
// 後段の event listener が即時 navigator.onLine を読みに行って同期する。
export const useNetworkStore = create<NetworkStore>((set) => ({
  online: getInitialOnline(),
  setOnline: (v: boolean) => set((s) => (s.online === v ? s : { online: v })),
}));

function getInitialOnline(): boolean {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    try {
      return navigator.onLine;
    } catch {
      return true;
    }
  }
  return true;
}

// ----- public API -----
let initialized = false;
const listeners = new Set<Listener>();

/**
 * 現在 online か (同期 API)。
 * - Web: navigator.onLine
 * - Native: zustand store の現在値 (event 駆動)
 */
export function isOnline(): boolean {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    try {
      return navigator.onLine;
    } catch {
      return true;
    }
  }
  return useNetworkStore.getState().online;
}

/**
 * ネットワーク状態変化を購読する。
 * 戻り値の関数を呼ぶと unsubscribe される。
 * 1 回目の subscribe で event listener を遅延 setup する。
 */
export function subscribeNetworkChange(callback: Listener): () => void {
  ensureInitialized();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function emit(online: boolean) {
  useNetworkStore.getState().setOnline(online);
  // copy して iterate 中の add/delete を許容
  for (const fn of Array.from(listeners)) {
    try {
      fn(online);
    } catch (e) {
      swallow('networkMonitor.listener', e);
    }
  }
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  if (Platform.OS === 'web') {
    setupWeb();
  } else {
    setupNative();
  }
}

// ----- Web 経路 -----
function setupWeb() {
  if (typeof window === 'undefined') return;
  try {
    // 初期値を再同期
    if (typeof navigator !== 'undefined') {
      useNetworkStore.getState().setOnline(navigator.onLine);
    }
    const handleOnline = () => emit(true);
    const handleOffline = () => emit(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  } catch (e) {
    swallow('networkMonitor.setupWeb', e);
  }
}

// ----- Native 経路 -----
// expo-network が dependency に入っていれば動作。無ければ常時 online。
function setupNative() {
  try {
    // dynamic require — bundle に無くてもクラッシュさせない
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = tryRequireExpoNetwork();
    if (!mod) {
      // expo-network 無し → 常時 online (banner は出ない)
      return;
    }
    // 起動時に 1 回だけ問い合わせ
    if (typeof mod.getNetworkStateAsync === 'function') {
      void mod
        .getNetworkStateAsync()
        .then((s: { isConnected?: boolean; isInternetReachable?: boolean | null }) => {
          const online = s.isConnected !== false && s.isInternetReachable !== false;
          emit(online);
        })
        .catch((e: unknown) => swallow('networkMonitor.getState', e));
    }
    // listener 登録
    if (typeof mod.addNetworkStateListener === 'function') {
      mod.addNetworkStateListener(
        (s: { isConnected?: boolean; isInternetReachable?: boolean | null }) => {
          const online = s.isConnected !== false && s.isInternetReachable !== false;
          emit(online);
        },
      );
    }
  } catch (e) {
    swallow('networkMonitor.setupNative', e);
  }
}

type ExpoNetworkLike = {
  getNetworkStateAsync?: () => Promise<{
    isConnected?: boolean;
    isInternetReachable?: boolean | null;
  }>;
  addNetworkStateListener?: (
    cb: (s: { isConnected?: boolean; isInternetReachable?: boolean | null }) => void,
  ) => { remove?: () => void };
};

function tryRequireExpoNetwork(): ExpoNetworkLike | null {
  try {
    // require が build 時に hard fail しないよう変数経由で。
    // 変数経由なら metro / webpack の静的解析が dependency として扱わず、
    // expo-network が未インストールでもバンドルエラーにならない。
    const name = 'expo-network';
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require(name) as ExpoNetworkLike;
  } catch {
    return null;
  }
}

// ----- test util -----
// テスト用に listener / 初期化フラグをリセットするヘルパ。
// 本番 code path では呼ばない。
export function __resetNetworkMonitorForTests() {
  initialized = false;
  listeners.clear();
  useNetworkStore.getState().setOnline(true);
}
