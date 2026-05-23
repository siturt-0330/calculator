// ============================================================
// PostsTab — admin/index.tsx の Tab 4 (投稿)
// ============================================================
// 全投稿の検索 + sort (最新 / 人気 / 通報) + 削除 (確認ダイアログ付き)。
// PostRow も同居。
// ============================================================
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Spinner } from '../ui/Spinner';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyBlock, ErrorBlock, Stat } from './AdminBlocks';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import {
  fetchAllPosts,
  deletePost,
  type AdminPost,
} from '../../lib/api/admin';
import { useToastStore } from '../../stores/toastStore';
import {
  SearchInput,
  SortChip,
  ActionButton,
  VISIBILITY_META,
} from './adminShared';

export function PostsTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'popular' | 'reports'>('recent');
  const [pendingDelete, setPendingDelete] = useState<AdminPost | null>(null);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-posts', search],
    queryFn: () => fetchAllPosts({ search, limit: 200 }),
    staleTime: 30_000,
  });

  const sorted: AdminPost[] = useMemo(() => {
    const arr = [...(data ?? [])];
    if (sortBy === 'popular') {
      arr.sort((a, b) => b.likes_count - a.likes_count);
    } else if (sortBy === 'reports') {
      arr.sort((a, b) => b.concern_count - a.concern_count);
    }
    return arr;
  }, [data, sortBy]);

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-posts'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  return (
    <View>
      <SearchInput value={search} onChange={setSearch} placeholder="本文で検索…" />
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'] }}>
        <SortChip label="最新" active={sortBy === 'recent'}  onPress={() => setSortBy('recent')} />
        <SortChip label="人気" active={sortBy === 'popular'} onPress={() => setSortBy('popular')} />
        <SortChip label="通報" active={sortBy === 'reports'} onPress={() => setSortBy('reports')} />
      </View>
      <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="投稿を取得できませんでした" onRetry={() => void refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyBlock emoji="📭" label="投稿がありません" />
        ) : (
          sorted.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              busy={remove.isPending && remove.variables === p.id}
              onOpen={() => router.push(`/admin/post/${p.id}` as never)}
              onDelete={() => setPendingDelete(p)}
            />
          ))
        )}
      </View>
      <ConfirmDialog
        visible={pendingDelete !== null}
        title="投稿を削除"
        message={`この投稿を削除します。本人にも他の閲覧者にも表示されなくなります。${pendingDelete?.concern_count ? `\n\n通報: ${pendingDelete.concern_count} 件` : ''}`}
        confirmLabel="削除する"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        destructive
      />
    </View>
  );
}

function PostRow({
  post, busy, onOpen, onDelete,
}: {
  post: AdminPost;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const vMeta = VISIBILITY_META[post.visibility] ?? { label: post.visibility, color: C.text3 };
  return (
    <View style={[{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }, SHADOW.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
        <View style={{
          paddingHorizontal: SP['2'], paddingVertical: 1,
          backgroundColor: vMeta.color + '22', borderRadius: R.sm,
          borderWidth: 1, borderColor: vMeta.color + '55',
        }}>
          <Text style={{ fontSize: 10, color: vMeta.color, fontWeight: '700' }}>{vMeta.label}</Text>
        </View>
        <Text style={[T.captionM, { color: C.text2 }]} numberOfLines={1}>
          {post.author_nickname ?? '(unknown)'}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[T.caption, { color: C.text4 }]}>
          {formatRelative(post.created_at)}
        </Text>
      </View>

      <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={4}>
        {post.content || '(本文なし)'}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['4'], flexWrap: 'wrap' }}>
        <Stat label="いいね" value={String(post.likes_count)} />
        <Stat label="通報"   value={String(post.concern_count)} accent={post.concern_count > 0 ? C.red : undefined} />
        <View style={{ flex: 1 }} />
        <ActionButton label="詳細" tone="accent"  onPress={onOpen} />
        <ActionButton label="削除" tone="danger" onPress={onDelete} busy={busy} />
      </View>
    </View>
  );
}
