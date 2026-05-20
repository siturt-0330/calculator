import { supabase } from '../supabase';

export type BookmarkCollection = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  is_public: boolean;
  bookmark_count: number;
  created_at: string;
};

export async function fetchMyCollections(): Promise<BookmarkCollection[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from('bookmark_collections')
    .select('id, user_id, name, emoji, is_public, bookmark_count, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as BookmarkCollection[];
}

export async function createCollection(name: string, emoji = '📂', isPublic = false): Promise<BookmarkCollection | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('bookmark_collections')
    .insert({ user_id: userId, name: name.trim(), emoji, is_public: isPublic })
    .select('id, user_id, name, emoji, is_public, bookmark_count, created_at')
    .single();
  if (error) throw error;
  return data as BookmarkCollection;
}

export async function deleteCollection(id: string): Promise<void> {
  await supabase.from('bookmark_collections').delete().eq('id', id);
}

export async function saveToCollection(postId: string, collectionId: string | null): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  // upsert: 既存の save があれば collection_id 更新
  const { data: existing } = await supabase
    .from('saves')
    .select('post_id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();
  if (existing) {
    await supabase.from('saves').update({ collection_id: collectionId })
      .eq('user_id', userId).eq('post_id', postId);
  } else {
    await supabase.from('saves').insert({ user_id: userId, post_id: postId, collection_id: collectionId });
  }
}

export async function fetchPostsInCollection(collectionId: string | 'uncategorized'): Promise<string[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  let q = supabase
    .from('saves')
    .select('post_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (collectionId === 'uncategorized') {
    q = q.is('collection_id', null);
  } else {
    q = q.eq('collection_id', collectionId);
  }
  const { data } = await q;
  return ((data ?? []) as Array<{ post_id: string }>).map((r) => r.post_id);
}
