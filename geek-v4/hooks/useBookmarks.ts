import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import {
  fetchMyCollections, createCollection, deleteCollection, saveToCollection,
  fetchPostsInCollection, type BookmarkCollection,
} from '../lib/api/bookmarks';

const COL_KEY = ['bookmark-collections'];

export function useCollections() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: COL_KEY,
    queryFn: fetchMyCollections,
    staleTime: 60_000,
  });
  useEffect(() => {
    return attachChannel('bookmark-collections-watch', (ch) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'bookmark_collections' },
        () => qc.invalidateQueries({ queryKey: COL_KEY })),
    );
  }, [qc]);
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
