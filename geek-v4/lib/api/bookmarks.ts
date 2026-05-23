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
  const { error } = await supabase.from('bookmark_collections').delete().eq('id', id);
  if (error) throw error;
}

export async function saveToCollection(postId: string, collectionId: string | null): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  // upsert で 1 RTT 化 (旧 SELECT → UPDATE/INSERT の 2 RTT を半減)。
  // 大量ユーザーが同時に「コレクションに保存」を押しても server roundtrip が
  // 線形にしか増えない。
  const { error } = await supabase
    .from('saves')
    .upsert(
      { user_id: userId, post_id: postId, collection_id: collectionId },
      { onConflict: 'user_id,post_id' },
    );
  if (error) throw error;
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
