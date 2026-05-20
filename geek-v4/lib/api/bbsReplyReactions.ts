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

  const { data, error } = await supabase
    .from('bbs_reply_reactions')
    .select('reply_id, user_id, meme')
    .in('reply_id', replyIds);
  if (error) return {};

  const rows = (data ?? []) as ReactionRow[];
  const map: Record<string, Record<string, { count: number; mine: boolean }>> = {};
  for (const r of rows) {
    const byMeme = map[r.reply_id] ?? (map[r.reply_id] = {});
    const m = byMeme[r.meme] ?? { count: 0, mine: false };
    m.count += 1;
    if (myId && r.user_id === myId) m.mine = true;
    byMeme[r.meme] = m;
  }

  const result: ReactionsByReply = {};
  for (const rid of replyIds) {
    const memes = map[rid];
    if (!memes) { result[rid] = []; continue; }
    result[rid] = Object.entries(memes)
      .map(([meme, v]) => ({ meme, count: v.count, mine: v.mine }))
      .sort((a, b) => b.count - a.count);
  }
  return result;
}

export async function toggleBBSReplyReaction(replyId: string, meme: string): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  const { data: existing } = await supabase
    .from('bbs_reply_reactions')
    .select('reply_id')
    .eq('reply_id', replyId)
    .eq('user_id', userId)
    .eq('meme', meme)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('bbs_reply_reactions')
      .delete()
      .eq('reply_id', replyId)
      .eq('user_id', userId)
      .eq('meme', meme);
    return false;
  } else {
    await supabase
      .from('bbs_reply_reactions')
      .insert({ reply_id: replyId, user_id: userId, meme });
    return true;
  }
}
