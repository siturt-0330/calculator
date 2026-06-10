// ============================================================
// communityFilter — コミュニティ別 post 絞り込みヘルパ
// ============================================================
// app/(tabs)/community/index.tsx で「YouTube 登録チャンネル風」の
// avatar 行から特定コミュを選んだ時の filter ロジック純関数化。
//
// 設計判断:
//   - selectedCommunityId === null は「すべて」表示 (= 無加工で返す)
//   - 判定は post→「所属する全 community id」の配列で行い、選択コミュが含まれれば残す。
//     ★ 1 投稿が複数コミュに cross-post される (post_communities に複数行) ため、
//       「代表 1 community」で判定すると「最新 attach 先 ≠ 選択コミュ」の投稿が
//       全除外されてしまう (タブには出ないがコミュ詳細には出る不一致バグ)。
//       所属全コミュの集合で「いずれか一致」を見るのが正しい。
//   - 集合に乗っていない post は selected 時に除外 (該当 community 判定不可)
//   - 純関数: stateless / no side-effect / referential transparency 保証
// ============================================================

import type { Post } from '../../types/models';

// 参照安定の空配列 (?? [] で毎回新参照を作らない)
const EMPTY_IDS: readonly string[] = [];

/**
 * 指定 community に属する post のみを返す。
 *
 * @param posts                community feed 全 post (merge 済)
 * @param communityIdsByPost   post.id → 所属する全 community id の配列
 * @param selectedCommunityId  選択中のコミュ id (null = 「すべて」 = 無加工)
 * @returns filter された post 配列 (順序は元配列維持)
 */
export function filterPostsByCommunity(
  posts: Post[],
  communityIdsByPost: Record<string, string[]>,
  selectedCommunityId: string | null,
): Post[] {
  if (!selectedCommunityId) return posts;
  return posts.filter((p) =>
    (communityIdsByPost[p.id] ?? EMPTY_IDS).includes(selectedCommunityId),
  );
}

/**
 * 各 community に属する post の数を集計。avatar 行のバッジ表示等で利用。
 * cross-post された post は所属する各 community で +1 される。
 *
 * @param posts                community feed 全 post
 * @param communityIdsByPost   post.id → 所属する全 community id の配列
 * @returns community.id → count の Map (post が無い community は entry 無し)
 */
export function countPostsPerCommunity(
  posts: Post[],
  communityIdsByPost: Record<string, string[]>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const cid of communityIdsByPost[p.id] ?? EMPTY_IDS) {
      counts.set(cid, (counts.get(cid) ?? 0) + 1);
    }
  }
  return counts;
}
