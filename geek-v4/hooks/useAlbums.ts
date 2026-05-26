// ============================================================
// hooks/useAlbums.ts — アルバム + 写真の React Query hooks
// ============================================================
// CLAUDE.md § 5.2: queryKey は配列 prefix + id。
//   ['albums', 'mine', userId]
//   ['albums', 'shared', userId]
//   ['albums', 'one', id]
//   ['album-photos', albumId]
//   ['my-photos', scope, userId]
// mutation の onSuccess で関連 queryKey を invalidate。
// ============================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyAlbums,
  fetchSharedAlbums,
  fetchAlbum,
  fetchAlbumPhotos,
  fetchMyPhotos,
  createAlbum,
  updateAlbum,
  deleteAlbum,
  uploadAlbumPhoto,
  updatePhoto,
  deletePhoto,
} from '../lib/api/albums';
import { useAuthStore } from '../stores/authStore';
import type { Album, AlbumPhoto, PhotoVisibility } from '../types/models';

// ============================================================
// 一覧系 (read)
// ============================================================

export function useMyAlbums(): {
  albums: Album[];
  isLoading: boolean;
} {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: ['albums', 'mine', userId ?? 'anon'],
    queryFn: fetchMyAlbums,
    staleTime: 30_000,
    enabled: !!userId,
  });
  return { albums: q.data ?? [], isLoading: q.isLoading };
}

export function useSharedAlbums(): {
  albums: Album[];
  isLoading: boolean;
} {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: ['albums', 'shared', userId ?? 'anon'],
    queryFn: fetchSharedAlbums,
    staleTime: 30_000,
    enabled: !!userId,
  });
  return { albums: q.data ?? [], isLoading: q.isLoading };
}

export function useAlbum(id?: string): {
  album: Album | undefined;
  isLoading: boolean;
} {
  const q = useQuery({
    queryKey: ['albums', 'one', id ?? 'none'],
    queryFn: () => fetchAlbum(id as string),
    staleTime: 30_000,
    enabled: !!id,
  });
  return { album: q.data, isLoading: q.isLoading };
}

export function useAlbumPhotos(albumId?: string): {
  photos: AlbumPhoto[];
  isLoading: boolean;
} {
  const q = useQuery({
    queryKey: ['album-photos', albumId ?? 'none'],
    queryFn: () => fetchAlbumPhotos(albumId as string),
    staleTime: 30_000,
    enabled: !!albumId,
  });
  return { photos: q.data ?? [], isLoading: q.isLoading };
}

// マイページの 3 タブ (all / mine / shared) で使う。
// scope ごとに query を分けて切替時の点滅を防ぐ。
export function useMyPhotos(scope: 'all' | 'mine' | 'shared'): {
  photos: AlbumPhoto[];
  isLoading: boolean;
} {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({
    queryKey: ['my-photos', scope, userId ?? 'anon'],
    queryFn: () => fetchMyPhotos(scope),
    staleTime: 30_000,
    enabled: !!userId,
  });
  return { photos: q.data ?? [], isLoading: q.isLoading };
}

// ============================================================
// 共通 invalidate ヘルパ
// ============================================================
// アルバム書き換え時はカバー画像 / shared 一覧 / photo 一覧まで影響しうるので
// ある程度広めに invalidate する。partial-match の伝播漏れ問題 (CLAUDE.md § 5.2)
// は React Query の invalidateQueries では問題なく動く (setQueriesData の話)。
function useInvalidateAlbumQueries() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['albums'] });
    qc.invalidateQueries({ queryKey: ['album-photos'] });
    qc.invalidateQueries({ queryKey: ['my-photos'] });
  };
}

// ============================================================
// 書き込み系 (mutation)
// ============================================================

export function useCreateAlbum() {
  const invalidate = useInvalidateAlbumQueries();
  return useMutation({
    mutationFn: (input: {
      title: string;
      description?: string;
      visibility?: PhotoVisibility;
      shared_with_user_ids?: string[];
    }) => createAlbum(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateAlbum() {
  const invalidate = useInvalidateAlbumQueries();
  return useMutation({
    mutationFn: ({ id, patch }: {
      id: string;
      patch: Partial<{
        title: string;
        description: string;
        visibility: PhotoVisibility;
        shared_with_user_ids: string[];
        cover_photo_id: string;
      }>;
    }) => updateAlbum(id, patch),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteAlbum() {
  const invalidate = useInvalidateAlbumQueries();
  return useMutation({
    mutationFn: (id: string) => deleteAlbum(id),
    onSuccess: () => invalidate(),
  });
}

export function useUploadPhoto() {
  const invalidate = useInvalidateAlbumQueries();
  return useMutation({
    mutationFn: ({ uri, opts }: {
      uri: string;
      opts: {
        albumId?: string;
        caption?: string;
        visibility: PhotoVisibility;
        sharedWith?: string[];
      };
    }) => uploadAlbumPhoto(uri, opts),
    onSuccess: () => invalidate(),
  });
}

export function useUpdatePhoto() {
  const invalidate = useInvalidateAlbumQueries();
  return useMutation({
    mutationFn: ({ id, patch }: {
      id: string;
      patch: Partial<{
        caption: string;
        is_hidden: boolean;
        album_id: string | null;
        visibility: PhotoVisibility;
        shared_with_user_ids: string[];
      }>;
    }) => updatePhoto(id, patch),
    onSuccess: () => invalidate(),
  });
}

export function useDeletePhoto() {
  const invalidate = useInvalidateAlbumQueries();
  return useMutation({
    mutationFn: (id: string) => deletePhoto(id),
    onSuccess: () => invalidate(),
  });
}
