import { useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Spinner } from '../../../components/ui/Spinner';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Avatar } from '../../../components/ui/Avatar';
import { Icon } from '../../../constants/icons';
import { useToastStore } from '../../../stores/toastStore';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { formatRelative } from '../../../lib/utils/date';
import {
  fetchUserDetail,
  suspendUser,
  unsuspendUser,
  deleteAllUserPosts,
  resetAccountState,
  deletePost,
  type AdminUser,
  type AdminPost,
  type ConcernSummary,
  type ModerationLog,
} from '../../../lib/api/admin';
import { supabase } from '../../../lib/supabase';

// ============================================================
// /admin/user/[id] — admin CRM view for a single user.
// 隠し /admin 配下なので _layout.tsx の email-gate を通る前提で書く。
// 操作系は全て ConfirmDialog を挟み、成功 / 失敗を toast で返す。
// ============================================================

type Tab = 'posts' | 'concerns' | 'moderation';

// アカウント状態 → 色 / 表示ラベル のマップ。
// healthy だけ "健康" だと違和感が出るので「正常」にする。
const STATE_META: Record<string, { label: string; color: string; bg: string }> = {
  healthy:    { label: '正常',     color: C.green, bg: C.greenBg },
  caution:    { label: '注意',     color: C.amber, bg: C.amberBg },
  restricted: { label: '制限中',   color: C.amber, bg: C.amberBg },
  warned:     { label: '警告中',   color: C.red,   bg: C.redBg },
  suspended:  { label: '凍結中',   color: C.red,   bg: C.redBg },
};

// 日齢 = 登録から今日までの日数。「100 日目」表示用。
function daysSince(iso: string): number {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return 0;
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

// moderation_log の action 列 → 表示用 emoji。 未知の action は "•"
function actionEmoji(action: string): string {
  switch (action) {
    case 'suspend':       return '🚫';
    case 'unsuspend':     return '✅';
    case 'delete_post':   return '🗑️';
    case 'delete_all':    return '🧹';
    case 'reset_state':   return '🔄';
    case 'send_message':  return '📧';
    case 'note':          return '📝';
    default:              return '•';
  }
}

// ============================================================
// Screen
// ============================================================
export default function AdminUserDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const userId = typeof params.id === 'string' ? params.id : '';
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('posts');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user', userId],
    queryFn: () => fetchUserDetail(userId),
    enabled: userId.length > 0,
    staleTime: 15_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="ユーザー詳細" left={<BackButton />} />

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
      ) : error || !data ? (
        <View style={{ padding: SP['8'], alignItems: 'center', gap: SP['3'] }}>
          <Text style={{ fontSize: 36 }}>⚠️</Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
            ユーザーを取得できませんでした
          </Text>
          <PressableScale
            onPress={() => void refetch()}
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
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingBottom: insets.bottom + SP['10'],
            gap: SP['4'],
          }}
        >
          <ProfileHeader user={data.user} moderation={data.moderationHistory} />
          <ActionsCard user={data.user} />
          <TabBar tab={tab} onChange={setTab} />
          {tab === 'posts' && <PostsTab posts={data.posts} userId={userId} />}
          {tab === 'concerns' && <ConcernsTab concerns={data.recentReports} posts={data.posts} />}
          {tab === 'moderation' && <ModerationTab logs={data.moderationHistory} userId={userId} />}
        </ScrollView>
      )}
    </View>
  );
}

// ============================================================
// Profile header (avatar + nickname + stats + state badge)
// ============================================================
function ProfileHeader({ user, moderation }: { user: AdminUser; moderation: ModerationLog[] }) {
  // 凍結回数 = suspend アクションがこのユーザーに対して何度入ったか
  const suspendCount = useMemo(
    () => moderation.filter((m) => m.action === 'suspend' && m.target_id === user.id).length,
    [moderation, user.id],
  );
  const meta = STATE_META[user.account_state] ?? { label: user.account_state, color: C.text3, bg: C.bg3 };
  const ageDays = daysSince(user.created_at);

  return (
    <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], gap: SP['3'] }}>
      <View style={{ alignItems: 'center', gap: SP['2'] }}>
        <Avatar size={96} anonymous name={user.nickname ?? '?'} />
        <Text style={[T.h2, { color: C.text }]} numberOfLines={1}>
          {user.nickname ?? '(no nickname)'}
        </Text>
        <Text style={[T.small, { color: C.text3 }]}>
          匿名 · {ageDays} 日目
        </Text>
      </View>

      {/* state badge */}
      <View style={{ alignItems: 'center' }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingHorizontal: SP['3'], paddingVertical: 4,
          backgroundColor: meta.bg, borderRadius: R.full,
          borderWidth: 1, borderColor: meta.color + '55',
        }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: meta.color }} />
          <Text style={[T.smallB, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* stat cards */}
      <View style={{ flexDirection: 'row', gap: SP['2'] }}>
        <StatCard value={user.post_count} label="投稿" />
        <StatCard value={user.concern_received_count} label="通報"
          tone={user.concern_received_count > 0 ? 'red' : undefined} />
        <StatCard value={suspendCount} label="凍結"
          tone={suspendCount > 0 ? 'amber' : undefined} />
        <StatCard value={user.trust_score} label="信頼" />
      </View>

      {/* small id row for copy/debug */}
      <Text style={[T.mono, { color: C.text4, fontSize: 10, textAlign: 'center' }]} numberOfLines={1}>
        {user.id}
      </Text>
    </View>
  );
}

function StatCard({ value, label, tone }: { value: number; label: string; tone?: 'red' | 'amber' }) {
  const color = tone === 'red' ? C.red : tone === 'amber' ? C.amber : C.text;
  return (
    <View style={{
      flex: 1,
      padding: SP['3'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: 'center',
      gap: 2,
    }}>
      <Text style={[T.numLg, { color, fontWeight: '700' }]}>{value}</Text>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
    </View>
  );
}

// ============================================================
// Actions card (4 rows)
// ============================================================
function ActionsCard({ user }: { user: AdminUser }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { show } = useToastStore();

  const [pendingSuspend, setPendingSuspend] = useState(false);
  const [pendingUnsuspend, setPendingUnsuspend] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [pendingDeleteAll, setPendingDeleteAll] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-user', user.id] });

  const suspend = useMutation({
    mutationFn: () => suspendUser(user.id),
    onSuccess: () => { show('凍結しました', 'warn'); void invalidate(); },
    onError: () => show('凍結に失敗しました', 'error'),
  });
  const unsuspend = useMutation({
    mutationFn: () => unsuspendUser(user.id),
    onSuccess: () => { show('凍結を解除しました', 'success'); void invalidate(); },
    onError: () => show('解除に失敗しました', 'error'),
  });
  const reset = useMutation({
    mutationFn: () => resetAccountState(user.id),
    onSuccess: () => { show('アカウント状態をリセットしました', 'success'); void invalidate(); },
    onError: () => show('リセットに失敗しました', 'error'),
  });
  const deleteAll = useMutation({
    mutationFn: () => deleteAllUserPosts(user.id),
    onSuccess: (r) => { show(`${r.deleted} 件の投稿を削除しました`, 'success'); void invalidate(); },
    onError: () => show('削除に失敗しました', 'error'),
  });

  const isSuspended = user.account_state === 'suspended';

  return (
    <View style={{ paddingHorizontal: SP['4'] }}>
      <View style={{
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}>
        <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['2'] }}>
          <Text style={[T.smallB, { color: C.text2, letterSpacing: 0.5 }]}>アクション</Text>
        </View>

        <ActionRow
          emoji="📧"
          label="DM を送る"
          onPress={() => router.push(`/admin/message/${user.id}` as never)}
        />
        <Divider />
        {isSuspended ? (
          <ActionRow
            emoji="✅"
            label="凍結を解除"
            onPress={() => setPendingUnsuspend(true)}
            busy={unsuspend.isPending}
            tone="green"
          />
        ) : (
          <ActionRow
            emoji="🚫"
            label="アカウントを凍結"
            onPress={() => setPendingSuspend(true)}
            busy={suspend.isPending}
            tone="red"
          />
        )}
        <Divider />
        <ActionRow
          emoji="🔄"
          label="アカウント状態をリセット"
          onPress={() => setPendingReset(true)}
          busy={reset.isPending}
        />
        <Divider />
        <ActionRow
          emoji="🗑️"
          label="全投稿を削除"
          onPress={() => setPendingDeleteAll(true)}
          busy={deleteAll.isPending}
          tone="red"
        />
      </View>

      <ConfirmDialog
        visible={pendingSuspend}
        title="アカウントを凍結"
        message={`「${user.nickname ?? user.id}」を凍結します。投稿や反応ができなくなります。`}
        confirmLabel="凍結する"
        destructive
        onConfirm={() => { suspend.mutate(); setPendingSuspend(false); }}
        onCancel={() => setPendingSuspend(false)}
      />
      <ConfirmDialog
        visible={pendingUnsuspend}
        title="凍結を解除"
        message={`「${user.nickname ?? user.id}」の凍結を解除し、通常利用に戻します。`}
        confirmLabel="解除する"
        onConfirm={() => { unsuspend.mutate(); setPendingUnsuspend(false); }}
        onCancel={() => setPendingUnsuspend(false)}
      />
      <ConfirmDialog
        visible={pendingReset}
        title="アカウント状態をリセット"
        message={'通報カウントを 0 に戻し、状態を「正常」にします。モデレーション履歴自体は保持されます。'}
        confirmLabel="リセットする"
        destructive
        onConfirm={() => { reset.mutate(); setPendingReset(false); }}
        onCancel={() => setPendingReset(false)}
      />
      <ConfirmDialog
        visible={pendingDeleteAll}
        title="全投稿を削除"
        message={`${user.post_count} 件の投稿を完全に削除しますか？この操作は取り消せません。`}
        confirmLabel="全て削除する"
        destructive
        onConfirm={() => { deleteAll.mutate(); setPendingDeleteAll(false); }}
        onCancel={() => setPendingDeleteAll(false)}
      />
    </View>
  );
}

function ActionRow({
  emoji, label, onPress, busy, tone,
}: {
  emoji: string; label: string; onPress: () => void; busy?: boolean; tone?: 'red' | 'green';
}) {
  const labelColor = tone === 'red' ? C.red : tone === 'green' ? C.green : C.text;
  const ChevronR = Icon.chevronR;
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      disabled={busy}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
        paddingHorizontal: SP['4'],
        paddingVertical: SP['3'],
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
      <Text style={[T.bodyB, { color: labelColor, flex: 1 }]}>{label}</Text>
      {busy ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        <ChevronR size={16} color={C.text3} strokeWidth={2.2} />
      )}
    </PressableScale>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: C.divider, marginLeft: SP['4'] }} />;
}

// ============================================================
// Tab bar
// ============================================================
function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={{
      flexDirection: 'row',
      paddingHorizontal: SP['4'],
      gap: SP['2'],
    }}>
      <TabPill active={tab === 'posts'}      label="投稿"           onPress={() => onChange('posts')} />
      <TabPill active={tab === 'concerns'}   label="通報履歴"        onPress={() => onChange('concerns')} />
      <TabPill active={tab === 'moderation'} label="モデレーション" onPress={() => onChange('moderation')} />
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
// Tab 1: 投稿
// ============================================================
function PostsTab({ posts, userId }: { posts: AdminPost[]; userId: string }) {
  const [pending, setPending] = useState<AdminPost | null>(null);
  const qc = useQueryClient();
  const { show } = useToastStore();

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('投稿を削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-user', userId] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  if (posts.length === 0) {
    return <EmptyRow icon="📭" label="投稿がありません" />;
  }

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
      {posts.map((p) => (
        <View
          key={p.id}
          style={{
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
          }}
        >
          <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={4}>
            {p.content || '(本文なし)'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['4'], flexWrap: 'wrap' }}>
            <MiniStat label="いいね" value={p.likes_count} />
            <MiniStat
              label="通報"
              value={p.concern_count}
              accent={p.concern_count > 0 ? C.red : undefined}
            />
            <Text style={[T.caption, { color: C.text4 }]}>{formatRelative(p.created_at)}</Text>
            <View style={{ flex: 1 }} />
            <PressableScale
              onPress={() => setPending(p)}
              haptic="warn"
              disabled={remove.isPending && remove.variables === p.id}
              style={{
                paddingHorizontal: SP['3'], paddingVertical: 6,
                backgroundColor: C.redBg, borderRadius: R.full,
                borderWidth: 1, borderColor: C.red + '55',
                flexDirection: 'row', alignItems: 'center', gap: 6,
                opacity: remove.isPending && remove.variables === p.id ? 0.6 : 1,
              }}
            >
              {remove.isPending && remove.variables === p.id && (
                <ActivityIndicator size="small" color={C.red} />
              )}
              <Text style={[T.smallB, { color: C.red }]}>削除</Text>
            </PressableScale>
          </View>
        </View>
      ))}
      <ConfirmDialog
        visible={pending !== null}
        title="投稿を削除"
        message="この投稿を完全に削除します。元には戻せません。"
        confirmLabel="削除する"
        destructive
        onConfirm={() => {
          if (pending) remove.mutate(pending.id);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

// ============================================================
// Tab 2: 通報履歴
// ============================================================
// ConcernSummary は { user_id (reporter), post_id, reason, created_at } の shape。
// post 本文 / reporter nickname は同梱されないので、posts は親の data から、
// reporter は user_id 先頭 8 桁で表示する。
function ConcernsTab({ concerns, posts }: { concerns: ConcernSummary[]; posts: AdminPost[] }) {
  // post_id → 本文 の即時 lookup
  const postMap = useMemo(() => {
    const m = new Map<string, AdminPost>();
    for (const p of posts) m.set(p.id, p);
    return m;
  }, [posts]);

  // 投稿単位でグルーピング — 1 つの投稿が複数人から通報される時の繰返し表示を抑える
  const grouped = useMemo(() => {
    const map = new Map<string, { post_id: string; reporters: ConcernSummary[] }>();
    for (const c of concerns) {
      const existing = map.get(c.post_id);
      if (existing) {
        existing.reporters.push(c);
      } else {
        map.set(c.post_id, { post_id: c.post_id, reporters: [c] });
      }
    }
    return Array.from(map.values());
  }, [concerns]);

  if (grouped.length === 0) {
    return <EmptyRow icon="🕊️" label="通報されていません" />;
  }

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
      {grouped.map((g) => {
        const post = postMap.get(g.post_id);
        return (
          <View
            key={g.post_id}
            style={{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: SP['2'],
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <View style={{
                paddingHorizontal: SP['2'], paddingVertical: 1,
                backgroundColor: C.redBg, borderRadius: R.sm,
                borderWidth: 1, borderColor: C.red + '55',
              }}>
                <Text style={{ fontSize: 10, color: C.red, fontWeight: '700' }}>
                  {g.reporters.length} 件
                </Text>
              </View>
              <Text style={[T.captionM, { color: C.text3, flex: 1 }]} numberOfLines={1}>
                投稿 {g.post_id.slice(0, 8)}
              </Text>
            </View>
            <Text style={[T.body, { color: C.text, lineHeight: 21 }]} numberOfLines={3}>
              {post?.content || '(本文を取得できませんでした)'}
            </Text>
            <View style={{ gap: 4, paddingTop: SP['1'], borderTopWidth: 1, borderTopColor: C.divider }}>
              {g.reporters.map((r, i) => (
                <View
                  key={`${r.user_id}-${i}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], paddingTop: 4 }}
                >
                  <Text style={[T.smallM, { color: C.text2, flex: 1 }]} numberOfLines={1}>
                    通報者: {r.user_id.slice(0, 8)}
                  </Text>
                  <Text style={[T.caption, { color: C.text4 }]}>
                    {formatRelative(r.created_at)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ============================================================
// Tab 3: モデレーション履歴
// ============================================================
function ModerationTab({ logs, userId }: { logs: ModerationLog[]; userId: string }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { show } = useToastStore();

  // メモを moderation_log に 'note' action として書き込む。
  // sendAdminMessage 系の helper は本人に通知が飛ぶので使えない — 直接 insert。
  const saveNote = async () => {
    const trimmed = note.trim();
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const adminId = auth.user?.id;
      if (!adminId) throw new Error('not signed in');
      const { error } = await supabase.from('moderation_log').insert({
        admin_id: adminId,
        action: 'note',
        target_type: 'user',
        target_id: userId,
        reason: trimmed,
      });
      if (error) throw error;
      setNote('');
      show('メモを保存しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-user', userId] });
    } catch {
      show('メモの保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ paddingHorizontal: SP['4'], gap: SP['2'] }}>
      {/* note input */}
      <View style={{
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        padding: SP['3'],
        gap: SP['2'],
      }}>
        <Text style={[T.smallB, { color: C.text2 }]}>自分のメモを残す</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="このユーザーに関する社内メモ…"
          placeholderTextColor={C.text4}
          multiline
          style={[
            T.body,
            {
              color: C.text,
              backgroundColor: C.bg3,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              padding: SP['3'],
              minHeight: 72,
              textAlignVertical: 'top',
            },
          ]}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <PressableScale
            onPress={() => { void saveNote(); }}
            haptic="confirm"
            disabled={saving || note.trim().length === 0}
            style={{
              paddingHorizontal: SP['4'], paddingVertical: SP['2'],
              backgroundColor: note.trim().length === 0 ? C.bg3 : C.accent,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: note.trim().length === 0 ? C.border : C.accent,
              flexDirection: 'row', alignItems: 'center', gap: 6,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving && <ActivityIndicator size="small" color="#fff" />}
            <Text style={[T.smallB, { color: note.trim().length === 0 ? C.text3 : '#fff' }]}>
              保存
            </Text>
          </PressableScale>
        </View>
      </View>

      {logs.length === 0 ? (
        <EmptyRow icon="📜" label="モデレーション履歴はありません" />
      ) : (
        logs.map((l) => (
          <View
            key={l.id}
            style={{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={{ fontSize: 16 }}>{actionEmoji(l.action)}</Text>
              <Text style={[T.smallB, { color: C.text, flex: 1 }]} numberOfLines={1}>
                {l.action}
              </Text>
              <Text style={[T.caption, { color: C.text4 }]}>
                {formatRelative(l.created_at)}
              </Text>
            </View>
            <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
              admin: {l.admin_id.slice(0, 8)}
            </Text>
            {l.reason && (
              <Text style={[T.small, { color: C.text2, lineHeight: 18 }]} numberOfLines={4}>
                {l.reason}
              </Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

// ============================================================
// shared helpers
// ============================================================
function MiniStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.smallB, { color: accent ?? C.text, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

function EmptyRow({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={{ paddingVertical: SP['8'], alignItems: 'center', gap: SP['2'] }}>
      <Text style={{ fontSize: 32 }}>{icon}</Text>
      <Text style={[T.body, { color: C.text2 }]}>{label}</Text>
    </View>
  );
}
