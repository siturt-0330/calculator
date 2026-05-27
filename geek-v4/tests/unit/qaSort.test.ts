// ============================================================
// qaSort.test.ts — Q&A モード comment sorter の unit test
// ------------------------------------------------------------
// lib/utils/qaSort.ts (副作用ゼロ) の純関数テスト。
// supabase / RN は一切 mock しない (commentTree.test.ts と同じ流儀)。
//
// Comment 型に author_id は無いが、Q&A モードでは buildCommentTree 上流の
// fetch が author_id を attach している前提なので、テストでは Comment に
// `author_id` を後付けする型拡張を使う。
// ============================================================

import {
  sortCommentsForQAMode,
  hasReplyFrom,
} from '../../lib/utils/qaSort';
import type { Comment } from '../../types/models';

type CommentWithAuthor = Comment & { author_id?: string | null };

let counter = 0;
function mk(
  id: string,
  opts: {
    authorId?: string | null;
    createdAt?: string;
    children?: CommentWithAuthor[];
  } = {},
): CommentWithAuthor {
  counter += 1;
  return {
    id,
    post_id: 'post-1',
    content: `content-${id}`,
    avatar_color: '#000',
    created_at: opts.createdAt ?? `2026-05-27T12:00:${String(counter).padStart(2, '0')}Z`,
    parent_comment_id: null,
    reply_to_comment_id: null,
    children: opts.children ?? [],
    author_id: opts.authorId ?? null,
  };
}

const AUTHOR = 'author-uuid-1';
const USER_A = 'user-A';
const USER_B = 'user-B';

describe('hasReplyFrom', () => {
  beforeEach(() => { counter = 0; });

  it('returns false when no children', () => {
    const root = mk('root');
    expect(hasReplyFrom(root, AUTHOR)).toBe(false);
  });

  it('detects direct child reply by author', () => {
    const root = mk('root', {
      authorId: USER_A,
      children: [mk('c1', { authorId: AUTHOR })],
    });
    expect(hasReplyFrom(root, AUTHOR)).toBe(true);
  });

  it('detects nested grandchild reply by author', () => {
    const grandchild = mk('gc', { authorId: AUTHOR });
    const child = mk('c1', { authorId: USER_B, children: [grandchild] });
    const root = mk('root', { authorId: USER_A, children: [child] });
    expect(hasReplyFrom(root, AUTHOR)).toBe(true);
  });

  it('returns false if neither root nor children include author', () => {
    const child = mk('c1', { authorId: USER_B });
    const root = mk('root', { authorId: USER_A, children: [child] });
    expect(hasReplyFrom(root, AUTHOR)).toBe(false);
  });

  it('returns false when authorId is empty', () => {
    const root = mk('root', { children: [mk('c1', { authorId: AUTHOR })] });
    expect(hasReplyFrom(root, '')).toBe(false);
  });
});

describe('sortCommentsForQAMode', () => {
  beforeEach(() => { counter = 0; });

  it('returns empty array for empty input', () => {
    expect(sortCommentsForQAMode([], AUTHOR)).toEqual([]);
  });

  it('returns input as-is (copy) when postAuthorId is empty', () => {
    const list: CommentWithAuthor[] = [
      mk('a', { authorId: USER_A }),
      mk('b', { authorId: AUTHOR }),
    ];
    const out = sortCommentsForQAMode(list, '');
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
    // 入力配列を mutate しない
    expect(out).not.toBe(list);
  });

  it('promotes a thread where author has replied to the top', () => {
    // a: 通常 / b: author 返信あり / c: 通常 — order should be [b, a, c]
    // (a と c は同 tier 2 → 新しい順)
    const a = mk('a', { authorId: USER_A, createdAt: '2026-05-27T12:00:00Z' });
    const b = mk('b', {
      authorId: USER_B,
      createdAt: '2026-05-27T12:01:00Z',
      children: [mk('reply', { authorId: AUTHOR, createdAt: '2026-05-27T13:00:00Z' })],
    });
    const c = mk('c', { authorId: USER_A, createdAt: '2026-05-27T12:02:00Z' });
    const out = sortCommentsForQAMode([a, b, c], AUTHOR);
    expect(out[0]!.id).toBe('b');
    // 残り 2 件は新しい順 (c → a)
    expect(out.slice(1).map((x) => x.id)).toEqual(['c', 'a']);
  });

  it('places author own root comment in tier 1 (above non-author roots)', () => {
    const a = mk('a', { authorId: USER_A, createdAt: '2026-05-27T12:00:00Z' });
    const ownRoot = mk('own', { authorId: AUTHOR, createdAt: '2026-05-27T12:01:00Z' });
    const c = mk('c', { authorId: USER_B, createdAt: '2026-05-27T12:02:00Z' });
    const out = sortCommentsForQAMode([a, ownRoot, c], AUTHOR);
    // own は tier 1, a と c は tier 2 (新しい順 → c, a)
    expect(out.map((x) => x.id)).toEqual(['own', 'c', 'a']);
  });

  it('prioritises "author replied" over "author own root"', () => {
    const ownRoot = mk('own', { authorId: AUTHOR, createdAt: '2026-05-27T12:00:00Z' });
    const replied = mk('replied', {
      authorId: USER_A,
      createdAt: '2026-05-27T12:01:00Z',
      children: [mk('r', { authorId: AUTHOR })],
    });
    const out = sortCommentsForQAMode([ownRoot, replied], AUTHOR);
    expect(out.map((x) => x.id)).toEqual(['replied', 'own']);
  });

  it('walks nested children to detect author reply', () => {
    const a = mk('a', { authorId: USER_A, createdAt: '2026-05-27T12:00:00Z' });
    const deep = mk('deep', {
      authorId: USER_A,
      createdAt: '2026-05-27T12:01:00Z',
      children: [
        mk('c1', {
          authorId: USER_B,
          children: [mk('gc', { authorId: AUTHOR })],
        }),
      ],
    });
    const out = sortCommentsForQAMode([a, deep], AUTHOR);
    expect(out[0]!.id).toBe('deep');
  });

  it('falls back to time-desc for same tier (tie-break)', () => {
    // 全部 tier 2 → created_at 降順
    const a = mk('a', { authorId: USER_A, createdAt: '2026-05-27T12:00:00Z' });
    const b = mk('b', { authorId: USER_B, createdAt: '2026-05-27T13:00:00Z' });
    const c = mk('c', { authorId: USER_A, createdAt: '2026-05-27T11:00:00Z' });
    const out = sortCommentsForQAMode([a, b, c], AUTHOR);
    expect(out.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not mutate input array', () => {
    const input: CommentWithAuthor[] = [
      mk('a', { authorId: USER_A, createdAt: '2026-05-27T12:00:00Z' }),
      mk('b', {
        authorId: USER_B,
        createdAt: '2026-05-27T12:01:00Z',
        children: [mk('reply', { authorId: AUTHOR })],
      }),
    ];
    const snapshotIds = input.map((c) => c.id);
    sortCommentsForQAMode(input, AUTHOR);
    expect(input.map((c) => c.id)).toEqual(snapshotIds);
  });

  it('treats comments without author_id as tier 2', () => {
    // legacy comments (fetchComments が author_id を attach する前の data)
    const a: CommentWithAuthor = {
      id: 'a',
      post_id: 'post-1',
      content: 'legacy',
      avatar_color: '#000',
      created_at: '2026-05-27T12:00:00Z',
      parent_comment_id: null,
      reply_to_comment_id: null,
      children: [],
    };
    const own = mk('own', { authorId: AUTHOR, createdAt: '2026-05-27T11:00:00Z' });
    const out = sortCommentsForQAMode([a, own], AUTHOR);
    // own (tier 1) → a (tier 2)
    expect(out.map((x) => x.id)).toEqual(['own', 'a']);
  });

  it('handles invalid created_at gracefully (no NaN sort drift)', () => {
    const a = mk('a', { authorId: USER_A, createdAt: 'not-a-date' });
    const b = mk('b', { authorId: USER_B, createdAt: '2026-05-27T12:00:00Z' });
    const out = sortCommentsForQAMode([a, b], AUTHOR);
    // どちらも tier 2 → b の方が新しい
    expect(out[0]!.id).toBe('b');
  });

  it('keeps children order untouched (only roots are reordered)', () => {
    const child1 = mk('c1', { authorId: USER_B, createdAt: '2026-05-27T12:01:00Z' });
    const child2 = mk('c2', { authorId: AUTHOR, createdAt: '2026-05-27T12:02:00Z' });
    const root = mk('root', {
      authorId: USER_A,
      createdAt: '2026-05-27T12:00:00Z',
      children: [child1, child2],
    });
    const out = sortCommentsForQAMode([root], AUTHOR);
    expect(out[0]!.children!.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
