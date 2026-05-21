import { supabase } from '../supabase';
import { checkRate, rateLimitMessage } from '../rateLimit';

export type ReactionRow = { post_id: string; user_id: string; meme: string };

export type ReactionAgg = {
  meme: string;
  count: number;
  mine: boolean;
};

export type ReactionsByPost = Record<string, ReactionAgg[]>;

// 投稿IDの配列に対して、各投稿のリアクション集計を返す
export async function fetchReactionsForPosts(postIds: string[]): Promise<ReactionsByPost> {
  if (postIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const myId = session.session?.user.id;

  const { data, error } = await supabase
    .from('post_reactions')
    .select('post_id, user_id, meme')
    .in('post_id', postIds);
  if (error) return {};

  const rows = (data ?? []) as ReactionRow[];
  // postId → meme → { count, mine }
  const map: Record<string, Record<string, { count: number; mine: boolean }>> = {};
  for (const r of rows) {
    const byMeme = map[r.post_id] ?? (map[r.post_id] = {});
    const m = byMeme[r.meme] ?? { count: 0, mine: false };
    m.count += 1;
    if (myId && r.user_id === myId) m.mine = true;
    byMeme[r.meme] = m;
  }

  const result: ReactionsByPost = {};
  for (const pid of postIds) {
    const memes = map[pid];
    if (!memes) { result[pid] = []; continue; }
    result[pid] = Object.entries(memes)
      .map(([meme, v]) => ({ meme, count: v.count, mine: v.mine }))
      .sort((a, b) => b.count - a.count);
  }
  return result;
}

export async function fetchReactionsForPost(postId: string): Promise<ReactionAgg[]> {
  const map = await fetchReactionsForPosts([postId]);
  return map[postId] ?? [];
}

// トグル: 1 RTT で完了 — DELETE が 0 行に効いたら INSERT する。
// returning でヒット行数を確認することで「現在の状態」を server roundtrip 1 回で判定。
// 旧コード (SELECT → DELETE/INSERT) は 2 RTT 必要だったが、これで halved。
// 1k concurrent reaction toggle の場合: 2k RTT → 1k RTT。
export async function toggleReaction(postId: string, meme: string): Promise<boolean> {
  const rl = checkRate('reaction');
  if (!rl.ok) throw new Error(rateLimitMessage('reaction', rl.retryAfterMs));
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  // 最初に DELETE — マッチした行が返れば「もう存在した」 = トグル off 完了
  const { data: deleted } = await supabase
    .from('post_reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId)
    .eq('meme', meme)
    .select('post_id');

  if (deleted && deleted.length > 0) return false;

  // 何も消えなければ INSERT (upsert で race condition 連打を吸収)
  const { error } = await supabase
    .from('post_reactions')
    .upsert(
      { post_id: postId, user_id: userId, meme },
      { onConflict: 'post_id,user_id,meme', ignoreDuplicates: true },
    );
  if (error) throw error;
  return true;
}
