// ============================================================
// lib/validation.ts — route param validator
// ============================================================
// セキュリティ目的:
//   route param (post/[id], bbs/[id], photo/[id] 等) を validation せず
//   そのまま useQuery の queryKey に入れて API に渡すと、攻撃者が巨大文字列
//   や injection payload を URL に入れて React Query cache を汚染し UI を
//   hang させる cache DoS ベクタになる。RLS では阻止できないので、client 側
//   で early reject する必要がある。
//
// 使い方:
//   const { id: rawId } = useLocalSearchParams<{ id: string }>();
//   const id = isValidUuid(rawId) ? rawId : null;
//   if (!id) return <無効な URL です UI>;
// ============================================================

// UUID v4 (= 8-4-4-4-12 形式の hex) を検証。
// gen_random_uuid() / crypto.randomUUID() が生成するすべての UUID は
// この形式を満たす。version bit (13 桁目の最初) は厳密チェックしないが、
// 形式さえ満たせば cache key として安全な長さ・charset に bounded される。
export function isValidUuid(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}

// short ID (英数字 + `_-`、1〜maxLen 文字) を検証。
// invite code / 他の短いトークン用。default 64 文字上限。
export function isValidShortId(id: unknown, maxLen = 64): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > maxLen) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

// numeric ID (10 進数, 1〜20 文字) を検証。
// BBS など serial / bigint primary key 用 (現状の geek-v4 は全 UUID だが
// 将来 numeric を導入したときのために残す)。
export function isValidNumericId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > 20) return false;
  return /^\d+$/.test(id);
}
