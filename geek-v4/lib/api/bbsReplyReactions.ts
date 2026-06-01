import { supabase } from '../supabase';

export type ReactionRow = { reply_id: string; user_id: string; meme: string };

export type ReactionAgg = {
  meme: string;
  count: number;
  mine: boolean;
};

export type ReactionsByReply = Record<string, ReactionAgg[]>;

// 複数 reply ID のリアクションを一括取得
export async function fetchReactionsForReplies(replyIds: string[]): Promise<ReactionsByReply> {
  if (replyIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const myId = session.session?.user.id;

  // 他ユーザーの user_id をクライアントへ出さない (名寄せ防止 #38)。集計は reply_id + meme のみ。
  const { data, error } = await supabase
    .from('bbs_reply_reactions')
    .select('reply_id, meme')
    .in('reply_id', replyIds);
  if (error) return {};

  // mine 判定は「自分の行」だけ別途取得 (自分の user_id は露出して問題ない)。
  let mineSet = new Set<string>();
  if (myId) {
    const { data: mineRows } = await supabase
      .from('bbs_reply_reactions')
      .select('reply_id, meme')
      .eq('user_id', myId)
      .in('reply_id', replyIds);
    mineSet = new Set(
      ((mineRows ?? []) as { reply_id: string; meme: string }[]).map((r) => `${r.reply_id}:${r.meme}`),
    );
  }

  const rows = (data ?? []) as { reply_id: string; meme: string }[];
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const byMeme = map[r.reply_id] ?? (map[r.reply_id] = {});
    byMeme[r.meme] = (byMeme[r.meme] ?? 0) + 1;
  }

  const result: ReactionsByReply = {};
  for (const rid of replyIds) {
    const memes = map[rid];
    if (!memes) { result[rid] = []; continue; }
    result[rid] = Object.entries(memes)
      .map(([meme, count]) => ({ meme, count, mine: mineSet.has(`${rid}:${meme}`) }))
      .sort((a, b) => b.count - a.count);
  }
  return result;
}

// post_reactions と同じ 1-RTT toggle パターン (旧 SELECT → DELETE/INSERT の半分)
export async function toggleBBSReplyReaction(replyId: string, meme: string): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  const { data: deleted } = await supabase
    .from('bbs_reply_reactions')
    .delete()
    .eq('reply_id', replyId)
    .eq('user_id', userId)
    .eq('meme', meme)
    .select('reply_id');

  if (deleted && deleted.length > 0) return false;

  const { error } = await supabase
    .from('bbs_reply_reactions')
    .upsert(
      { reply_id: replyId, user_id: userId, meme },
      { onConflict: 'reply_id,user_id,meme', ignoreDuplicates: true },
    );
  if (error) throw error;
  return true;
}
