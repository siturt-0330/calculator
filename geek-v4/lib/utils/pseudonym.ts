// ============================================================
// lib/utils/pseudonym.ts — pseudonym_id トークンから安定した「擬似ハンドル + 色」を導出
// ------------------------------------------------------------
// GEEK は匿名 SNS。実名 (profiles.nickname) は絶対に出さないが、フィード/コメント欄で
// 「誰が誰か分からない」を解消するため、サーバが供給する pseudonym_id トークンから
// 決定的に短い擬似ハンドルと表示色を生成する。
//   ★ de-anon Phase2: 入力は author_id ではなく server 供給の pseudonym_id。
//     author_id を client で扱わない (実名特定ホールを塞ぐ) ための置換。
//   - 一方向ハッシュのみ使用 → ハンドルから token/実名へは戻せない (匿名性維持)
//   - 同じ pseudonym_id → 必ず同じ handle / color / initial (スレッドを跨いでも一貫)
//   - 異なる pseudonym_id → 高確率で別の handle (4 文字 base36 = 約 168 万通り)
// ============================================================

// 表示色パレット (design/tokens の各種アクセント色から、視認しやすい 12 色)。
const PALETTE = [
  '#7C6AF7', '#22D3A4', '#F5A623', '#E24B4A', '#F472B6', '#3B82F6',
  '#9F96F9', '#52D49B', '#FBAC72', '#cca87a', '#9a7acc', '#7a9a7a',
] as const;

// FNV-1a 32bit。短くて衝突分布が良い決定的ハッシュ。
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Pseudonym = {
  /** 表示用ハンドル (例: "K7X2")。実名ではない。 */
  handle: string;
  /** アバター/アクセントに使う安定色 */
  color: string;
  /** アバターに 1 文字だけ出す用 (例: "K") */
  initial: string;
};

/**
 * pseudonym_id トークンから擬似ハンドル / 色 / 頭文字を決定的に導出する。
 *
 * @param pseudonymId server が供給する pseudonym_id トークン (NOT author_id)。
 *   null / 空 のときは safety fallback として handle='匿名' を返す。
 */
export function pseudonymFor(pseudonymId: string | null | undefined): Pseudonym {
  if (!pseudonymId) {
    return { handle: '匿名', color: PALETTE[0], initial: '匿' };
  }
  const u = hash32(pseudonymId);
  const token = u.toString(36).slice(0, 4).toUpperCase(); // 例 "K7X2"
  return {
    handle: token,
    color: PALETTE[u % PALETTE.length] ?? PALETTE[0],
    initial: token.slice(0, 1) || '匿',
  };
}
