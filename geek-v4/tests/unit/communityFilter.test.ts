// ============================================================
// lib/utils/communityFilter.ts のロジック検証
// ============================================================
// YouTube 登録チャンネル風 UX のための post filter helper。
//
// 検証観点:
//   1. selectedCommunityId === null → 全 post 返す (「すべて」)
//   2. 特定 id 指定 → そのコミュ post のみ
//   3. communityByPost に entry が無い post は selected 時に除外
//   4. 順序保持 (filter は元配列の順序を崩さない)
//   5. empty input
//   6. countPostsPerCommunity の数値正確性
// ============================================================

import {
  filterPostsByCommunity,
  countPostsPerCommunity,
} from '../../lib/utils/communityFilter';
import type { Post } from '../../types/models';
import type { CommunityMetaLite } from '../../lib/api/communities';

// ------------------------------------------------------------
// テスト fixture (最低限の Post / CommunityMetaLite)
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

function mkCommunity(id: string, name = `Community ${id}`): CommunityMetaLite {
  return {
    id,
    name,
    icon_emoji: '🌐',
    icon_color: '#7C6AF7',
    icon_url: null,
    is_official: false,
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
    const map: Record<string, CommunityMetaLite> = {
      p1: mkCommunity(COMMUNITY_A),
      p2: mkCommunity(COMMUNITY_B),
      p3: mkCommunity(COMMUNITY_A),
    };
    expect(filterPostsByCommunity(posts, map, null)).toEqual(posts);
  });

  it('特定 community 指定 → その community の post のみ返す', () => {
    const p1 = mkPost('p1');
    const p2 = mkPost('p2');
    const p3 = mkPost('p3');
    const p4 = mkPost('p4');
    const posts = [p1, p2, p3, p4];
    const map: Record<string, CommunityMetaLite> = {
      p1: mkCommunity(COMMUNITY_A),
      p2: mkCommunity(COMMUNITY_B),
      p3: mkCommunity(COMMUNITY_A),
      p4: mkCommunity(COMMUNITY_C),
    };
    const result = filterPostsByCommunity(posts, map, COMMUNITY_A);
    expect(result).toEqual([p1, p3]);
  });

  it('communityByPost に entry が無い post は selected 時に除外する', () => {
    const posts = [mkPost('p1'), mkPost('p2'), mkPost('p3')];
    const map: Record<string, CommunityMetaLite> = {
      // p2 の entry を意図的に欠落させる
      p1: mkCommunity(COMMUNITY_A),
      p3: mkCommunity(COMMUNITY_A),
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
    const map: Record<string, CommunityMetaLite> = {
      p1: mkCommunity(COMMUNITY_A),
      p2: mkCommunity(COMMUNITY_A),
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
    const map: Record<string, CommunityMetaLite> = {
      p1: mkCommunity(COMMUNITY_A),
      p2: mkCommunity(COMMUNITY_A),
      p3: mkCommunity(COMMUNITY_A),
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
    const map: Record<string, CommunityMetaLite> = {
      p1: mkCommunity(COMMUNITY_A),
      p2: mkCommunity(COMMUNITY_A),
      p3: mkCommunity(COMMUNITY_B),
      p4: mkCommunity(COMMUNITY_A),
      p5: mkCommunity(COMMUNITY_C),
    };
    const counts = countPostsPerCommunity(posts, map);
    expect(counts.get(COMMUNITY_A)).toBe(3);
    expect(counts.get(COMMUNITY_B)).toBe(1);
    expect(counts.get(COMMUNITY_C)).toBe(1);
  });

  it('post が空なら空 Map', () => {
    const counts = countPostsPerCommunity([], {});
    expect(counts.size).toBe(0);
  });

  it('communityByPost に entry が無い post はカウントしない', () => {
    const posts = [mkPost('p1'), mkPost('p2'), mkPost('p3')];
    const map: Record<string, CommunityMetaLite> = {
      p1: mkCommunity(COMMUNITY_A),
      // p2 / p3 は欠落
    };
    const counts = countPostsPerCommunity(posts, map);
    expect(counts.get(COMMUNITY_A)).toBe(1);
    expect(counts.size).toBe(1);
  });

  it('存在しない community を get → undefined', () => {
    const posts = [mkPost('p1')];
    const map: Record<string, CommunityMetaLite> = {
      p1: mkCommunity(COMMUNITY_A),
    };
    const counts = countPostsPerCommunity(posts, map);
    expect(counts.get(COMMUNITY_B)).toBeUndefined();
  });
});
