import { supabase } from '../supabase';
import type { ConcernReason } from '../../types/models';

export async function getMyConcerns(postIds: string[]): Promise<Record<string, boolean>> {
  if (postIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return {};
  const { data } = await supabase
    .from('concerns')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);
  const map: Record<string, boolean> = {};
  for (const row of (data ?? []) as Array<{ post_id: string }>) {
    map[row.post_id] = true;
  }
  return map;
}

export async function addConcern(
  postId: string,
  reason: ConcernReason = 'other',
  isPrivate = true,
): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  // 冪等化: cache cold で既マーク投稿に再度押しても unique(user_id, post_id) 違反で
  // 失敗トースト→誤ロールバックにならないよう upsert + ignoreDuplicates にする
  // (useLike / useSave と同じ前提に揃える)。
  const { error } = await supabase
    .from('concerns')
    .upsert(
      { user_id: userId, post_id: postId, reason, is_private: isPrivate },
      { onConflict: 'user_id,post_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function removeConcern(postId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { error } = await supabase.from('concerns').delete().eq('user_id', userId).eq('post_id', postId);
  if (error) throw error;
}
