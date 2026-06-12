import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

// ============================================================
// TabBarScrollContext — タブ画面 ⇄ TabBar 間の scrollY 共有
// ------------------------------------------------------------
// 仕様 (2026-06-12 / ChatGPT 仕様の scroll-driven shrink TabBar):
//   - 各タブ画面 (feed / search / community / mypage) の主スクロールの
//     `contentOffset.y` を **同一の SharedValue** に書き込む。
//   - TabBar は SharedValue を購読し、interpolate で
//     width / borderRadius / opacity を補間して
//     「横長 pill → 中央寄せ円形フローティング」へモーフィングする。
//
// 設計判断:
//   1. **plain JS handler + SharedValue 直接代入** で統一。
//      `useAnimatedScrollHandler` は plain FlashList の `onScroll` に
//      渡しても web で動かないため (mypage.tsx 既存コメント [実証済])、
//      `onScroll={(e) => { sv.value = e.nativeEvent.contentOffset.y; }}`
//      の素朴な書き方が「native + web」両対応の最大公約数。
//      SharedValue.value への代入は worklet/JS 両スレッドから OK。
//   2. Context 直下に SharedValue を 1 個だけ提供。各タブ画面が
//      ホットなマウント時に異なる SV を持っていると、TabBar が
//      購読対象を切り替えられないため。Provider は (tabs)/_layout.tsx
//      の一番外側に置き、寿命をタブナビ全体に揃える。
//   3. SSR / Provider 外で呼ばれた場合は null を返す
//      (TabBar は null チェックして「shrink しない」フォールバック)。
// ============================================================

const TabBarScrollContext = createContext<SharedValue<number> | null>(null);

export function TabBarScrollProvider({ children }: { children: ReactNode }) {
  // Provider マウント時に 1 度だけ作って以降は使い回す。
  const sv = useSharedValue(0);
  const value = useMemo(() => sv, [sv]);
  return <TabBarScrollContext.Provider value={value}>{children}</TabBarScrollContext.Provider>;
}

/**
 * TabBar shrink 用の SharedValue を取得する。
 * Provider 外なら null。タブ画面側は null チェック不要 (`?.value=...` で代入)。
 */
export function useTabBarScrollSV(): SharedValue<number> | null {
  return useContext(TabBarScrollContext);
}
