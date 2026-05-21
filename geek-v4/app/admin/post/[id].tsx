import { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Avatar } from '../../../components/ui/Avatar';
import { Skeleton } from '../../../components/ui/Skeleton';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon } from '../../../constants/icons';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { useToastStore } from '../../../stores/toastStore';
import { formatRelative } from '../../../lib/utils/date';
import {
  fetchPostDetail,
  deletePost,
  type ModerationLog,
  type AdminPost,
} from '../../../lib/api/admin';

// ============================================================
// 投稿詳細 (admin) — /admin/post/[id]
// ============================================================
// Premium "post investigation" view.
//   - Author preview card (tap → /admin/user/[authorId])
//   - Post content + engagement stat pills
//   - Reporters chip grid (top 6 + "+N more")
//   - Moderation history vertical timeline
//   - Sticky bottom action bar (Delete / DM / View author)
// ============================================================

const VISIBILITY_META: Record<string, { label: string; color: string }> = {
  public:           { label: '公開',          color: C.green },
  community_public: { label: 'コミュ+公開',  color: C.blue },
  community_only:   { label: 'コミュ限定',    color: C.accent },
  private:          { label: '非公開',        color: C.text3 },
};

// moderation_log.action → 日本語ラベル + timeline カラー
const ACTION_META: Record<string, { label: string; color: string }> = {
  suspend_user:        { label: 'ユーザー凍結',       color: C.red },
  unsuspend_user:      { label: 'ユーザー解除',       color: C.green },
  delete_post:         { label: '投稿削除',           color: C.red },
  delete_thread:       { label: 'スレッド削除',       color: C.red },
  delete_comment:      { label: 'コメント削除',       color: C.red },
  delete_all:          { label: '全投稿削除',         color: C.red },
  send_message:        { label: 'DM 送信',            color: C.blue },
  reset_account_state: { label: 'アカウント状態リセット', color: C.amber },
  reset_state:         { label: 'アカウント状態リセット', color: C.amber },
  note:                { label: 'メモ',               color: C.text2 },
};

function actionMeta(action: string): { label: string; color: string } {
  return ACTION_META[action] ?? { label: action, color: C.text3 };
}

// short id: 末尾 6 桁を mono で
function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(-8);
}

export default function AdminPostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { show } = useToastStore();

  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-post-detail', id],
    queryFn: () => fetchPostDetail(id),
    enabled: !!id,
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      show('投稿を削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-posts'] });
      void qc.invalidateQueries({ queryKey: ['admin-reported-posts'] });
      void qc.invalidateQueries({ queryKey: ['admin-post-detail', id] });
      router.back();
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  const postIdShort = data ? shortId(data.post.id) : id ? shortId(id) : '';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="投稿の詳細"
        left={<BackButton />}
        right={
          postIdShort ? (
            <View
              style={{
                paddingHorizontal: SP['2'],
                paddingVertical: 3,
                borderRadius: R.full,
                backgroundColor: C.bg3,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={[T.mono, { color: C.text3, fontSize: 10 }]}>
                Post #{postIdShort}
              </Text>
            </View>
          ) : null
        }
      />

      {isLoading ? (
        <LoadingState />
      ) : error || !data ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={Icon.warn}
            title="投稿を取得できませんでした"
            message="削除済みか、ネットワークエラーの可能性があります。"
            actionLabel="再読み込み"
            onAction={() => void refetch()}
            tone="amber"
          />
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{
              padding: SP['4'],
              paddingBottom: insets.bottom + 96 + SP['6'],
              gap: SP['4'],
            }}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.duration(280).delay(20)}>
              <AuthorCard
                authorId={data.post.author_id}
                nickname={data.post.author_nickname}
                createdAt={data.post.created_at}
                onPress={() =>
                  router.push(`/admin/user/${data.post.author_id}` as never)
                }
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(280).delay(60)}>
              <PostContentCard post={data.post} />
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(280).delay(100)}>
              <ReportersCard reporters={data.reporters} />
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(280).delay(140)}>
              <ModerationTimeline history={data.moderationHistory} />
            </Animated.View>
          </ScrollView>

          <ActionBar
            insetBottom={insets.bottom}
            deleting={remove.isPending}
            onDelete={() => setDeleteOpen(true)}
            onDM={() =>
              router.push(`/admin/message/${data.post.author_id}` as never)
            }
            onViewAuthor={() =>
              router.push(`/admin/user/${data.post.author_id}` as never)
            }
          />
        </>
      )}

      <ConfirmDialog
        visible={deleteOpen}
        title="投稿を削除"
        message={
          data
            ? `この投稿を削除します。本人にも他の閲覧者にも表示されなくなります。${
                data.post.concern_count > 0
                  ? `\n\n通報: ${data.post.concern_count} 件`
                  : ''
              }`
            : ''
        }
        confirmLabel={remove.isPending ? '削除中…' : '削除する'}
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!data || remove.isPending) return;
          remove.mutate(data.post.id);
          setDeleteOpen(false);
        }}
      />
    </View>
  );
}

// ============================================================
// Loading skeleton
// ============================================================
function LoadingState() {
  return (
    <ScrollView
      contentContainerStyle={{ padding: SP['4'], gap: SP['4'] }}
      showsVerticalScrollIndicator={false}
    >
      <Skeleton height={80} radius={R.lg} />
      <Skeleton height={180} radius={R.lg} />
      <Skeleton height={120} radius={R.lg} />
      <Skeleton height={140} radius={R.lg} />
    </ScrollView>
  );
}

// ============================================================
// Author preview card
// ============================================================
function AuthorCard({
  authorId,
  nickname,
  createdAt,
  onPress,
}: {
  authorId: string;
  nickname: string | null;
  createdAt: string;
  onPress: () => void;
}) {
  const ChevronR = Icon.chevronR;
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
        ...SHADOW.card,
      }}
    >
      <Avatar size={48} name={nickname ?? undefined} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
            {nickname ?? '(unknown)'}
          </Text>
        </View>
        <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
          投稿: {formatRelative(createdAt)}
        </Text>
        <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
          {authorId}
        </Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: SP['2'],
          paddingVertical: SP['1'],
          backgroundColor: C.accentSoft,
          borderRadius: R.full,
        }}
      >
        <Text style={[T.smallB, { color: C.accentLight, fontSize: 11 }]}>
          ユーザー詳細
        </Text>
        <ChevronR size={12} color={C.accentLight} strokeWidth={2.4} />
      </View>
    </PressableScale>
  );
}

// ============================================================
// Post content card
// ============================================================
function PostContentCard({ post }: { post: AdminPost }) {
  const vMeta =
    VISIBILITY_META[post.visibility] ?? { label: post.visibility, color: C.text3 };

  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
        ...SHADOW.card,
      }}
    >
      {/* visibility chip */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
        <ChipBadge label={vMeta.label} color={vMeta.color} />
        <ChipBadge label={formatRelative(post.created_at)} color={C.text3} subtle />
      </View>

      {/* body */}
      <View
        style={{
          padding: SP['3'],
          backgroundColor: C.bg3,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Text style={[T.body, { color: C.text, lineHeight: 24 }]}>
          {post.content || '(本文なし)'}
        </Text>
      </View>

      {/* engagement stat pills */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
        <StatPill
          icon={Icon.heart}
          label="いいね"
          value={post.likes_count}
          color={C.pink}
        />
        <StatPill
          icon={Icon.flag}
          label="通報"
          value={post.concern_count}
          color={post.concern_count > 0 ? C.red : C.text3}
          highlight={post.concern_count > 0}
        />
      </View>
    </View>
  );
}

function StatPill({
  icon: I,
  label,
  value,
  color,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  color: string;
  highlight?: boolean;
}) {
  const formatted = useMemo(() => value.toLocaleString('ja-JP'), [value]);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: SP['3'],
        paddingVertical: 6,
        borderRadius: R.full,
        backgroundColor: highlight ? color + '15' : C.bg3,
        borderWidth: 1,
        borderColor: highlight ? color + '55' : C.border,
      }}
    >
      <I size={13} color={color} strokeWidth={2.4} />
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.smallB, { color: highlight ? color : C.text, fontWeight: '700' }]}>
        {formatted}
      </Text>
    </View>
  );
}

function ChipBadge({
  label,
  color,
  subtle,
}: {
  label: string;
  color: string;
  subtle?: boolean;
}) {
  return (
    <View
      style={{
        paddingHorizontal: SP['2'],
        paddingVertical: 3,
        backgroundColor: subtle ? C.bg3 : color + '22',
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: subtle ? C.border : color + '55',
      }}
    >
      <Text style={{ fontSize: 10, color: subtle ? C.text3 : color, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

// ============================================================
// Reporters — avatar chip grid
// ============================================================
const REPORTERS_VISIBLE = 6;

function ReportersCard({
  reporters,
}: {
  reporters: Array<{ user_id: string; nickname: string | null; created_at: string }>;
}) {
  const total = reporters.length;
  const visible = reporters.slice(0, REPORTERS_VISIBLE);
  const extra = Math.max(0, total - REPORTERS_VISIBLE);

  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
        ...SHADOW.card,
      }}
    >
      <SectionHeader
        icon={Icon.flag}
        label={`通報したユーザー (${total}件)`}
        accent={total > 0 ? C.red : undefined}
      />

      {total === 0 ? (
        <Text style={[T.small, { color: C.text3 }]}>
          通報はまだありません。
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
          {visible.map((r) => (
            <ReporterChip key={`${r.user_id}-${r.created_at}`} reporter={r} />
          ))}
          {extra > 0 ? (
            <View
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                borderRadius: R.full,
                backgroundColor: C.bg3,
                borderWidth: 1,
                borderColor: C.border,
                justifyContent: 'center',
              }}
            >
              <Text style={[T.smallB, { color: C.text3 }]}>+{extra} more</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function ReporterChip({
  reporter,
}: {
  reporter: { user_id: string; nickname: string | null; created_at: string };
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 4,
        paddingRight: SP['3'],
        paddingVertical: 4,
        borderRadius: R.full,
        backgroundColor: C.bg3,
        borderWidth: 1,
        borderColor: C.border,
        maxWidth: 200,
      }}
    >
      <Avatar size={22} name={reporter.nickname ?? undefined} />
      <Text style={[T.caption, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>
        {reporter.nickname ?? '(unknown)'}
      </Text>
      <Text style={[T.caption, { color: C.text4, fontSize: 10 }]}>
        {formatRelative(reporter.created_at)}
      </Text>
    </View>
  );
}

// ============================================================
// Moderation history — vertical timeline
// ============================================================
function ModerationTimeline({ history }: { history: ModerationLog[] }) {
  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
        ...SHADOW.card,
      }}
    >
      <SectionHeader icon={Icon.shield} label="モデレーション履歴" />

      {history.length === 0 ? (
        <Text style={[T.small, { color: C.text3 }]}>まだ履歴はありません。</Text>
      ) : (
        <View>
          {history.map((h, i) => (
            <TimelineRow
              key={h.id}
              log={h}
              isLast={i === history.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function TimelineRow({ log, isLast }: { log: ModerationLog; isLast: boolean }) {
  const meta = actionMeta(log.action);
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={{ flexDirection: 'row', gap: SP['3'] }}
    >
      {/* dot + line rail */}
      <View style={{ alignItems: 'center', width: 14 }}>
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: meta.color,
            borderWidth: 2,
            borderColor: C.bg2,
            marginTop: 2,
          }}
        />
        {!isLast && (
          <View
            style={{
              flex: 1,
              width: 2,
              backgroundColor: C.border,
              marginTop: 2,
              minHeight: 24,
            }}
          />
        )}
      </View>

      {/* content */}
      <View style={{ flex: 1, paddingBottom: isLast ? 0 : SP['3'], gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <Text style={[T.smallB, { color: meta.color }]}>{meta.label}</Text>
          <View style={{ flex: 1 }} />
          <Text style={[T.caption, { color: C.text4 }]}>
            {formatRelative(log.created_at)}
          </Text>
        </View>
        <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
          admin: {log.admin_id.slice(-12)}
        </Text>
        {log.reason ? (
          <Text style={[T.caption, { color: C.text2, lineHeight: 16 }]} numberOfLines={3}>
            {log.reason}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

// ============================================================
// Section header
// ============================================================
function SectionHeader({
  icon: I,
  label,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  accent?: string;
}) {
  const color = accent ?? C.text2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
      <I size={14} color={color} strokeWidth={2.4} />
      <Text style={[T.smallB, { color, letterSpacing: 0.4 }]}>{label}</Text>
    </View>
  );
}

// ============================================================
// Sticky bottom action bar
// ============================================================
function ActionBar({
  insetBottom,
  deleting,
  onDelete,
  onDM,
  onViewAuthor,
}: {
  insetBottom: number;
  deleting: boolean;
  onDelete: () => void;
  onDM: () => void;
  onViewAuthor: () => void;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: SP['4'],
        paddingTop: SP['3'],
        paddingBottom: Math.max(insetBottom, SP['3']),
        backgroundColor: C.bg + 'F2',
        borderTopWidth: 1,
        borderTopColor: C.border,
        flexDirection: 'row',
        gap: SP['2'],
        ...SHADOW.card,
      }}
    >
      <ActionBtn
        label={deleting ? '削除中…' : '投稿削除'}
        icon={Icon.trash}
        tone="danger"
        onPress={onDelete}
        disabled={deleting}
      />
      <ActionBtn
        label="作者にDM"
        icon={Icon.send}
        tone="accent"
        onPress={onDM}
      />
      <ActionBtn
        label="作者詳細"
        icon={Icon.mypage}
        tone="neutral"
        onPress={onViewAuthor}
      />
    </View>
  );
}

function ActionBtn({
  label,
  icon: I,
  tone,
  onPress,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  tone: 'danger' | 'accent' | 'neutral';
  onPress: () => void;
  disabled?: boolean;
}) {
  let bg: string;
  let fg: string;
  let border: string;
  let shadow = {};
  if (tone === 'danger') {
    bg = C.redBg;
    fg = C.red;
    border = C.red + '66';
  } else if (tone === 'accent') {
    bg = C.accent;
    fg = '#fff';
    border = C.accentDeep;
    shadow = SHADOW.accentGlow;
  } else {
    bg = C.bg3;
    fg = C.text;
    border = C.border;
  }
  return (
    <PressableScale
      onPress={onPress}
      haptic={tone === 'danger' ? 'warn' : tone === 'accent' ? 'confirm' : 'tap'}
      disabled={disabled}
      style={{
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: SP['3'],
        backgroundColor: bg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: border,
        opacity: disabled ? 0.6 : 1,
        ...shadow,
      }}
    >
      <I size={18} color={fg} strokeWidth={2.4} />
      <Text style={[T.caption, { color: fg, fontWeight: '700' }]}>{label}</Text>
    </PressableScale>
  );
}
