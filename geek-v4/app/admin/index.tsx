import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import {
  fetchAllUsers,
  fetchAllPosts,
  suspendUser,
  unsuspendUser,
  deletePost,
  type AdminUser,
  type AdminPost,
} from '../../lib/api/admin';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

type Tab = 'users' | 'posts';

// アカウント状態 → 色 / ラベル のシンプルなマップ。 AccountStateBadge は装飾が
// 過剰なので admin パネルでは小さい pill 表示で良い。
const STATE_META: Record<string, { label: string; color: string }> = {
  healthy:    { label: '健康',  color: C.green },
  caution:    { label: '注意',  color: C.amber },
  restricted: { label: '制限',  color: C.amber },
  warned:     { label: '警告',  color: C.red },
  suspended:  { label: '停止',  color: C.text3 },
};

const VISIBILITY_META: Record<string, { label: string; color: string }> = {
  public:           { label: '公開',         color: C.green },
  community_public: { label: 'コミュ+公開', color: C.blue },
  community_only:   { label: 'コミュ限定',   color: C.accent },
  private:          { label: '非公開',       color: C.text3 },
};

export default function AdminIndexScreen() {
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore((s) => s.signOut);
  const [tab, setTab] = useState<Tab>('users');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="管理パネル"
        left={<BackButton />}
        right={
          <PressableScale
            onPress={() => { void signOut(); }}
            haptic="warn"
            style={{
              paddingHorizontal: SP['3'], paddingVertical: 6,
              backgroundColor: C.bg3, borderRadius: R.full,
              borderWidth: 1, borderColor: C.border,
            }}
          >
            <Text style={[T.caption, { color: C.text2, fontWeight: '700' }]}>ログアウト</Text>
          </PressableScale>
        }
      />

      {/* DEV badge — このページが普通のユーザー向けでない事を明示 */}
      <View style={{
        paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['1'],
        flexDirection: 'row', alignItems: 'center', gap: SP['2'],
      }}>
        <View style={{
          paddingHorizontal: SP['2'], paddingVertical: 2,
          backgroundColor: C.redBg, borderRadius: R.sm,
          borderWidth: 1, borderColor: C.red + '55',
        }}>
          <Text style={{ fontSize: 10, color: C.red, fontWeight: '700', letterSpacing: 0.5 }}>DEV ADMIN</Text>
        </View>
        <Text style={[T.caption, { color: C.text3 }]}>
          全ユーザー / 投稿への書き込み権限あり。慎重に。
        </Text>
      </View>

      {/* タブ */}
      <View style={{
        flexDirection: 'row',
        paddingHorizontal: SP['4'],
        paddingTop: SP['2'],
        gap: SP['2'],
      }}>
        <TabPill active={tab === 'users'} label="ユーザー" onPress={() => setTab('users')} />
        <TabPill active={tab === 'posts'} label="投稿" onPress={() => setTab('posts')} />
      </View>

      <View style={{ flex: 1, paddingTop: SP['3'] }}>
        {tab === 'users' ? (
          <UsersTab bottomInset={insets.bottom} />
        ) : (
          <PostsTab bottomInset={insets.bottom} />
        )}
      </View>
    </View>
  );
}

function TabPill({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        paddingHorizontal: SP['4'],
        paddingVertical: SP['2'],
        backgroundColor: active ? C.accent : C.bg3,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: active ? C.accent : C.border,
      }}
    >
      <Text style={[T.smallM, { color: active ? '#fff' : C.text, fontWeight: '700' }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ============================================================
// ユーザー tab
// ============================================================
function UsersTab({ bottomInset }: { bottomInset: number }) {
  const [search, setSearch] = useState('');
  const qc = useQueryClient();
  const { show } = useToastStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => fetchAllUsers({ search, limit: 200 }),
    staleTime: 30_000,
  });

  const suspend = useMutation({
    mutationFn: suspendUser,
    onSuccess: () => {
      show('凍結しました', 'warn');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: () => show('凍結に失敗しました', 'error'),
  });
  const unsuspend = useMutation({
    mutationFn: unsuspendUser,
    onSuccess: () => {
      show('解除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: () => show('解除に失敗しました', 'error'),
  });

  const onToggle = useCallback((u: AdminUser) => {
    if (u.account_state === 'suspended') {
      unsuspend.mutate(u.id);
    } else {
      suspend.mutate(u.id);
    }
  }, [suspend, unsuspend]);

  return (
    <View style={{ flex: 1 }}>
      <SearchInput value={search} onChange={setSearch} placeholder="ニックネームで検索…" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: bottomInset + SP['10'],
          gap: SP['2'],
        }}
      >
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}>
            <Spinner />
          </View>
        ) : error ? (
          <ErrorBlock message="ユーザーを取得できませんでした" onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyBlock label="該当するユーザーはありません" />
        ) : (
          (data ?? []).map((u) => (
            <UserRow
              key={u.id}
              user={u}
              busy={
                (suspend.isPending && suspend.variables === u.id) ||
                (unsuspend.isPending && unsuspend.variables === u.id)
              }
              onToggle={() => onToggle(u)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function UserRow({ user, busy, onToggle }: { user: AdminUser; busy: boolean; onToggle: () => void }) {
  const stateMeta = STATE_META[user.account_state] ?? { label: user.account_state, color: C.text3 };
  const isSuspended = user.account_state === 'suspended';

  return (
    <View style={{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }}>
      {/* 1 行目: nickname + admin badge + state */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
        <Text style={[T.bodyB, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>
          {user.nickname ?? '(no nickname)'}
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

      {/* 2 行目: id (mono) */}
      <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
        {user.id}
      </Text>

      {/* 3 行目: stats */}
      <View style={{ flexDirection: 'row', gap: SP['4'], flexWrap: 'wrap' }}>
        <Stat label="信頼" value={String(user.trust_score)} />
        <Stat label="投稿" value={String(user.post_count)} />
        <Stat label="通報" value={String(user.concern_received_count)} accent={user.concern_received_count > 0 ? C.red : undefined} />
      </View>

      {/* 4 行目: 凍結 / 解除 ボタン */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <PressableScale
          onPress={onToggle}
          haptic="warn"
          disabled={busy}
          style={{
            paddingHorizontal: SP['3'], paddingVertical: 6,
            backgroundColor: isSuspended ? C.greenBg : C.redBg,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: isSuspended ? C.green + '55' : C.red + '55',
            flexDirection: 'row', alignItems: 'center', gap: 6,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy && <ActivityIndicator size="small" color={isSuspended ? C.green : C.red} />}
          <Text style={[T.smallB, { color: isSuspended ? C.green : C.red }]}>
            {isSuspended ? '解除' : '凍結'}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

// ============================================================
// 投稿 tab
// ============================================================
function PostsTab({ bottomInset }: { bottomInset: number }) {
  const [search, setSearch] = useState('');
  const qc = useQueryClient();
  const { show } = useToastStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-posts', search],
    queryFn: () => fetchAllPosts({ search, limit: 200 }),
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-posts'] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  return (
    <View style={{ flex: 1 }}>
      <SearchInput value={search} onChange={setSearch} placeholder="本文で検索…" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: bottomInset + SP['10'],
          gap: SP['2'],
        }}
      >
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}>
            <Spinner />
          </View>
        ) : error ? (
          <ErrorBlock message="投稿を取得できませんでした" onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyBlock label="該当する投稿はありません" />
        ) : (
          (data ?? []).map((p) => (
            <PostRow
              key={p.id}
              post={p}
              busy={remove.isPending && remove.variables === p.id}
              onDelete={() => remove.mutate(p.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function PostRow({ post, busy, onDelete }: { post: AdminPost; busy: boolean; onDelete: () => void }) {
  const vMeta = VISIBILITY_META[post.visibility] ?? { label: post.visibility, color: C.text3 };
  return (
    <View style={{
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['2'],
    }}>
      {/* badges + author */}
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
          {new Date(post.created_at).toLocaleDateString('ja-JP')}
        </Text>
      </View>

      {/* content preview */}
      <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={4}>
        {post.content || '(本文なし)'}
      </Text>

      {/* stats + delete */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['4'], flexWrap: 'wrap' }}>
        <Stat label="いいね" value={String(post.likes_count)} />
        <Stat label="通報" value={String(post.concern_count)} accent={post.concern_count > 0 ? C.red : undefined} />
        <View style={{ flex: 1 }} />
        <PressableScale
          onPress={onDelete}
          haptic="warn"
          disabled={busy}
          style={{
            paddingHorizontal: SP['3'], paddingVertical: 6,
            backgroundColor: C.redBg,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.red + '55',
            flexDirection: 'row', alignItems: 'center', gap: 6,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy && <ActivityIndicator size="small" color={C.red} />}
          <Text style={[T.smallB, { color: C.red }]}>削除</Text>
        </PressableScale>
      </View>

      {/* post id (mono, 末尾に小さく) */}
      <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
        {post.id}
      </Text>
    </View>
  );
}

// ============================================================
// shared helpers
// ============================================================
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.text3}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          T.body,
          {
            color: C.text,
            backgroundColor: C.bg3,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            paddingHorizontal: SP['3'],
            paddingVertical: SP['3'],
          },
        ]}
      />
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.smallB, { color: accent ?? C.text, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['2'] }}>
      <Text style={{ fontSize: 36 }}>📭</Text>
      <Text style={[T.body, { color: C.text2 }]}>{label}</Text>
    </View>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['3'] }}>
      <Text style={{ fontSize: 36 }}>⚠️</Text>
      <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>{message}</Text>
      <PressableScale
        onPress={onRetry}
        haptic="tap"
        style={{
          paddingHorizontal: SP['4'], paddingVertical: SP['2'],
          backgroundColor: C.bg3, borderRadius: R.full,
          borderWidth: 1, borderColor: C.border,
        }}
      >
        <Text style={[T.smallM, { color: C.text }]}>再読み込み</Text>
      </PressableScale>
    </View>
  );
}
