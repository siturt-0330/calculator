// ============================================================
// stableKeyFor — 大量 ID を含む TanStack Query キーを安定 hash 化
// ============================================================
// reactions / community-stamp-reactions / bbs-reply-reactions の queryKey
// に postIds / replyIds を `.join(',')` でそのまま入れていたが、200+ ID に
// なると key が数 KB に膨らんで devtools が重く、また key 比較コストが上がる。
// 50 件以下は join のまま (デバッグしやすい)、超えたら短い決定論ハッシュに畳む。
//
// アルゴリズム: djb2 hash (32bit, deterministic, 同じ入力で必ず同じ出力)。
// 戻り値は `n<件数>:<base36 hash>` で、件数だけは見えるようにしている。
// ============================================================
export function stableKeyFor(sortedIds: string[]): string {
  if (sortedIds.length <= 50) return sortedIds.join(',');
  let h = 5381;
  const s = sortedIds.join(',');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `n${sortedIds.length}:${(h >>> 0).toString(36)}`;
}
