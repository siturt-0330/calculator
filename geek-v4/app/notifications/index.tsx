import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useNotifications } from '../../hooks/useNotifications';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { PolishedButton } from '../../components/ui/PolishedButton';
import { Icon } from '../../constants/icons';
import { C, GRAD, R, SHADOW, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { TABBAR } from '../../design/tabbar';
import { NotificationSkeleton } from '../../components/ui/Skeleton';
import { supabase } from '../../lib/supabase';
import { withApiTimeout } from '../../lib/withApiTimeout';
import type { Notification } from '../../types/models';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useAuthStore } from '../../stores/authStore';
import { stableKeyFor } from '../../lib/utils/queryKey';
import { squareThumbedUrl } from '../../lib/utils/imageUrl';
import {
  aggregateNotifications,
  type NotificationGroup,
} from '../../lib/notifications/aggregate';
import {
  fetchNotificationPostPreviews,
  fetchNotificationCommunityIcons,
  type NotificationPostPreview,
  type NotificationCommunityIcon,
} from '../../lib/api/notifications';
import { ActionSheetModal, type Action } from '../../components/ui/ActionSheet';
import { HeadingText } from '../../components/ui/HeadingText';
import { CommunityIcon } from '../../components/ui/CommunityIcon';
import { updateNotificationPreference } from '../../lib/api/notificationPreferences';
import { notificationCategoryFor } from '../../lib/utils/notificationFilter';
import { useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../../stores/toastStore';

// 通知を 4 つの時間バケットへグルーピング
type Bucket = '今日' | '昨日' | '1週間以内' | 'それ以前';

function bucketFor(dateStr: string): Bucket {
  const now = new Date();
  const d = new Date(dateStr);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const t = d.getTime();
  if (t >= startOfToday) return '今日';
  if (t >= startOfYesterday) return '昨日';
  if (t >= startOfWeek) return '1週間以内';
  return 'それ以前';
}

// ===== カテゴリ フィルタ =====
type NFilter = 'all' | 'reactions' | 'community' | 'other';
const FILTER_TABS: { key: NFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'reactions', label: '反応' },
  { key: 'community', label: 'コミュニティ' },
  { key: 'other', label: 'お知らせ' },
];
function matchesFilter(type: Notification['type'], f: NFilter): boolean {
  if (f === 'all') return true;
  if (f === 'reactions') {
    return type === 'like' || type === 'comment' || type === 'reply' || type === 'mention';
  }
  if (f === 'community') {
    return (
      type === 'official_post' ||
      type === 'join_request' ||
      type === 'event' ||
      type === 'announcement' ||
      type === 'mod_action' ||
      type === 'community_post'
    );
  }
  return type === 'follow' || type === 'system'; // other / お知らせ
}

// 行データ — section ヘッダーと集約済み通知グループを混在させる
type Row =
  | { kind: 'header'; bucket: Bucket; id: string }
  | { kind: 'item'; g: NotificationGroup; id: string };

// type → 視覚デザイン (icon / accent color / bg)
// like=pink, comment=blue, follow=accent purple, reply=teal/green,
// event=amber, official_post=accent gradient, default=grey
type NotifVisual = {
  icon: string;
  color: string;
  bgSoft: string;
  borderSoft: string;
};

function visualFor(type: Notification['type']): NotifVisual {
  switch (type) {
    case 'like':
      return { icon: '💛', color: C.pink, bgSoft: C.pinkBg, borderSoft: C.pink + '55' };
    case 'comment':
      return { icon: '💬', color: C.blue, bgSoft: C.blueBg, borderSoft: C.blue + '55' };
    case 'follow':
      return { icon: '👤', color: C.accentLight, bgSoft: C.accentBg, borderSoft: C.accent + '55' };
    case 'reply':
      return { icon: '↩', color: C.green, bgSoft: C.greenBg, borderSoft: C.green + '55' };
    case 'event':
      return { icon: '📅', color: C.amber, bgSoft: C.amberBg, borderSoft: C.amber + '55' };
    case 'official_post':
      return { icon: '📣', color: C.accent, bgSoft: C.accentBg, borderSoft: C.accent };
    case 'mod_action':
      // コミュニティ管理人の処置 (投稿削除 / キック / BAN) — amber の盾で警告系
      return { icon: '🛡️', color: C.amber, bgSoft: C.amberBg, borderSoft: C.amber + '55' };
    case 'community_post':
      // 参加コミュニティの新着投稿 (YouTube のチャンネル新着相当・0149)。
      // 行アイコンは発信源コミュニティのアイコンで置き換わる (これは fallback)
      return { icon: '📬', color: C.accentLight, bgSoft: C.accentBg, borderSoft: C.accent + '55' };
    default:
      return { icon: '🔔', color: C.text2, bgSoft: C.bg3, borderSoft: C.border };
  }
}

// 「…」メニューの「この種類の通知をオフ」用ラベル
const CATEGORY_LABELS: Record<string, string> = {
  like: 'いいね',
  comment: 'コメント',
  reply: '返信',
  mention: 'メンション',
  follow: 'フォロー',
  friend_request: '友達リクエスト',
  friend_accept: '友達承認',
  official_post: '公式投稿',
  event: 'イベント',
  mod_action: 'モデレーション',
  system: 'システム',
  community_post: 'コミュニティ新着',
};

// data.community_id を持つ type (発信源コミュニティアイコンを出す対象)
function communityIdOf(g: NotificationGroup): string | null {
  if (
    g.type !== 'community_post' &&
    g.type !== 'join_request' &&
    g.type !== 'mod_action'
  ) {
    return null;
  }
  const d = g.latest.data as { community_id?: unknown } | null;
  return d && typeof d.community_id === 'string' && d.community_id ? d.community_id : null;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const {
    notifications,
    loading: isLoading,
    markAllRead,
    markReadMany,
    deleteMany,
  } = useNotifications();
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  // markReadMany / deleteMany は useNotifications() が毎 render 再生成するため、
  // handleTap / handleMenu を安定参照 (useCallback) にできるよう ref 経由で
  // 最新版を参照する。これにより memo 化した各 NotificationRow に渡す
  // onPress の identity が固定され、通知 cache 更新ごとの全行 re-render を防ぐ。
  const markReadManyRef = useRef(markReadMany);
  markReadManyRef.current = markReadMany;
  const deleteManyRef = useRef(deleteMany);
  deleteManyRef.current = deleteMany;
  // 行ごとの「…」メニュー (YouTube 流) — 開いている対象グループ
  const [menuGroup, setMenuGroup] = useState<NotificationGroup | null>(null);
  const openMenu = useCallback((g: NotificationGroup) => setMenuGroup(g), []);
  const closeMenu = useCallback(() => setMenuGroup(null), []);
  const [filter, setFilter] = useState<NFilter>('all');
  // Smart skeleton timing — skeleton only after 200ms of continuous loading.
  // <200ms loads (cache hits) skip skeleton entirely to avoid flash.
  const showSkeleton = useDelayedLoading(isLoading && notifications.length === 0, 200);

  // ★ 自動既読 (X/IG 流・2026-06-12 ユーザー指示): 画面を開いたら全件を自動で
  //   既読化する (「すべて既読」ボタンは廃止)。バッジは開いた瞬間に消えるが、
  //   「何が新着だったか」は visitUnreadIds スナップショットでこの訪問中は
  //   ハイライト表示を維持する (旧懸念「未読ハイライトが一瞬で消える」の対策)。
  const autoReadDoneRef = useRef(false);
  const [visitUnreadIds, setVisitUnreadIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  useEffect(() => {
    if (autoReadDoneRef.current) return;
    if (isLoading) return; // 初回ロード完了を待つ
    autoReadDoneRef.current = true;
    const unread = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unread.length > 0) {
      setVisitUnreadIds(new Set(unread));
      void markAllRead().catch(() => {});
    }
  }, [isLoading, notifications, markAllRead]);

  // ★ IG/X 流の集約 (2026-06-12): 同じ投稿への同種反応 (like/comment/reply) を
  //   1 行にまとめる。集約はフィルタ前に行い、フィルタはグループ type で判定。
  const groups = useMemo(() => aggregateNotifications(notifications), [notifications]);
  const filteredGroups = useMemo(
    () => groups.filter((g) => matchesFilter(g.type, filter)),
    [groups, filter],
  );

  // ★ 投稿プレビュー (IG/X 流: どの投稿への反応か一目で分かる) —
  //   表示中グループの post_id を 1 query (IN) でまとめて取得。
  const previewPostIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) if (g.postId) ids.add(g.postId);
    return Array.from(ids).sort();
  }, [groups]);
  const { data: previews } = useQuery({
    queryKey: ['notification-post-previews', userId ?? null, stableKeyFor(previewPostIds)],
    queryFn: () => fetchNotificationPostPreviews(previewPostIds),
    enabled: previewPostIds.length > 0,
    staleTime: 60_000,
  });
  const previewById = useMemo(() => {
    const m = new Map<string, NotificationPostPreview>();
    for (const p of previews ?? []) m.set(p.id, p);
    return m;
  }, [previews]);

  // ★ 発信源コミュニティのアイコン (YouTube のチャンネルアイコン相当・2026-06-12) —
  //   community_post / join_request / mod_action の data.community_id をまとめて取得。
  const communityIconIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) {
      const cid = communityIdOf(g);
      if (cid) ids.add(cid);
    }
    return Array.from(ids).sort();
  }, [groups]);
  const { data: communityIcons } = useQuery({
    queryKey: [
      'notification-community-icons',
      userId ?? null,
      stableKeyFor(communityIconIds),
    ],
    queryFn: () => fetchNotificationCommunityIcons(communityIconIds),
    enabled: communityIconIds.length > 0,
    staleTime: 5 * 60_000,
  });
  const communityIconById = useMemo(() => {
    const m = new Map<string, NotificationCommunityIcon>();
    for (const c of communityIcons ?? []) m.set(c.id, c);
    return m;
  }, [communityIcons]);

  // 「…」メニューの選択肢 (YouTube 流: 削除 / この種類をオフ / 設定)
  const menuActions = useMemo<Action[]>(() => {
    if (!menuGroup) return [];
    const g = menuGroup;
    const category = notificationCategoryFor(g.type);
    const label = CATEGORY_LABELS[category] ?? 'この種類';
    return [
      {
        label: g.count > 1 ? `この通知を削除 (${g.count} 件)` : 'この通知を削除',
        icon: Icon.trash,
        destructive: true,
        onPress: () => {
          void deleteManyRef.current(g.items.map((n) => n.id));
        },
      },
      {
        label: `「${label}」の通知をオフ`,
        icon: Icon.bell,
        onPress: () => {
          void updateNotificationPreference(category, { inapp: false })
            .then(() => {
              qc.invalidateQueries({ queryKey: ['notification-preferences'] });
              showToast(`「${label}」の通知をオフにしました (設定からいつでも戻せます)`, 'info');
            })
            .catch(() => {
              showToast('設定の変更に失敗しました', 'error');
            });
        },
      },
      {
        label: '通知設定を開く',
        icon: Icon.settings,
        onPress: () => router.push('/settings/notifications' as never),
      },
    ];
  }, [menuGroup, qc, router, showToast]);

  // 通知グループ → セクション化された Row 配列
  const rows = useMemo<Row[]>(() => {
    const order: Bucket[] = ['今日', '昨日', '1週間以内', 'それ以前'];
    const byBucket: Record<Bucket, NotificationGroup[]> = {
      '今日': [], '昨日': [], '1週間以内': [], 'それ以前': [],
    };
    for (const g of filteredGroups) byBucket[bucketFor(g.createdAt)].push(g);
    const out: Row[] = [];
    for (const b of order) {
      if (byBucket[b].length === 0) continue;
      out.push({ kind: 'header', bucket: b, id: `h:${b}` });
      for (const g of byBucket[b]) out.push({ kind: 'item', g, id: g.id });
    }
    return out;
  }, [filteredGroups]);

  // 通知タップ時 — 関連 surface (タグ feed など) へ遷移する。
  // notifications table に source_id が無いケースが多いので tag_name を最優先で利用。
  // 'official_post' だけは tag_name が「コミュニティ名」なので name→id を runtime ルックアップ。
  // memo 化した行に渡すため安定参照 (useCallback)。早期 return より前に定義する
  // (Rules of Hooks)。
  const handleTap = useCallback((g: NotificationGroup) => {
    void markReadManyRef.current(g.unreadIds); // グループ内の未読を一括既読化
    const n = g.latest; // 遷移先はグループの代表 (最新) 通知で解決
    if (n.type === 'official_post' && n.tag_name) {
      // 旧版は communities lookup (name→id) の RTT を await してから push して
      // いたため、タップ後に画面が止まって見えた。即座に公式コミュ一覧 (corners)
      // へ遷移し、name→id の解決はバックグラウンドで行う。解決できたら該当
      // コミュニティを drill-down で開く (corners→community は自然な掘り下げ)。
      // tag_name は closure 内で narrowing が外れるため const に退避してから渡す。
      const communityName = n.tag_name;
      router.push('/(tabs)/corners' as never);
      void (async () => {
        try {
          const { data } = await withApiTimeout(
            supabase
              .from('communities')
              .select('id')
              .eq('name', communityName)
              .eq('is_official', true)
              .limit(1)
              .maybeSingle(),
            'notifications.officialLookup',
            4000,
          );
          if (data?.id) router.push(`/community/${data.id}` as never);
        } catch {
          // 解決失敗時は corners 一覧のままにする (フォールバック済み)。
        }
      })();
      return;
    }
    // 参加申請通知 (migration 0101) — data.community_id を読んで admin 画面へ
    if (n.type === 'join_request') {
      const data = n.data as { community_id?: unknown } | null;
      const cid = data && typeof data.community_id === 'string' ? data.community_id : null;
      if (cid) {
        router.push(`/community/${cid}/admin` as never);
        return;
      }
      router.push('/(tabs)/community' as never);
      return;
    }
    // モデレーション処置通知 (migration 0136) — data.community_id を読んでコミュニティへ。
    // 投稿削除の場合 post は既に消えているのでコミュニティ home に飛ばす。
    if (n.type === 'mod_action') {
      const data = n.data as { community_id?: unknown } | null;
      const cid = data && typeof data.community_id === 'string' ? data.community_id : null;
      if (cid) {
        router.push(`/community/${cid}` as never);
        return;
      }
      router.push('/(tabs)/feed' as never);
      return;
    }
    // 投稿への反応 (いいね/コメント/リアクション/返信) — data.post_id があれば
    // 該当投稿を直接開く。0008/0111 トリガが post_id を data に格納済み。
    // コメント/返信は data.comment_id も持つので ?commentId= で該当コメントへ
    // ジャンプ&ハイライトする (post/[id].tsx 側で処理・2026-06-12)。
    const withPost = (n.data ?? null) as {
      post_id?: unknown;
      comment_id?: unknown;
    } | null;
    if (withPost && typeof withPost.post_id === 'string' && withPost.post_id.length > 0) {
      const cid =
        typeof withPost.comment_id === 'string' && withPost.comment_id.length > 0
          ? withPost.comment_id
          : null;
      router.push(
        (cid
          ? `/post/${withPost.post_id}?commentId=${encodeURIComponent(cid)}`
          : `/post/${withPost.post_id}`) as never,
      );
      return;
    }
    if (n.tag_name) {
      router.push(`/tag/${encodeURIComponent(n.tag_name)}` as never);
    } else if (n.type === 'follow') {
      router.push('/(tabs)/mypage' as never);
    } else {
      router.push('/(tabs)/feed' as never);
    }
  }, [router]);

  if (isLoading && notifications.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="通知" left={<BackButton />} />
        {showSkeleton && (
          <View>
            {Array.from({ length: 6 }).map((_, i) => (
              <NotificationSkeleton key={`skel-notif-${i}`} />
            ))}
          </View>
        )}
      </View>
    );
  }

  if (!isLoading && notifications.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar title="通知" left={<BackButton />} />
        <ScrollView contentContainerStyle={{ padding: SP['4'], gap: SP['4'] }}>
          {/* ヒーロー — gradient 96x96 circle + glow */}
          <View style={{ alignItems: 'center', paddingTop: SP['8'], paddingBottom: SP['4'], gap: SP['3'] }}>
            <View style={[
              { borderRadius: 48 },
              SHADOW.glow,
            ]}>
              <LinearGradient
                colors={GRAD.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 96, height: 96, borderRadius: 48,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon.bell size={44} color="#fff" strokeWidth={2.2} />
              </LinearGradient>
            </View>
            {/* 画面コンテンツの見出し — HeadingText で VoiceOver の見出しナビ対象に
                (style は従来と同一のものを渡すので見た目は不変) */}
            <HeadingText level={2} style={[T.h2, { color: C.text, textAlign: 'center' }]}>
              まだ通知がありません
            </HeadingText>
            <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 320 }]}>
              好きなタグの新着、自分の投稿への反応がここに届きます
            </Text>
          </View>

          {/* CTA — feed を見に行く / 通知設定 */}
          <View style={{ gap: SP['2'], paddingHorizontal: SP['2'] }}>
            <PolishedButton
              variant="gradient"
              gradient="primary"
              label="フィードを見に行く"
              icon={<Icon.home size={18} color="#fff" strokeWidth={2.2} />}
              onPress={() => router.push('/(tabs)/feed' as never)}
              fullWidth
              haptic="confirm"
            />
            <PressableScale
              onPress={() => router.push('/settings/notifications' as never)}
              haptic="tap"
              hitSlop={10}
              style={{
                padding: SP['4'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                flexDirection: 'row', alignItems: 'center', gap: SP['3'],
              }}
            >
              <Icon.settings size={20} color={C.text2} strokeWidth={2.2} />
              <Text style={[T.bodyM, { color: C.text, flex: 1 }]}>通知設定</Text>
              <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
            </PressableScale>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* 「すべて既読」ボタンは廃止 — 画面を開いた時点で自動既読化される
          (上の autoRead effect)。 */}
      <TopBar title="通知" left={<BackButton />} />
      {/* カテゴリ フィルタ (横スクロール pill) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{
          gap: SP['2'],
          paddingHorizontal: SP['3'],
          paddingTop: SP['2'],
          paddingBottom: SP['1'],
        }}
      >
        {FILTER_TABS.map((tab) => {
          const active = filter === tab.key;
          return (
            <PressableScale
              key={tab.key}
              onPress={() => setFilter(tab.key)}
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={`${tab.label}で絞り込む`}
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                borderRadius: R.full,
                backgroundColor: active ? C.accent : C.bg2,
                borderWidth: 1,
                borderColor: active ? C.accent : C.border,
              }}
            >
              <Text style={[T.caption, { color: active ? '#fff' : C.text2, fontWeight: '700' }]}>
                {tab.label}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
      {/* react-native-web では FlashList の高さが解決されず行が描画されないため
          ScrollView + map で確実にレンダリングする (通知は最大 50 件取得なので
          仮想化不要)。 */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: SP['2'],
          paddingHorizontal: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
      >
        {rows.length === 0 ? (
          <View style={{ paddingTop: SP['10'], alignItems: 'center', gap: SP['2'] }}>
            <Icon.bell size={28} color={C.text3} strokeWidth={1.8} />
            <Text style={[T.small, { color: C.text3 }]}>このカテゴリの通知はありません</Text>
          </View>
        ) : (
          rows.map((item) =>
            item.kind === 'header' ? (
              <View
                key={item.id}
                style={{
                  paddingTop: SP['4'],
                  paddingBottom: SP['2'],
                  paddingHorizontal: SP['2'],
                  backgroundColor: C.bg,
                }}
              >
                <Text style={[T.smallB, { color: C.text3, letterSpacing: 1.2, fontWeight: '700' }]}>
                  {item.bucket.toUpperCase()}
                </Text>
              </View>
            ) : (
              <NotificationRow
                key={item.id}
                g={item.g}
                // 未読ハイライト: 実 read 状態 OR この訪問で新着だったもの
                // (自動既読後もこの訪問中はハイライトを維持する)
                highlightUnread={
                  item.g.unread ||
                  item.g.items.some((nn) => visitUnreadIds.has(nn.id))
                }
                preview={item.g.postId ? previewById.get(item.g.postId) : undefined}
                communityIcon={(() => {
                  const cid = communityIdOf(item.g);
                  return cid ? communityIconById.get(cid) : undefined;
                })()}
                onPress={handleTap}
                onMenu={openMenu}
              />
            ),
          )
        )}
      </ScrollView>

      {/* 行ごとの「…」メニュー (YouTube 流: 削除 / この種類をオフ / 設定) */}
      <ActionSheetModal
        visible={menuGroup !== null}
        title="通知のオプション"
        actions={menuActions}
        onClose={closeMenu}
      />
    </View>
  );
}

// ============================================================
// NotificationRow — glass-card 風の通知行
// ------------------------------------------------------------
// - 未読: accent subtle bg + accent ドット (pulse) + bold text + soft glow
// - 既読: bg2 + 普通 text + 透明感少なめ (250ms で smooth transition)
// - type ごとに icon の色 (like=pink / comment=blue / system=grey 等)
// - 公式投稿は左に accent bar + gradient icon
// - mount 時の entrance: opacity 0→1 + translateX -8→0 (220ms ease-out)
// - reduceMotion 時は即時表示 (pulse / entrance とも skip)
// ============================================================
const NotificationRow = memo(function NotificationRow({
  g,
  highlightUnread,
  preview,
  communityIcon,
  onPress,
  onMenu,
}: {
  g: NotificationGroup;
  // 未読ハイライト — 実 read 状態だけでなく「この訪問で新着だったもの」も
  // 含む (自動既読化の後も訪問中はハイライトを維持するため)。
  highlightUnread: boolean;
  // 対象投稿のプレビュー (本文先頭 + サムネ)。取得前/削除済みは undefined。
  preview?: NotificationPostPreview;
  // 発信源コミュニティ (YouTube のチャンネルアイコン相当)。該当 type のみ。
  communityIcon?: NotificationCommunityIcon;
  // 安定参照の handleTap を直接受け取り、行内で g を渡して呼ぶ。これにより
  // 親が毎 render でインライン関数を生成せず、memo が効く。
  onPress: (g: NotificationGroup) => void;
  // 行の「…」メニューを開く (YouTube 流)。
  onMenu: (g: NotificationGroup) => void;
}) {
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const n = g.latest;
  const visual = visualFor(n.type);
  const isOfficial = n.type === 'official_post';
  const unread = highlightUnread;

  // ============================================================
  // Entrance animation — mount 時のみ実行。
  // FlashList の recycler が同じ component instance を別行に流用しても、
  // 「最初の 1 回だけ」になるよう ref で gate する。
  // ============================================================
  const enterOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const enterTx = useSharedValue(reduceMotion ? 0 : -8);
  const didEnterRef = useRef(false);
  useEffect(() => {
    if (didEnterRef.current) return;
    didEnterRef.current = true;
    if (reduceMotion) {
      enterOpacity.value = 1;
      enterTx.value = 0;
      return;
    }
    enterOpacity.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    enterTx.value = withTiming(0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [reduceMotion, enterOpacity, enterTx]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterOpacity.value,
    transform: [{ translateX: enterTx.value }],
  }));

  // ============================================================
  // Read-state crossfade — 既読化された瞬間に bg を 250ms で遷移、
  // dot は 250ms で fade out。reduceMotion 時は即時切替。
  // ============================================================
  const readProgress = useSharedValue(unread ? 0 : 1);
  const dotPulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      readProgress.value = unread ? 0 : 1;
      return;
    }
    readProgress.value = withTiming(unread ? 0 : 1, {
      duration: 250,
      easing: Easing.out(Easing.quad),
    });
  }, [unread, reduceMotion, readProgress]);

  // 未読ドットの pulse animation — 1 → 1.15 → 1 を 1600ms loop
  useEffect(() => {
    if (reduceMotion) {
      dotPulse.value = 1;
      return;
    }
    if (unread) {
      dotPulse.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    } else {
      dotPulse.value = withTiming(1, { duration: 200 });
    }
  }, [unread, reduceMotion, dotPulse]);

  // bg / border は read 状態によって異なる。Animated で表現するため、
  // 2 層 (unread layer + read layer) を重ねて opacity で crossfade する。
  const unreadLayerStyle = useAnimatedStyle(() => ({
    opacity: 1 - readProgress.value,
  }));
  const readLayerStyle = useAnimatedStyle(() => ({
    opacity: readProgress.value,
  }));
  const dotStyle = useAnimatedStyle(() => ({
    // dot は未読中だけ可視 (= readProgress 0)。read に切り替わると fade out。
    opacity: 1 - readProgress.value,
    transform: [{ scale: dotPulse.value }],
  }));

  return (
    <Animated.View style={enterStyle}>
      <PressableScale
        onPress={() => onPress(g)}
        haptic="tap"
        scaleValue={0.97}
        accessibilityRole="button"
        accessibilityLabel={g.message}
        accessibilityState={{ selected: unread }}
        style={[
          {
            marginVertical: 4,
            paddingVertical: SP['3'],
            paddingHorizontal: SP['3'],
            backgroundColor: C.bg2,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: SP['3'],
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            // 公式投稿は左に強いアクセントバーを出して可視性を上げる
            borderLeftWidth: isOfficial ? 3 : 1,
            borderLeftColor: isOfficial ? C.accent : C.border,
            overflow: 'hidden',
            position: 'relative',
          },
          // Web では subtle hover effect (transition は PressableScale 側が担保)
          Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null,
        ]}
      >
        {/* 未読 overlay layer — accent bg + accent border を fade で重ねる */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: C.accentBg,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.accent + '40',
              borderLeftWidth: isOfficial ? 3 : 1,
              borderLeftColor: isOfficial ? C.accent : C.accent + '40',
            },
            unreadLayerStyle,
          ]}
        />
        {/* read 状態用の subtle border を維持するための placeholder
            (実際の bg は親 View が担っているので opacity 制御だけで十分) */}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
            readLayerStyle,
          ]}
        />

        {/* 発信源 icon — コミュニティ通知は実コミュアイコン (YouTube の
            チャンネルアイコン相当)、公式は gradient、他は type 絵文字。
            集約行 (count>1) は右下に件数バッジ (IG のスタックアバター相当) */}
        <View>
          {communityIcon ? (
            <View
              style={{
                width: 40, height: 40, borderRadius: 10,
                backgroundColor: C.bg3,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: C.border,
                overflow: 'hidden',
              }}
            >
              <CommunityIcon
                size={32}
                iconUrl={communityIcon.icon_url}
                iconEmoji={communityIcon.icon_emoji ?? '👥'}
                name={communityIcon.name}
              />
            </View>
          ) : isOfficial ? (
            <View style={[{ borderRadius: 10 }, SHADOW.sm]}>
              <LinearGradient
                colors={GRAD.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 40, height: 40, borderRadius: 10,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 18 }}>{visual.icon}</Text>
              </LinearGradient>
            </View>
          ) : (
            <View style={{
              width: 40, height: 40, borderRadius: 10,
              backgroundColor: C.bg3,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: C.border,
            }}>
              <Text style={{ fontSize: 18 }}>{visual.icon}</Text>
            </View>
          )}
          {g.count > 1 && (
            <View
              style={{
                position: 'absolute',
                right: -6,
                bottom: -6,
                minWidth: 20,
                height: 20,
                borderRadius: 10,
                paddingHorizontal: 5,
                backgroundColor: visual.color,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: C.bg2,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 14 }}>
                {g.count > 99 ? '99+' : g.count}
              </Text>
            </View>
          )}
        </View>

        {/* メッセージ + 投稿プレビュー + タグ */}
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={[
              T.body,
              {
                color: C.text,
                lineHeight: 20,
                fontWeight: unread ? '700' : '500',
              },
            ]}
          >
            {g.message}
          </Text>
          {/* 対象投稿の本文プレビュー (IG/X 流: どの投稿か一目で分かる) */}
          {preview?.content ? (
            <Text numberOfLines={1} style={[T.small, { color: C.text3 }]}>
              {preview.content}
            </Text>
          ) : null}
          {n.tag_name && (
            <Text
              style={[
                T.small,
                {
                  color: visual.color,
                  fontWeight: '600',
                },
              ]}
            >
              {isOfficial ? n.tag_name : `#${n.tag_name}`}
            </Text>
          )}
        </View>

        {/* 対象投稿のサムネ (メディアがある投稿のみ) — IG の右端サムネと同型 */}
        {preview?.thumb ? (
          <ExpoImage
            source={{ uri: squareThumbedUrl(preview.thumb, 96) }}
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              backgroundColor: C.bg3,
              borderWidth: 1,
              borderColor: C.border,
            }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={preview.thumb}
          />
        ) : null}

        {/* 右側カラム: ドット + 時刻 + 「…」メニュー (YouTube 流) */}
        <View style={{ alignItems: 'flex-end', gap: 4, minWidth: 48 }}>
          <Animated.View
            style={[
              {
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: C.accent,
              },
              dotStyle,
            ]}
          />
          <Text style={[T.caption, { color: C.text3, textAlign: 'right' }]}>
            {formatRelative(g.createdAt)}
          </Text>
          <PressableScale
            onPress={() => onMenu(g)}
            haptic="tap"
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="通知のオプション"
            style={{ paddingVertical: 2, paddingHorizontal: 4 }}
          >
            <Icon.more size={16} color={C.text3} strokeWidth={2.2} />
          </PressableScale>
        </View>
      </PressableScale>
    </Animated.View>
  );
});
