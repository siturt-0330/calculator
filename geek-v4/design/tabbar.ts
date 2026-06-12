// ============================================================
// design/tabbar.ts — タブバー寸法トークン
// ============================================================
//
// ⚠️ 二重定義の注意 (2026-06-12 監査):
//   TabBar.tsx (components/nav/TabBar.tsx・確定版/変更禁止) は **このファイルを import せず**
//   FAB_SIZE=60 / FAB_GAP / indicator 等を内部定数として独自に持つ。
//   そのため以下のキーは TabBar.tsx 内に実体があり、ここの値は dead (2026-06-12 監査):
//     indicatorH / indicatorW / bgBlur / fabSize / fabOffset / labelGap (参照 0 件)
//   削除はしない — TabBar.tsx が locked で参照をこちらへ移せないため、誤って
//   「正の値」と信じて使われないよう @deprecated 注記のみ付ける。
//
//   現役で使われているキー:
//     height     — 約 20 画面の contentContainer paddingBottom 計算
//     iconSize / iconStroke — components/nav/TabIcon.tsx
export const TABBAR = {
  height:      64,
  iconSize:    26,
  iconStroke:  2.2,
  /** @deprecated TabBar.tsx 内に実体があり、ここの値は dead (2026-06-12 監査)。参照 0 件 */
  indicatorH:  3,
  /** @deprecated TabBar.tsx 内に実体があり、ここの値は dead (2026-06-12 監査)。参照 0 件 */
  indicatorW:  28,
  /** @deprecated TabBar.tsx 内に実体があり、ここの値は dead (2026-06-12 監査)。参照 0 件 */
  bgBlur:      24,
  /** @deprecated TabBar.tsx 内に実体があり、ここの値は dead (2026-06-12 監査)。参照 0 件 (実体は TabBar.tsx の FAB_SIZE=60 — 値も既に乖離) */
  fabSize:     56,
  /** @deprecated TabBar.tsx 内に実体があり、ここの値は dead (2026-06-12 監査)。参照 0 件 */
  fabOffset:   -8,
  /** @deprecated TabBar.tsx 内に実体があり、ここの値は dead (2026-06-12 監査)。参照 0 件 */
  labelGap:    2,
} as const;
