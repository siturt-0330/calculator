// ============================================================
// feedPagePatcher — RPC cache 部分更新 helper の logic test
// ============================================================
// patchFeedPagePost が以下を満たすことを確認:
//   1. 全 feed-page cache (複数 user / 複数 sortedKey) を走査して該当 post を patch する
//   2. 該当 post が無い cache はそのまま (no-op)
//   3. patch 適用後、配列・post の reference が変わる (React.memo が反応するため)
//   4. function patch と object patch の両方をサポート
// ============================================================

import { QueryClient } from '@tanstack/react-query';
import {
  FEED_PAGE_KEY,
  patchFeedPagePost,
  snapshotFeedPage,
  revertFeedPageSnapshot,
} from '../../lib/cacheUpdates/feedPagePatcher';
import type { FeedPagePost } from '../../lib/api/feedPage';

function mkPost(id: string, overrides: Partial<FeedPagePost> = {}): FeedPagePost {
  return {
    id,
    user_id: null,
    content: '',
    tag_names: [],
    media_urls: [],
    media_blurhashes: [],
    video_urls: [],
    video_posters: [],
    source_url: null,
    created_at: new Date().toISOString(),
    likes_count: 0,
    concern_count: 0,
    comments_count: 0,
    trust_score_at_post: 50,
    kind: 'opinion',
    cw_category: null,
    content_warning: null,
    communities: [],
    official_author: null,
    my_like: false,
    my_concern: false,
    my_save: false,
    reactions: [],
    added_tags: [],
    poll: null,
    ...overrides,
  } as FeedPagePost;
}

describe('patchFeedPagePost', () => {
  it('object patch を該当 post に shallow-merge', () => {
    const qc = new QueryClient();
    const initial = [mkPost('p1'), mkPost('p2'), mkPost('p3')];
    qc.setQueryData([FEED_PAGE_KEY, 'user-1', 'p1,p2,p3'], initial);

    patchFeedPagePost(qc, 'p2', { my_like: true, likes_count: 5 });

    const updated = qc.getQueryData<FeedPagePost[]>([
      FEED_PAGE_KEY,
      'user-1',
      'p1,p2,p3',
    ])!;
    expect(updated[1]!.my_like).toBe(true);
    expect(updated[1]!.likes_count).toBe(5);
    // 他の post は変わらない
    expect(updated[0]!.my_like).toBe(false);
    expect(updated[2]!.my_like).toBe(false);
  });

  it('function patch を該当 post に適用', () => {
    const qc = new QueryClient();
    const initial = [
      mkPost('p1', { likes_count: 10 }),
      mkPost('p2', { likes_count: 20 }),
    ];
    qc.setQueryData([FEED_PAGE_KEY, 'user-1', 'p1,p2'], initial);

    patchFeedPagePost(qc, 'p1', (p) => ({ ...p, likes_count: p.likes_count + 1 }));

    const updated = qc.getQueryData<FeedPagePost[]>([
      FEED_PAGE_KEY,
      'user-1',
      'p1,p2',
    ])!;
    expect(updated[0]!.likes_count).toBe(11);
    expect(updated[1]!.likes_count).toBe(20);
  });

  it('該当 post が無い cache はそのまま (no-op, reference 不変)', () => {
    const qc = new QueryClient();
    const initial = [mkPost('p1'), mkPost('p2')];
    qc.setQueryData([FEED_PAGE_KEY, 'user-1', 'p1,p2'], initial);

    patchFeedPagePost(qc, 'p99', { my_like: true });

    const after = qc.getQueryData<FeedPagePost[]>([
      FEED_PAGE_KEY,
      'user-1',
      'p1,p2',
    ]);
    // reference 同一 (set されていない)
    expect(after).toBe(initial);
  });

  it('複数 cache (異なる sortedKey) を全部走査', () => {
    const qc = new QueryClient();
    const cacheA = [mkPost('p1'), mkPost('p2')];
    const cacheB = [mkPost('p2'), mkPost('p3')];
    qc.setQueryData([FEED_PAGE_KEY, 'user-1', 'p1,p2'], cacheA);
    qc.setQueryData([FEED_PAGE_KEY, 'user-1', 'p2,p3'], cacheB);

    patchFeedPagePost(qc, 'p2', { my_save: true });

    const updatedA = qc.getQueryData<FeedPagePost[]>([
      FEED_PAGE_KEY,
      'user-1',
      'p1,p2',
    ])!;
    const updatedB = qc.getQueryData<FeedPagePost[]>([
      FEED_PAGE_KEY,
      'user-1',
      'p2,p3',
    ])!;
    expect(updatedA[1]!.my_save).toBe(true);
    expect(updatedB[0]!.my_save).toBe(true);
  });

  it('patch 適用後は配列 reference が変わる (React.memo が re-render するため)', () => {
    const qc = new QueryClient();
    const initial = [mkPost('p1')];
    qc.setQueryData([FEED_PAGE_KEY, 'user-1', 'p1'], initial);

    patchFeedPagePost(qc, 'p1', { my_like: true });

    const after = qc.getQueryData<FeedPagePost[]>([
      FEED_PAGE_KEY,
      'user-1',
      'p1',
    ])!;
    // 配列 reference が違う
    expect(after).not.toBe(initial);
    // post object reference も違う (shallow merge で新 object 生成)
    expect(after[0]).not.toBe(initial[0]);
  });

  it('配列でない cache は skip', () => {
    const qc = new QueryClient();
    // 想定外の shape (string) — Array.isArray チェックで skip される
    qc.setQueryData([FEED_PAGE_KEY, 'user-1', 'p1'], 'not-an-array' as never);
    // throw しないことを確認
    expect(() => patchFeedPagePost(qc, 'p1', { my_like: true })).not.toThrow();
  });
});

describe('snapshotFeedPage + revertFeedPageSnapshot', () => {
  it('patch 後 revert で元に戻る', () => {
    const qc = new QueryClient();
    const initial = [mkPost('p1', { likes_count: 5 })];
    qc.setQueryData([FEED_PAGE_KEY, 'user-1', 'p1'], initial);

    const snap = snapshotFeedPage(qc);
    patchFeedPagePost(qc, 'p1', { likes_count: 99 });

    const afterPatch = qc.getQueryData<FeedPagePost[]>([
      FEED_PAGE_KEY,
      'user-1',
      'p1',
    ])!;
    expect(afterPatch[0]!.likes_count).toBe(99);

    revertFeedPageSnapshot(qc, snap);
    const afterRevert = qc.getQueryData<FeedPagePost[]>([
      FEED_PAGE_KEY,
      'user-1',
      'p1',
    ])!;
    expect(afterRevert[0]!.likes_count).toBe(5);
    // 値が確実に元に戻る (reference は react-query v5 の structural sharing で
    // strict identity ではないが deep-equal で十分)
    expect(afterRevert).toStrictEqual(initial);
  });
});
