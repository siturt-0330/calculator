// ============================================================
// ReportsTab — admin/index.tsx の Tab 2 (通報)
// ============================================================
// 通報投稿の一覧 + 件数フィルタ + 検索 + 削除 (確認ダイアログ付き)。
// ReportRow も同居 (この tab 専用)。
// ============================================================
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Spinner } from '../ui/Spinner';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyBlock, ErrorBlock } from './AdminBlocks';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { deletePost } from '../../lib/api/admin';
import { fetchReportedPosts, type AdminReportedPost } from '../../lib/api/adminExt';
import { useToastStore } from '../../stores/toastStore';
import {
  SearchInput,
  SortChip,
  ReportCountBadge,
  ActionButton,
  VISIBILITY_META,
  previewText,
} from './adminShared';

export function ReportsTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [minReports, setMinReports] = useState<1 | 3 | 5>(1);
  const [pendingDelete, setPendingDelete] = useState<AdminReportedPost | null>(null);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-reported', { minReports, search }],
    queryFn: () => fetchReportedPosts({ minReports, search, limit: 200 }),
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-reported'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  return (
    <View>
      <SearchInput value={search} onChange={setSearch} placeholder="本文で検索…" />
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'] }}>
        <SortChip label="全部"     active={minReports === 1} onPress={() => setMinReports(1)} />
        <SortChip label="3件以上"  active={minReports === 3} onPress={() => setMinReports(3)} />
        <SortChip label="5件以上"  active={minReports === 5} onPress={() => setMinReports(5)} />
      </View>
      <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="通報を取得できませんでした" onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyBlock emoji="✨" label="通報されている投稿はありません" />
        ) : (
          (data ?? []).map((r) => (
            <ReportRow
              key={r.post_id}
              row={r}
              busy={remove.isPending && remove.variables === r.post_id}
              onView={() => router.push(`/admin/post/${r.post_id}` as never)}
              onViewAuthor={() => router.push(`/admin/user/${r.author_id}` as never)}
              onDelete={() => setPendingDelete(r)}
            />
          ))
        )}
      </View>
      <ConfirmDialog
        visible={pendingDelete !== null}
        title="投稿を削除"
        message={
          pendingDelete
            ? `この投稿を削除します。本人にも他の閲覧者にも表示されなくなります。\n\n通報: ${pendingDelete.reports_count} 件`
            : ''
        }
        confirmLabel="削除する"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.post_id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        destructive
      />
    </View>
  );
}

function ReportRow({
  row, busy, onView, onViewAuthor, onDelete,
}: {
  row: AdminReportedPost;
  busy: boolean;
  onView: () => void;
  onViewAuthor: () => void;
  onDelete: () => void;
}) {
  const v = VISIBILITY_META[row.visibility] ?? { label: row.visibility, color: C.text3 };
  return (
    <View style={[{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }, SHADOW.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP['3'] }}>
        <ReportCountBadge count={row.reports_count} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={3}>
            {previewText(row.content)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
            <Text style={[T.captionM, { color: C.accentLight }]} numberOfLines={1}>
              {row.author_nickname ?? '(unknown)'}
            </Text>
            <View style={{
              paddingHorizontal: SP['2'], paddingVertical: 1,
              backgroundColor: v.color + '22', borderRadius: R.sm,
              borderWidth: 1, borderColor: v.color + '55',
            }}>
              <Text style={{ fontSize: 9, color: v.color, fontWeight: '700' }}>{v.label}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(row.last_reported_at)}</Text>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <ActionButton label="作者を見る"  tone="neutral" onPress={onViewAuthor} />
        <ActionButton label="投稿詳細"    tone="accent"  onPress={onView} />
        <ActionButton label="削除"        tone="danger"  onPress={onDelete} busy={busy} />
      </View>
    </View>
  );
}
