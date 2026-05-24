// ============================================================
// UsersTab — admin/index.tsx の Tab 3 (ユーザー)
// ============================================================
// 検索 + sort (最新 / 信頼スコア / 通報多い / 問題ユーザー)。
// suspend / unsuspend ボタン (確認ダイアログ付き)。
// UserRow も同居 (この tab 専用)。
// ============================================================
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Spinner } from '../ui/Spinner';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyBlock, ErrorBlock, Stat } from './AdminBlocks';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import {
  fetchAllUsers,
  suspendUser,
  unsuspendUser,
  type AdminUser,
} from '../../lib/api/admin';
import { fetchProblemUsers, type AdminProblemUser } from '../../lib/api/adminExt';
import { useToastStore } from '../../stores/toastStore';
import {
  SearchInput,
  SortChip,
  UserAvatar,
  ActionButton,
  STATE_META,
} from './adminShared';

export function UsersTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'concern' | 'trust' | 'problem'>('recent');
  const [pendingSuspend, setPendingSuspend] = useState<AdminUser | null>(null);
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);

  const isProblemMode = sortBy === 'problem';

  const usersQuery = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => fetchAllUsers({ search, limit: 200 }),
    staleTime: 30_000,
    enabled: !isProblemMode,
  });

  const problemQuery = useQuery({
    queryKey: ['admin-problem-users'],
    queryFn: () => fetchProblemUsers({ limit: 200, sortBy: 'concern' }),
    staleTime: 30_000,
    enabled: isProblemMode,
  });

  const list: AdminUser[] = useMemo(() => {
    if (isProblemMode) {
      const arr: AdminProblemUser[] = problemQuery.data ?? [];
      return arr.map<AdminUser>((u) => ({
        id: u.id,
        nickname: u.nickname,
        account_state: u.account_state,
        trust_score: u.trust_score,
        post_count: u.post_count,
        concern_received_count: u.concern_received_count,
        is_admin: false,
        created_at: u.created_at,
      }));
    }
    const arr = [...(usersQuery.data ?? [])];
    if (sortBy === 'concern') {
      arr.sort((a, b) => b.concern_received_count - a.concern_received_count);
    } else if (sortBy === 'trust') {
      arr.sort((a, b) => a.trust_score - b.trust_score);
    }
    return arr;
  }, [isProblemMode, problemQuery.data, usersQuery.data, sortBy]);

  const isLoading = isProblemMode ? problemQuery.isLoading : usersQuery.isLoading;
  const error = isProblemMode ? problemQuery.error : usersQuery.error;
  const refetch = isProblemMode ? problemQuery.refetch : usersQuery.refetch;

  const suspend = useMutation({
    mutationFn: suspendUser,
    onSuccess: () => {
      show('凍結しました', 'warn');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-problem-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => show('凍結に失敗しました', 'error'),
  });
  const unsuspend = useMutation({
    mutationFn: unsuspendUser,
    onSuccess: () => {
      show('解除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-problem-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => show('解除に失敗しました', 'error'),
  });

  const onToggle = useCallback((u: AdminUser) => {
    if (u.account_state === 'suspended') {
      unsuspend.mutate(u.id);
    } else {
      setPendingSuspend(u);
    }
  }, [unsuspend]);

  return (
    <View>
      <SearchInput value={search} onChange={setSearch} placeholder="ニックネームで検索…" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: 'row', gap: 6, paddingHorizontal: SP['4'], paddingBottom: SP['2'],
        }}
      >
        <SortChip label="最新"           active={sortBy === 'recent'}  onPress={() => setSortBy('recent')} />
        <SortChip label="信頼スコア低い順" active={sortBy === 'trust'}   onPress={() => setSortBy('trust')} />
        <SortChip label="通報多い順"     active={sortBy === 'concern'} onPress={() => setSortBy('concern')} />
        <SortChip label="問題ユーザー"   active={sortBy === 'problem'} onPress={() => setSortBy('problem')} />
      </ScrollView>
      <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}><Spinner /></View>
        ) : error ? (
          <ErrorBlock message="ユーザーを取得できませんでした" onRetry={() => void refetch()} />
        ) : list.length === 0 ? (
          <EmptyBlock emoji="📭" label="ユーザーがいません" />
        ) : (
          list.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              busy={
                (suspend.isPending && suspend.variables === u.id) ||
                (unsuspend.isPending && unsuspend.variables === u.id)
              }
              onOpen={() => router.push(`/admin/user/${u.id}` as never)}
              onMessage={() => router.push(`/admin/message/${u.id}` as never)}
              onToggle={() => onToggle(u)}
            />
          ))
        )}
      </View>
      <ConfirmDialog
        visible={pendingSuspend !== null}
        title="ユーザーを凍結"
        message={`「${pendingSuspend?.nickname ?? pendingSuspend?.id ?? ''}」を凍結します。投稿や反応ができなくなります。`}
        confirmLabel="凍結する"
        onConfirm={() => {
          if (pendingSuspend) suspend.mutate(pendingSuspend.id);
          setPendingSuspend(null);
        }}
        onCancel={() => setPendingSuspend(null)}
        destructive
      />
    </View>
  );
}

function UserRow({
  user, busy, onOpen, onMessage, onToggle,
}: {
  user: AdminUser;
  busy: boolean;
  onOpen: () => void;
  onMessage: () => void;
  onToggle: () => void;
}) {
  const stateMeta = STATE_META[user.account_state] ?? { label: user.account_state, color: C.text3 };
  const isSuspended = user.account_state === 'suspended';
  const displayName = user.nickname ?? '(no nickname)';

  return (
    <View style={[{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }, SHADOW.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <UserAvatar name={displayName} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
            <Text style={[T.bodyB, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>
              {displayName}
            </Text>
            {user.is_admin && (
              <View style={{
                paddingHorizontal: SP['2'], paddingVertical: 1,
                backgroundColor: C.accentBg, borderRadius: R.sm,
                borderWidth: 1, borderColor: C.accent + '55',
              }}>
                <Text style={{ fontSize: 9, color: C.accentLight, fontWeight: '700' }}>ADMIN</Text>
              </View>
            )}
            <View style={{
              paddingHorizontal: SP['2'], paddingVertical: 1,
              backgroundColor: stateMeta.color + '22', borderRadius: R.sm,
              borderWidth: 1, borderColor: stateMeta.color + '55',
            }}>
              <Text style={{ fontSize: 10, color: stateMeta.color, fontWeight: '700' }}>{stateMeta.label}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: SP['4'], flexWrap: 'wrap' }}>
            <Stat label="投稿" value={String(user.post_count)} />
            <Stat label="信頼" value={String(user.trust_score)} />
            <Stat label="通報" value={String(user.concern_received_count)} accent={user.concern_received_count > 0 ? C.red : undefined} />
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <ActionButton label="詳細" tone="neutral" onPress={onOpen} />
        <ActionButton label="DM"   tone="accent"  onPress={onMessage} />
        <ActionButton
          label={isSuspended ? '解除' : '凍結'}
          tone={isSuspended ? 'amber' : 'danger'}
          onPress={onToggle}
          busy={busy}
        />
      </View>
    </View>
  );
}
