// ============================================================
// lib/api/commentConcerns.ts — comment_concerns (migration 0063) の query 層
// ------------------------------------------------------------
// 仕様:
//   - toggleCommentConcern(id)   : 自分が既に concern してるなら DELETE、
//                                   無いなら INSERT (toggle pattern)
//   - fetchMyCommentConcerns(ids): 自分が concern 済の comment_id の Set を返す
//
// 設計判断:
//   - lib/api/concerns.ts (post 用) と同じ toggle pattern を採用 — 呼出側は
//     現在状態を考えずに「タップ = toggle」だけで済む。
//   - withApiTimeout で 8 秒で abort (CLAUDE.md § 5.1)。リトライは
//     mutation 系なのでしない (副作用あり処理にリトライは不可)。
//   - 認証されていなければ早期 throw (RLS で deny されるより前に明確な error)。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

/**
 * 自分が指定 comment に既に concern を付けているかを toggle する。
 * 付けていなければ INSERT、付けていれば DELETE。
 */
export async function toggleCommentConcern(commentId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  // まず現在の状態を確認 (1 row だけ select → exists check)。
  // race 上は SELECT → INSERT の間に他端末が INSERT する可能性があるが、
  // 失敗時 (unique violation) は再度 toggle すれば整合するので致命ではない。
  const { data: existing, error: selectErr } = await withApiTimeout(
    supabase
      .from('comment_concerns')
      .select('comment_id')
      .eq('comment_id', commentId)
      .eq('user_id', userId)
      .maybeSingle(),
    'commentConcerns.toggle.select',
    8000,
  );
  if (selectErr) throw selectErr;

  if (existing) {
    const { error } = await withApiTimeout(
      supabase
        .from('comment_concerns')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_id', userId),
      'commentConcerns.toggle.delete',
      8000,
    );
    if (error) throw error;
  } else {
    const { error } = await withApiTimeout(
      supabase.from('comment_concerns').insert({ comment_id: commentId, user_id: userId }),
      'commentConcerns.toggle.insert',
      8000,
    );
    if (error) throw error;
  }
}

/**
 * 渡した comment_id の集合のうち、自分が既に concern 済のものを Set で返す。
 *
 * - 認証されていなければ空 Set を返す (= UI 側は「未押下」として描画)
 * - commentIds が 0 件なら DB アクセスせず空 Set
 */
export async function fetchMyCommentConcerns(commentIds: readonly string[]): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return new Set();

  const { data, error } = await withApiTimeout(
    supabase
      .from('comment_concerns')
      .select('comment_id')
      .eq('user_id', userId)
      .in('comment_id', commentIds as string[]),
    'commentConcerns.fetchMine',
    8000,
  );
  if (error) throw error;

  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ comment_id: string }>) {
    out.add(row.comment_id);
  }
  return out;
}
