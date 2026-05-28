import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyCollections, createCollection, deleteCollection, saveToCollection,
  fetchPostsInCollection, type BookmarkCollection,
} from '../lib/api/bookmarks';

const COL_KEY = ['bookmark-collections'];

// ============================================================
// useCollections
// ============================================================
// 旧構成: 個別 channel `bookmark-collections-watch:userId` を attach。
// 新構成 (Audit E#5): hooks/useUserChannel.ts の 1 channel に集約 (filter=user_id)。
// realtime invalidate は user channel 側で走るのでここでは何もしない。
// ============================================================
export function useCollections() {
  const q = useQuery({
    queryKey: COL_KEY,
    queryFn: fetchMyCollections,
    staleTime: 60_000,
  });
  return { collections: (q.data ?? []) as BookmarkCollection[], isLoading: q.isLoading };
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, emoji, isPublic }: { name: string; emoji?: string; isPublic?: boolean }) =>
      createCollection(name, emoji, isPublic),
    onSuccess: () => qc.invalidateQueries({ queryKey: COL_KEY }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteCollection,
    onSuccess: () => qc.invalidateQueries({ queryKey: COL_KEY }),
  });
}

export function useSaveToCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, collectionId }: { postId: string; collectionId: string | null }) =>
      saveToCollection(postId, collectionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COL_KEY });
      qc.invalidateQueries({ queryKey: ['my-saves'] });
      qc.invalidateQueries({ queryKey: ['saved-posts'] });
    },
  });
}

export function useCollectionPosts(collectionId: string | 'uncategorized' | null) {
  return useQuery({
    queryKey: ['collection-posts', collectionId],
    queryFn: () => collectionId ? fetchPostsInCollection(collectionId) : [],
    enabled: !!collectionId,
  });
}
