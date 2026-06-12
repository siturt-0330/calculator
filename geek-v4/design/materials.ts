// ============================================================
// design/materials.ts — Apple 4 段 Material トークン (2026-06-12 新設)
// ------------------------------------------------------------
// expo-blur の intensity と「blur 不可環境 (低速 web / 古い Android)」用の
// fallback 背景色を、Apple の Material 4 段階 (ultraThin / thin / regular / thick)
// の語彙にマップする。散在していた生 intensity (20/36/40/80) に意味を与え、
// 新規実装はこのトークン経由で blur を貼る。
//
// 既存実装との対応 (値の出典 — ★既存ファイルの intensity は変更しない):
//   ultraThin (20) … BlurCard
//   thin      (36) … TabBar (確定版・変更禁止)
//   regular   (55) … 新設 (シート / ポップオーバー / ダイアログ背面想定)
//   thick     (80) … MypageStickyBar / CommunityCollapsingHeader (TopBar 系)
//   ※ album/[id].tsx の 40 は thin 相当 — 今後の改修で thin へ寄せる (別タスク)
// ============================================================

/** Material 1 段分の定義: expo-blur intensity + blur 不可時の半透明 fallback 背景 */
export type MaterialToken = {
  /** expo-blur <BlurView intensity> に渡す値 */
  intensity: number;
  /** blur が使えない環境でのダークテーマ用背景 (半透明単色) */
  fallbackDark: string;
  /** blur が使えない環境でのライトテーマ用背景 (半透明単色) */
  fallbackLight: string;
};

/**
 * Apple 4 段 Material トークン。
 *
 * 運用ルール (Obsidian: Apple Liquid Glass 設計言語より):
 * 1. **nav 層限定** — TabBar / TopBar / sticky header などのナビゲーション層に
 *    だけ使う。コンテンツ (カード / リスト行 / 本文面) には貼らない。
 * 2. **glass-on-glass 禁止** — ガラスの上にガラスを重ねない。重なってしまう
 *    場合は上層を不透明 surface にするか、下層の blur を外す。
 * 3. **動く要素に web の backdrop-filter を載せない** — スクロール追従 /
 *    アニメする要素では再描画コストが激増してカクつく。web で動く要素には
 *    fallbackDark / fallbackLight (半透明単色) を使う。
 */
export const MATERIAL = {
  ultraThin: {
    intensity: 20,
    fallbackDark: 'rgba(22,22,24,0.75)',
    fallbackLight: 'rgba(255,255,255,0.78)',
  },
  thin: {
    intensity: 36,
    fallbackDark: 'rgba(20,20,24,0.84)',
    fallbackLight: 'rgba(255,255,255,0.86)',
  },
  regular: {
    intensity: 55,
    fallbackDark: 'rgba(18,18,22,0.90)',
    fallbackLight: 'rgba(250,250,252,0.92)',
  },
  thick: {
    intensity: 80,
    fallbackDark: 'rgba(14,14,18,0.95)',
    fallbackLight: 'rgba(248,248,250,0.96)',
  },
} as const satisfies Record<string, MaterialToken>;

export type MaterialLevel = keyof typeof MATERIAL;
