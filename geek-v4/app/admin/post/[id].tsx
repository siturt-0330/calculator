import { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react-native';
import { TopBar } from '../../../components/nav/TopBar';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Avatar } from '../../../components/ui/Avatar';
import { Spinner } from '../../../components/ui/Spinner';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon } from '../../../constants/icons';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { useToastStore } from '../../../stores/toastStore';
import { formatRelative } from '../../../lib/utils/date';
import {
  fetchPostDetail,
  deletePost,
  type ModerationLog,
} from '../../../lib/api/admin';

// ============================================================
// 投稿詳細 (admin) — /admin/post/[id]
// ============================================================
// admin/index.tsx の投稿一覧から遷移してくる詳細ビュー。
//  - 投稿本文 + メタ
//  - 通報者一覧 (誰が何時に flag したか)
//  - モデレーション履歴 (削除 / DM 送信などの監査ログ)
//  - アクション 3 つ (削除 / 作者に DM / 作者詳細)
// ============================================================

const VISIBILITY_META: Record<string, { label: string; color: string }> = {
  public:           { label: '公開',         color: C.green },
  community_public: { label: 'コミュ+公開', color: C.blue },
  community_only:   { label: 'コミュ限定',   color: C.accent },
  private:          { label: '非公開',       color: C.text3 },
};

// moderation_log.action → 日本語ラベル。
// 仕様上想定外の値が来ても落ちないよう、未知の action はそのまま見せる。
const ACTION_LABEL: Record<string, string> = {
  suspend_user:        'ユーザー凍結',
  unsuspend_user:      'ユーザー解除',
  delete_post:         '投稿削除',
  delete_thread:       'スレッド削除',
  delete_comment:      'コメント削除',
  send_message:        'DM 送信',
  reset_account_state: 'アカウント状態リセット',
  note:                'メモ',
};

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
      // admin パネル全体の post 系キャッシュを更新
      void qc.invalidateQueries({ queryKey: ['admin-posts'] });
      void qc.invalidateQueries({ queryKey: ['admin-reported-posts'] });
      void qc.invalidateQueries({ queryKey: ['admin-post-detail', id] });
      router.back();
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="投稿詳細" left={<BackButton />} />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </View>
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
        <ScrollView
          contentContainerStyle={{
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['10'],
            gap: SP['4'],
          }}
        >
          <PostBlock post={data.post} />
          <Divider />
          <ReportersBlock reporters={data.reporters} />
          <Divider />
          <ModerationHistoryBlock history={data.moderationHistory} />
          <Divider />
          <ActionsBlock
            authorId={data.post.author_id}
            onDelete={() => setDeleteOpen(true)}
            deleting={remove.isPending}
            onDM={() => router.push(`/admin/message/${data.post.author_id}` as never)}
            onViewAuthor={() => router.push(`/admin/user/${data.post.author_id}` as never)}
          />
        </ScrollView>
      )}

      <ConfirmDialog
        visible={deleteOpen}
        title="投稿を削除"
        message={
          data
            ? `この投稿を削除します。本人にも他の閲覧者にも表示されなくなります。${
                data.post.concern_count > 0 ? `\n\n通報: ${data.post.concern_count} 件` : ''
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
// 投稿ブロック — author 行 + badges + 本文
// ============================================================
function PostBlock({
  post,
}: {
  post: {
    id: string;
    author_id: string;
    author_nickname: string | null;
    content: string;
    visibility: string;
    likes_count: number;
    concern_count: number;
    created_at: string;
  };
}) {
  const vMeta = VISIBILITY_META[post.visibility] ?? { label: post.visibility, color: C.text3 };
  return (
    <View style={{ gap: SP['3'] }}>
      {/* author 行 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
        <Avatar size={40} name={post.author_nickname ?? undefined} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
            {post.author_nickname ?? '(unknown)'}
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            {formatRelative(post.created_at)}
          </Text>
        </View>
      </View>

      {/* badges 行 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
        <Badge label={vMeta.label} color={vMeta.color} />
        <Stat label="♥" value={post.likes_count} />
        <Stat
          label="通報"
          value={post.concern_count}
          accent={post.concern_count > 0 ? C.red : undefined}
        />
      </View>

      {/* 本文 */}
      <View
        style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Text style={[T.body, { color: C.text, lineHeight: 24 }]}>
          {post.content || '(本文なし)'}
        </Text>
      </View>

      {/* post id (mono, 末尾に小さく) */}
      <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
        {post.id}
      </Text>
    </View>
  );
}

// ============================================================
// 通報者一覧
// ============================================================
function ReportersBlock({
  reporters,
}: {
  reporters: Array<{ user_id: string; nickname: string | null; created_at: string }>;
}) {
  return (
    <View style={{ gap: SP['2'] }}>
      <SectionLabel
        label={`通報した人 (${reporters.length})`}
        accent={reporters.length > 0 ? C.red : undefined}
      />
      {reporters.length === 0 ? (
        <Text style={[T.small, { color: C.text3, paddingHorizontal: SP['1'] }]}>
          通報はまだありません。
        </Text>
      ) : (
        <View
          style={{
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            overflow: 'hidden',
          }}
        >
          {reporters.map((r, i) => (
            <View key={`${r.user_id}-${i}`}>
              {i > 0 && <View style={{ height: 1, backgroundColor: C.divider }} />}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['3'],
                  gap: SP['3'],
                }}
              >
                <Avatar size={28} name={r.nickname ?? undefined} />
                <Text style={[T.body, { color: C.text, flex: 1 }]} numberOfLines={1}>
                  {r.nickname ?? '(unknown)'}
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>
                  {formatRelative(r.created_at)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ============================================================
// モデレーション履歴
// ============================================================
function ModerationHistoryBlock({ history }: { history: ModerationLog[] }) {
  // 同じ admin から短時間に複数 entry が来てもいいよう、key には id を使う。
  // admin_id → 表示名 を解決する API はまだ無いので、admin_id の末尾 6 桁を mono で出す。
  return (
    <View style={{ gap: SP['2'] }}>
      <SectionLabel label="モデレーション履歴" />
      {history.length === 0 ? (
        <Text style={[T.small, { color: C.text3, paddingHorizontal: SP['1'] }]}>
          まだ履歴はありません。
        </Text>
      ) : (
        <View
          style={{
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            overflow: 'hidden',
          }}
        >
          {history.map((h, i) => (
            <View key={h.id}>
              {i > 0 && <View style={{ height: 1, backgroundColor: C.divider }} />}
              <View
                style={{
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['3'],
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                  <Text style={[T.smallB, { color: C.text }]}>
                    {ACTION_LABEL[h.action] ?? h.action}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Text style={[T.caption, { color: C.text3 }]}>
                    {formatRelative(h.created_at)}
                  </Text>
                </View>
                <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
                  admin: {h.admin_id.slice(-12)}
                </Text>
                {h.reason ? (
                  <Text style={[T.caption, { color: C.text2 }]} numberOfLines={3}>
                    理由: {h.reason}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ============================================================
// アクション
// ============================================================
function ActionsBlock({
  authorId,
  onDelete,
  deleting,
  onDM,
  onViewAuthor,
}: {
  authorId: string;
  onDelete: () => void;
  deleting: boolean;
  onDM: () => void;
  onViewAuthor: () => void;
}) {
  return (
    <View style={{ gap: SP['2'] }}>
      <SectionLabel label="アクション" />
      <View style={{ gap: SP['2'] }}>
        <ActionRow
          label={deleting ? '削除中…' : '投稿を削除'}
          tone="danger"
          icon={Icon.trash}
          onPress={onDelete}
          disabled={deleting}
        />
        <ActionRow label="作者に DM する" icon={Icon.send} onPress={onDM} />
        <ActionRow
          label="作者の詳細を見る"
          icon={Icon.mypage}
          onPress={onViewAuthor}
          subtitle={authorId}
        />
      </View>
    </View>
  );
}

function ActionRow({
  label,
  subtitle,
  icon: I,
  tone,
  onPress,
  disabled,
}: {
  label: string;
  subtitle?: string;
  icon: LucideIcon;
  tone?: 'danger';
  onPress: () => void;
  disabled?: boolean;
}) {
  const ChevronR = Icon.chevronR;
  const isDanger = tone === 'danger';
  const fg = isDanger ? C.red : C.text;
  const bg = isDanger ? C.redBg : C.bg2;
  const border = isDanger ? C.red + '55' : C.border;
  return (
    <PressableScale
      onPress={onPress}
      haptic={isDanger ? 'warn' : 'tap'}
      disabled={disabled}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SP['4'],
        paddingVertical: SP['3'],
        backgroundColor: bg,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: border,
        gap: SP['3'],
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <I size={18} color={fg} strokeWidth={2.2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.bodyB, { color: fg }]}>{label}</Text>
        {subtitle ? (
          <Text style={[T.mono, { color: C.text4, fontSize: 10 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {!isDanger && <ChevronR size={16} color={C.text4} strokeWidth={2.2} />}
    </PressableScale>
  );
}

// ============================================================
// 小物
// ============================================================
function Divider() {
  return <View style={{ height: 1, backgroundColor: C.divider, marginVertical: SP['1'] }} />;
}

function SectionLabel({ label, accent }: { label: string; accent?: string }) {
  return (
    <Text
      style={[
        T.smallB,
        {
          color: accent ?? C.text3,
          paddingHorizontal: SP['1'],
          letterSpacing: 0.6,
          fontSize: 11,
        },
      ]}
    >
      {label.toUpperCase()}
    </Text>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        paddingHorizontal: SP['2'],
        paddingVertical: 2,
        backgroundColor: color + '22',
        borderRadius: R.sm,
        borderWidth: 1,
        borderColor: color + '55',
      }}
    >
      <Text style={{ fontSize: 10, color, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  // useMemo は不要 — 単純表示。ただし toLocaleString を毎回呼ぶよりは軽量に。
  const formatted = useMemo(() => value.toLocaleString('ja-JP'), [value]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.smallB, { color: accent ?? C.text, fontWeight: '700' }]}>{formatted}</Text>
    </View>
  );
}
