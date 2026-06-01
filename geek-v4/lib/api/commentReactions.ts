// ============================================================
// lib/api/commentReactions.ts
// ------------------------------------------------------------
// comment_reactions table への CRUD ラッパ。
// shape は post_reactions と完全一致 (post_id → comment_id rename のみ)。
// 0075_unify_bbs_posts.sql で table 追加 + supabase_realtime publication 登録済。
// ============================================================

import { supabase } from '../supabase';
import { checkRate, rateLimitMessage } from '../rateLimit';
import { withApiTimeout } from '../withApiTimeout';

export type CommentReactionRow = { comment_id: string; user_id: string; meme: string };

export type ReactionAgg = {
  meme: string;
  count: number;
  mine: boolean;
};

export type ReactionsByComment = Record<string, ReactionAgg[]>;

// comment ID の配列に対して、各コメントのリアクション集計を返す
export async function fetchCommentReactionsForComments(
  commentIds: string[],
): Promise<ReactionsByComment> {
  if (commentIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const myId = session.session?.user.id;

  // 他ユーザーの user_id をクライアントへ出さない (名寄せ防止 #38)。
  // 集計は comment_id + meme のみ取得し、件数だけ数える。
  const { data, error } = await withApiTimeout(
    supabase
      .from('comment_reactions')
      .select('comment_id, meme')
      .in('comment_id', commentIds),
    'commentReactions.fetchForComments',
    8000,
  );
  if (error) return {};

  // mine 判定は「自分の行」だけを別途取得する (自分の user_id は露出して問題ない)。
  let mineSet = new Set<string>();
  if (myId) {
    const { data: mineRows } = await withApiTimeout(
      supabase
        .from('comment_reactions')
        .select('comment_id, meme')
        .eq('user_id', myId)
        .in('comment_id', commentIds),
      'commentReactions.fetchMine',
      8000,
    );
    mineSet = new Set(
      ((mineRows ?? []) as { comment_id: string; meme: string }[]).map(
        (r) => `${r.comment_id}:${r.meme}`,
      ),
    );
  }

  const rows = (data ?? []) as { comment_id: string; meme: string }[];
  // commentId → meme → count
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const byMeme = map[r.comment_id] ?? (map[r.comment_id] = {});
    byMeme[r.meme] = (byMeme[r.meme] ?? 0) + 1;
  }

  const result: ReactionsByComment = {};
  for (const cid of commentIds) {
    const memes = map[cid];
    if (!memes) { result[cid] = []; continue; }
    result[cid] = Object.entries(memes)
      .map(([meme, count]) => ({ meme, count, mine: mineSet.has(`${cid}:${meme}`) }))
      .sort((a, b) => b.count - a.count);
  }
  return result;
}

export async function fetchCommentReactionsForComment(
  commentId: string,
): Promise<ReactionAgg[]> {
  const map = await fetchCommentReactionsForComments([commentId]);
  return map[commentId] ?? [];
}

// トグル: 1 RTT で完了 — DELETE が 0 行に効いたら INSERT する。
// returning でヒット行数を確認することで「現在の状態」を server roundtrip 1 回で判定。
// post_reactions と同じ 1-RTT パターン。
export async function toggleCommentReaction(
  { commentId, meme }: { commentId: string; meme: string },
): Promise<boolean> {
  const rl = checkRate('reaction');
  if (!rl.ok) throw new Error(rateLimitMessage('reaction', rl.retryAfterMs));
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  // 最初に DELETE — マッチした行が返れば「もう存在した」 = トグル off 完了
  const { data: deleted } = await withApiTimeout(
    supabase
      .from('comment_reactions')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', userId)
      .eq('meme', meme)
      .select('comment_id'),
    'commentReactions.toggle.delete',
    8000,
  );

  if (deleted && deleted.length > 0) return false;

  // 何も消えなければ INSERT (upsert で race condition 連打を吸収)
  const { error } = await withApiTimeout(
    supabase
      .from('comment_reactions')
      .upsert(
        { comment_id: commentId, user_id: userId, meme },
        { onConflict: 'comment_id,user_id,meme', ignoreDuplicates: true },
      ),
    'commentReactions.toggle.upsert',
    8000,
  );
  if (error) throw error;
  return true;
}
