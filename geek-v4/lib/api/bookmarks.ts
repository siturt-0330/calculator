import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

export type BookmarkCollection = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  is_public: boolean;
  bookmark_count: number;
  created_at: string;
};

// DoS 防止: 1 ユーザーが作れるコレクション数の現実上限は 100 程度なので、
// それを超えた場合は古いものを切り捨てる。仮にそれ以上必要になったら
// cursor pagination に切り替えるか、UI 側で「もっと読む」を出す方針。
const FETCH_MY_COLLECTIONS_LIMIT = 100;

export async function fetchMyCollections(): Promise<BookmarkCollection[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data, error } = await withApiTimeout(
    supabase
      .from('bookmark_collections')
      .select('id, user_id, name, emoji, is_public, bookmark_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(FETCH_MY_COLLECTIONS_LIMIT),
    'bookmarks.fetchMyCollections',
    8000,
  );
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

// DoS 防止: 巨大コレクション (数千件 bookmark) で UI フリーズ防止のため 200 件で打ち切り。
// 200 件で足りないユーザーには cursor (beforeCreatedAt) でページ送りを提供。
const FETCH_POSTS_IN_COLLECTION_LIMIT = 200;

export async function fetchPostsInCollection(
  collectionId: string | 'uncategorized',
  opts: { beforeCreatedAt?: string; limit?: number } = {},
): Promise<string[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? FETCH_POSTS_IN_COLLECTION_LIMIT, FETCH_POSTS_IN_COLLECTION_LIMIT));
  let q = supabase
    .from('saves')
    .select('post_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (collectionId === 'uncategorized') {
    q = q.is('collection_id', null);
  } else {
    q = q.eq('collection_id', collectionId);
  }
  // cursor: ISO timestamp で「これより古い」saves を取得 (created_at desc 前提)
  if (opts.beforeCreatedAt) {
    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    if (ISO_RE.test(opts.beforeCreatedAt)) {
      q = q.lt('created_at', opts.beforeCreatedAt);
    }
  }
  const { data } = await withApiTimeout(q, 'bookmarks.fetchPostsInCollection', 8000);
  return ((data ?? []) as Array<{ post_id: string }>).map((r) => r.post_id);
}
