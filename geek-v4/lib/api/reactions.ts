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

  // 他ユーザーの user_id をクライアントへ出さない (名寄せ防止 #27)。集計は post_id + meme のみ。
  const { data, error } = await supabase
    .from('post_reactions')
    .select('post_id, meme')
    .in('post_id', postIds);
  // 取得失敗を空マップで握り潰すと「リアクション0」を誤って成功表示し retry も走らない。
  // throw して React Query の retry/isError 経路に乗せる (呼び出し側は data ?? [] でフォールバック)。
  if (error) throw error;

  // mine 判定は「自分の行」だけ別途取得 (自分の user_id は露出して問題ない)。
  let mineSet = new Set<string>();
  if (myId) {
    const { data: mineRows } = await supabase
      .from('post_reactions')
      .select('post_id, meme')
      .eq('user_id', myId)
      .in('post_id', postIds);
    mineSet = new Set(
      ((mineRows ?? []) as { post_id: string; meme: string }[]).map((r) => `${r.post_id}:${r.meme}`),
    );
  }

  const rows = (data ?? []) as { post_id: string; meme: string }[];
  // postId → meme → count
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const byMeme = map[r.post_id] ?? (map[r.post_id] = {});
    byMeme[r.meme] = (byMeme[r.meme] ?? 0) + 1;
  }

  const result: ReactionsByPost = {};
  for (const pid of postIds) {
    const memes = map[pid];
    if (!memes) { result[pid] = []; continue; }
    result[pid] = Object.entries(memes)
      .map(([meme, count]) => ({ meme, count, mine: mineSet.has(`${pid}:${meme}`) }))
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
