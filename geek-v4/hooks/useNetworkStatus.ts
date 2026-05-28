// ============================================================
// useNetworkStatus — 軽量ネットワーク状態フック
// ============================================================
// 互換: 旧 interface `{ online: boolean }` を維持。
//
// 実装:
//   - 旧版は hook 内で window.addEventListener('online'/'offline') を直接
//     subscribe していたが、複数箇所で呼ぶと listener 重複が増える。
//   - 新版は lib/offline/networkMonitor.ts の zustand store / event listener
//     を 1 か所に集約し、ここはその select wrapper として機能する。
//   - Native は networkMonitor が expo-network を試し、無ければ常時 online。
// ============================================================
import { useEffect } from 'react';
import { useNetworkStore, subscribeNetworkChange } from '../lib/offline/networkMonitor';

export function useNetworkStatus(): { online: boolean } {
  const online = useNetworkStore((s) => s.online);

  // 副作用: 最初の caller が来た時点で event listener を初期化する。
  // subscribeNetworkChange は initial-only setup を内部で行うため、no-op callback
  // でも OK。callback 自体は呼ばれない (store の reactive 更新で十分)。
  useEffect(() => {
    const unsub = subscribeNetworkChange(() => {});
    return unsub;
  }, []);

  return { online };
}
