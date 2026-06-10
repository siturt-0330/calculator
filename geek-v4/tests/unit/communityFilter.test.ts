// ============================================================
// lib/utils/communityFilter.ts のロジック検証
// ============================================================
// YouTube 登録チャンネル風 UX のための post filter helper。
//
// 判定モデル: post → 所属する全 community id の配列 (communityIdsByPost)。
//   1 投稿が複数コミュに cross-post される (post_communities 複数行) ため、
//   「代表 1 community」ではなく「所属全コミュ集合」で一致を見る。
//
// 検証観点:
//   1. selectedCommunityId === null → 全 post 返す (「すべて」)
//   2. 特定 id 指定 → その community に所属する post のみ
//   3. ★ cross-post: 複数 community 所属 post は、所属するどの community を選んでも残る (回帰防止)
//   4. communityIdsByPost に entry が無い post は selected 時に除外
//   5. 順序保持 (filter は元配列の順序を崩さない)
//   6. empty input
//   7. countPostsPerCommunity の数値正確性 (cross-post は各コミュで +1)
// ============================================================

import {
  filterPostsByCommunity,
  countPostsPerCommunity,
} from '../../lib/utils/communityFilter';
import type { Post } from '../../types/models';

// ------------------------------------------------------------
// テスト fixture (最低限の Post)
// ------------------------------------------------------------
function mkPost(id: string): Post {
  return {
    id,
    content: `content of ${id}`,
    media_urls: [],
    media_blurhashes: [],
    tag_names: [],
    likes_count: 0,
    comments_count: 0,
    score: 0,
    hot_score: 0,
    concern_count: 0,
    kind: 'fact',
    source_url: null,
    is_public: true,
    trust_score_at_post: 50,
    is_anonymous: true,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const COMMUNITY_A = 'community-aaaa';
const COMMUNITY_B = 'community-bbbb';
const COMMUNITY_C = 'community-cccc';

// ============================================================
// filterPostsByCommunity
// ============================================================
describe('filterPostsByCommunity', () => {
  it('selectedCommunityId が null → 全 post を返す (「すべて」)', () => {
    const posts = [mkPost('p1'), mkPost('p2'), mkPost('p3')];
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_A],
      p2: [COMMUNITY_B],
      p3: [COMMUNITY_A],
    };
    expect(filterPostsByCommunity(posts, map, null)).toEqual(posts);
  });

  it('特定 community 指定 → その community に所属する post のみ返す', () => {
    const p1 = mkPost('p1');
    const p2 = mkPost('p2');
    const p3 = mkPost('p3');
    const p4 = mkPost('p4');
    const posts = [p1, p2, p3, p4];
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_A],
      p2: [COMMUNITY_B],
      p3: [COMMUNITY_A],
      p4: [COMMUNITY_C],
    };
    const result = filterPostsByCommunity(posts, map, COMMUNITY_A);
    expect(result).toEqual([p1, p3]);
  });

  // ★ 回帰防止: cross-post された投稿が「最新 attach 先 ≠ 選択コミュ」でも消えないこと。
  //   これが旧「代表 1 community」判定で消えていたバグ (タブには出ないが詳細には出る) の核心。
  it('複数 community 所属 post は、所属するどの community を選んでも残る (cross-post)', () => {
    const p1 = mkPost('p1'); // A と B に cross-post
    const p2 = mkPost('p2'); // B のみ
    const posts = [p1, p2];
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_B, COMMUNITY_A], // 配列順 (= attach 順) に依存せず両方で出る
      p2: [COMMUNITY_B],
    };
    expect(filterPostsByCommunity(posts, map, COMMUNITY_A).map((p) => p.id)).toEqual(['p1']);
    expect(filterPostsByCommunity(posts, map, COMMUNITY_B).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(filterPostsByCommunity(posts, map, COMMUNITY_C)).toEqual([]);
  });

  it('communityIdsByPost に entry が無い post は selected 時に除外する', () => {
    const posts = [mkPost('p1'), mkPost('p2'), mkPost('p3')];
    const map: Record<string, string[]> = {
      // p2 の entry を意図的に欠落させる
      p1: [COMMUNITY_A],
      p3: [COMMUNITY_A],
    };
    const result = filterPostsByCommunity(posts, map, COMMUNITY_A);
    expect(result.map((p) => p.id)).toEqual(['p1', 'p3']);
  });

  it('selectedCommunityId が null かつ map が空でも全件返る', () => {
    const posts = [mkPost('p1'), mkPost('p2')];
    expect(filterPostsByCommunity(posts, {}, null)).toEqual(posts);
  });

  it('該当する post が 0 件なら empty 配列', () => {
    const posts = [mkPost('p1'), mkPost('p2')];
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_A],
      p2: [COMMUNITY_A],
    };
    expect(filterPostsByCommunity(posts, map, COMMUNITY_B)).toEqual([]);
  });

  it('posts が空配列ならいかなる id でも empty', () => {
    expect(filterPostsByCommunity([], {}, null)).toEqual([]);
    expect(filterPostsByCommunity([], {}, COMMUNITY_A)).toEqual([]);
  });

  it('元配列の順序を保持する (filter は順序を崩さない)', () => {
    const p1 = mkPost('p1');
    const p2 = mkPost('p2');
    const p3 = mkPost('p3');
    const posts = [p3, p1, p2]; // 意図的に並べ替えた順
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_A],
      p2: [COMMUNITY_A],
      p3: [COMMUNITY_A],
    };
    const result = filterPostsByCommunity(posts, map, COMMUNITY_A);
    expect(result.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
  });
});

// ============================================================
// countPostsPerCommunity
// ============================================================
describe('countPostsPerCommunity', () => {
  it('各 community の post 数を正確にカウント', () => {
    const posts = [
      mkPost('p1'),
      mkPost('p2'),
      mkPost('p3'),
      mkPost('p4'),
      mkPost('p5'),
    ];
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_A],
      p2: [COMMUNITY_A],
      p3: [COMMUNITY_B],
      p4: [COMMUNITY_A],
      p5: [COMMUNITY_C],
    };
    const counts = countPostsPerCommunity(posts, map);
    expect(counts.get(COMMUNITY_A)).toBe(3);
    expect(counts.get(COMMUNITY_B)).toBe(1);
    expect(counts.get(COMMUNITY_C)).toBe(1);
  });

  it('cross-post された post は所属する各 community で +1 される', () => {
    const posts = [mkPost('p1'), mkPost('p2')];
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_A, COMMUNITY_B], // 両方で +1
      p2: [COMMUNITY_A],
    };
    const counts = countPostsPerCommunity(posts, map);
    expect(counts.get(COMMUNITY_A)).toBe(2);
    expect(counts.get(COMMUNITY_B)).toBe(1);
  });

  it('post が空なら空 Map', () => {
    const counts = countPostsPerCommunity([], {});
    expect(counts.size).toBe(0);
  });

  it('communityIdsByPost に entry が無い post はカウントしない', () => {
    const posts = [mkPost('p1'), mkPost('p2'), mkPost('p3')];
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_A],
      // p2 / p3 は欠落
    };
    const counts = countPostsPerCommunity(posts, map);
    expect(counts.get(COMMUNITY_A)).toBe(1);
    expect(counts.size).toBe(1);
  });

  it('存在しない community を get → undefined', () => {
    const posts = [mkPost('p1')];
    const map: Record<string, string[]> = {
      p1: [COMMUNITY_A],
    };
    const counts = countPostsPerCommunity(posts, map);
    expect(counts.get(COMMUNITY_B)).toBeUndefined();
  });
});
