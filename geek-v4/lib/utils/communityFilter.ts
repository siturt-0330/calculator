// ============================================================
// communityFilter — コミュニティ別 post 絞り込みヘルパ
// ============================================================
// app/(tabs)/community/index.tsx で「YouTube 登録チャンネル風」の
// avatar 行から特定コミュを選んだ時の filter ロジック純関数化。
//
// 設計判断:
//   - selectedCommunityId === null は「すべて」表示 (= 無加工で返す)
//   - communityByPost map に乗っていない post は selected 時に除外
//     (post が attach 状況不明 = 該当 community 判定不可)
//   - 純関数: stateless / no side-effect / referential transparency 保証
// ============================================================

import type { Post } from '../../types/models';
import type { CommunityMetaLite } from '../api/communities';

/**
 * 指定 community に属する post のみを返す。
 *
 * @param posts            community feed 全 post (merge 済)
 * @param communityByPost  post.id → CommunityMetaLite の map
 * @param selectedCommunityId  選択中のコミュ id (null = 「すべて」 = 無加工)
 * @returns filter された post 配列 (順序は元配列維持)
 */
export function filterPostsByCommunity(
  posts: Post[],
  communityByPost: Record<string, CommunityMetaLite>,
  selectedCommunityId: string | null,
): Post[] {
  if (!selectedCommunityId) return posts;
  return posts.filter((p) => communityByPost[p.id]?.id === selectedCommunityId);
}

/**
 * 各 community に属する post の数を集計。avatar 行のバッジ表示等で利用。
 *
 * @param posts            community feed 全 post
 * @param communityByPost  post.id → CommunityMetaLite の map
 * @returns community.id → count の Map (post が無い community は entry 無し)
 */
export function countPostsPerCommunity(
  posts: Post[],
  communityByPost: Record<string, CommunityMetaLite>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const cid = communityByPost[p.id]?.id;
    if (!cid) continue;
    counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }
  return counts;
}
