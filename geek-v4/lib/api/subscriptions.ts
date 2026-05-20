import { supabase } from '../supabase';

export async function isSubscribed(tagName: string): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return false;
  const { data } = await supabase
    .from('tag_subscriptions')
    .select('tag_name')
    .eq('user_id', userId)
    .eq('tag_name', tagName)
    .maybeSingle();
  return !!data;
}

export async function subscribeTag(tagName: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  await supabase
    .from('tag_subscriptions')
    .insert({ user_id: userId, tag_name: tagName })
    .select();
}

export async function unsubscribeTag(tagName: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  await supabase
    .from('tag_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('tag_name', tagName);
}

export type TagCommunity = {
  name: string;
  description: string | null;
  banner_color: string;
  member_count: number;
  post_count: number;
};

export async function getTagCommunity(tagName: string): Promise<TagCommunity | null> {
  const { data, error } = await supabase
    .from('tags')
    .select('name, description, banner_color, member_count, post_count')
    .eq('name', tagName)
    .maybeSingle();
  if (error || !data) return null;
  return data as TagCommunity;
}
