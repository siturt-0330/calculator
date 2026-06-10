// =============================================================================
// app/(tabs)/mypage.tsx — マイページ「Atelier 改」(エディトリアル誌面)
// -----------------------------------------------------------------------------
// 単一 FlashList(誌面マストヘッド + 3 タブ章インデックスを ListHeaderComponent、
// 各タブの items を data に流す)で「投稿 / コメント / 保存済み」を組む。
// スクロールは scrollY:SharedValue 1 本を全層が購読(parallax カバー → 上端
// ガラスミニバーへ「誌名受け渡し」/ 擬似 sticky タブ複製)。
//
// 構成:
//   ListHeaderComponent = ProfileMastheadV2(scrollY) + ProfileTabsBar(実体A)
//   data(activeTab で組替):
//     [ SectionPillar, (saved のみ Lock notice), ...行カード ]
//     items 0 件なら [ SectionPillar(0), EmptyState ]
//     ロード中は本文領域に MyEntryRowSkeleton を ListHeader 末尾で重ねる(data 非流入)
//   絶対配置オーバーレイ = MypageStickyBar + 擬似 sticky タブ複製(B)
//
// 公開範囲: 投稿/コメントは他人も見られる(公開された姿) / 保存は自分だけ(RLS + Lock notice)。
// =============================================================================

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  Platform,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useScrollToTop } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { supabase } from '../../lib/supabase';
import { getBool, setBool } from '../../lib/storage';
import { fetchMyComments, type MyCommentRow, deleteComment } from '../../lib/api/comments';
import { deleteOwnPost, fetchCommunitiesForPosts, type PostCommunityRef } from '../../lib/api/posts';
import { isVapidConfigured } from '../../lib/api/push';
import { withApiTimeout } from '../../lib/withApiTimeout';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { formatRelative } from '../../lib/utils/date';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import { Icon } from '../../constants/icons';
import { GeekRefreshControl } from '../../components/ui/GeekRefreshControl';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProfileMastheadV2, HERO_H } from '../../components/mypage/ProfileMastheadV2';
import { MypageStickyBar } from '../../components/mypage/MypageStickyBar';
import { ProfileTabsBar, type ProfileTabKey } from '../../components/mypage/ProfileTabsBar';
import { ImageLightbox } from '../../components/ui/ImageLightbox';
import {
  MyEntryRow,
  MetaNum,
  MetaHeartIcon,
  MetaCommentIcon,
  MyEntryIcons,
  type MyMediaItem,
} from '../../components/mypage/MyEntryRow';
import { MyEntryRowSkeleton } from '../../components/mypage/MyEntryRowSkeleton';
import { ActionSheet } from '../../components/ui/ActionSheet';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';
import { CommunityIcon } from '../../components/ui/CommunityIcon';

// -----------------------------------------------------------------------------
// 定数
// -----------------------------------------------------------------------------
/** MypageStickyBar の実高(insets.top + この値 = sticky タブの top 位置) */
const STICKY_BAR_H = 52;
/** 擬似 sticky タブ複製のフェードイン開始オフセット(ヒーロー末から何px手前で始まるか) */
const STICKY_FADE_OFFSET = 40;

// -----------------------------------------------------------------------------
// データ型 + 取得(旧 UserPostsList / SavedPostsList の fetch を本画面に集約)
// -----------------------------------------------------------------------------
type MypageStats = {
  nickname: string | null;
  avatar_emoji: string | null;
  avatar_url: string | null;
  cover_url: string | null;
};

type UserPost = {
  id: string;
  content: string;
  title: string | null;
  media_urls: string[] | null;
  media_blurhashes: string[] | null;
  video_urls: string[] | null;
  video_posters: string[] | null;
  likes_count: number;
  comments_count: number;
  is_public: boolean;
  created_at: string;
};

type SavedPost = {
  id: string;
  content: string;
  title: string | null;
  media_urls: string[] | null;
  media_blurhashes: string[] | null;
  video_urls: string[] | null;
  video_posters: string[] | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
};

async function fetchProfileStats(userId: string): Promise<MypageStats | null> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('profiles')
      .select('nickname, avatar_emoji, avatar_url, cover_url')
      .eq('id', userId)
      .single(),
    'mypage.stats',
    8000,
  );
  if (error) throw error;
  return (data ?? null) as MypageStats | null;
}

async function fetchMyPosts(): Promise<UserPost[]> {
  // ★ de-anon Phase2: author_id を client で使わず auth.uid() ベースの RPC (get_my_posts) で
  //   自分の投稿を取得する。0129 で posts.author_id を REVOKE しても壊れない (列フィルタにも
  //   SELECT 権が要るため .eq('author_id', ...) は permission denied)。非公開も自分の分は含む。
  //   カード描画用の title/media/video 列は 0131 で RPC に追加済 (未適用環境では undefined になり、
  //   PostRow 側の guard で画像/タイトル無しとして安全に描画される)。
  const { data, error } = await withApiTimeout(
    supabase.rpc('get_my_posts', { p_limit: 30 }),
    'mypage.get_my_posts',
    8000,
  );
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as UserPost[];
}

async function fetchSavedPosts(userId: string): Promise<SavedPost[]> {
  const { data: saves, error: savesError } = await withApiTimeout(
    supabase
      .from('saves')
      .select('post_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
    'mypage.saves',
    8000,
  );
  if (savesError) throw savesError;
  if (!saves || saves.length === 0) return [];
  const postIds = (saves as { post_id: string }[]).map((s) => s.post_id);
  const { data: posts, error: postsError } = await withApiTimeout(
    supabase
      .from('posts')
      .select(
        'id, content, title, media_urls, media_blurhashes, video_urls, video_posters, likes_count, comments_count, created_at',
      )
      .in('id', postIds),
    'mypage.savedPosts',
    8000,
  );
  if (postsError) throw postsError;
  // 保存順を維持
  const map = new Map((posts ?? []).map((p) => [(p as SavedPost).id, p as SavedPost]));
  return postIds.map((id) => map.get(id)).filter((p): p is SavedPost => !!p);
}

// -----------------------------------------------------------------------------
// FlashList の行ユニオン(item.kind で renderItem を分岐)
// -----------------------------------------------------------------------------
type Row =
  | { kind: 'skeleton' }
  | { kind: 'lock' }
  | { kind: 'empty'; tab: ProfileTabKey }
  | { kind: 'post'; post: UserPost }
  | { kind: 'comment'; comment: MyCommentRow }
  | { kind: 'saved'; post: SavedPost };

// 「…」削除メニューの対象 (自分の投稿/コメントのみ)。
// comment は postId(所属投稿)も持ち、削除後に投稿詳細のコメント一覧も無効化する。
type DeleteTarget = { kind: 'post' | 'comment'; id: string; postId?: string };

// 投稿/保存の media 列を MyEntryRow 用の統一 media リストへ(画像→動画の順)。
function toMedia(
  images: string[] | null,
  blurhashes: string[] | null,
  videos: string[] | null,
  posters: string[] | null,
): MyMediaItem[] {
  const out: MyMediaItem[] = [];
  (images ?? []).forEach((url, i) =>
    out.push({ type: 'image', url, blurhash: blurhashes?.[i] ?? null }),
  );
  (videos ?? []).forEach((url, i) =>
    out.push({ type: 'video', url, poster: posters?.[i] ?? null }),
  );
  return out;
}

// コメントの media_urls は拡張子で画像/動画を判定(動画は poster 無し)。
const COMMENT_VIDEO_RE = /\.(mp4|mov|webm|m4v)(\?|#|$)/i;
function commentToMedia(urls: string[] | null): MyMediaItem[] {
  return (urls ?? []).map((url) =>
    COMMENT_VIDEO_RE.test(url) ? { type: 'video', url, poster: null } : { type: 'image', url },
  );
}

// =============================================================================
// MypageScreen
// =============================================================================
export default function MypageScreen() {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const qc = useQueryClient();

  const listRef = useRef<FlashList<Row>>(null);
  // タブ(底辺バー)再タップで先頭へ。FlashList は scrollToOffset を持つので互換。
  useScrollToTop(listRef as never);

  const [tab, setTab] = useState<ProfileTabKey>('posts');
  const [showStickyTabs, setShowStickyTabs] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  // 自分の投稿/コメントの「…」メニュー & 削除確認の対象。
  const [menuTarget, setMenuTarget] = useState<DeleteTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<DeleteTarget | null>(null);
  // ★ 連打レース対策: state は非同期更新で二重実行を許すので ref で確実にロックする。
  const deletingRef = useRef(false);
  const showToast = useToastStore((s) => s.show);

  // ---- スクロール駆動値(全 collapse / parallax / ミニバーの単一ソース)----
  const scrollY = useSharedValue(0);
  // 擬似 sticky タブ複製の出現しきい値(ヒーロー実高 − ミニバー高)。
  const stickyThreshold = HERO_H - (insets.top + STICKY_BAR_H) - 20;
  // ★ Web 対応: useAnimatedScrollHandler を plain FlashList の onScroll に渡すと
  //   react-native-web の ScrollView が `_b.call is not a function` で落ちる
  //   (reanimated の worklet ハンドラは Animated コンポーネント専用)。通常の JS
  //   onScroll で shared value を更新する(web は元々 JS スレッド、native も 16ms
  //   throttle で十分滑らか。masthead/ミニバー側の useAnimatedStyle が scrollY を購読)。
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollY.value = y;
      const should = y > stickyThreshold;
      setShowStickyTabs((prev) => (prev !== should ? should : prev));
    },
    [scrollY, stickyThreshold],
  );

  // 擬似 sticky タブ複製の opacity(ヒーロー末で 0→1)。
  const stickyTabStyle = useAnimatedStyle(() => {
    const end = HERO_H - (insets.top + STICKY_BAR_H);
    const start = end - STICKY_FADE_OFFSET;
    return { opacity: interpolate(scrollY.value, [start, end], [0, 1], Extrapolation.CLAMP) };
  });

  // ---- データ ----
  const { data: stats } = useQuery({
    queryKey: ['mypage-stats', userId],
    queryFn: () => fetchProfileStats(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });
  const { data: posts = [], isLoading: postsLoading } = useQuery({
    queryKey: ['user-posts', userId],
    queryFn: () => fetchMyPosts(),
    enabled: !!userId,
    staleTime: 30_000,
  });
  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ['user-comments', userId],
    queryFn: () => fetchMyComments(userId!),
    enabled: !!userId,
    staleTime: 30_000,
  });
  const { data: saved = [], isLoading: savedLoading } = useQuery({
    queryKey: ['saved-posts', userId],
    queryFn: () => fetchSavedPosts(userId!),
    enabled: !!userId,
    staleTime: 30_000,
  });

  // 投稿/保存が「どのコミュニティに投稿されているか」。posts+saved の id を 1 query で集約。
  const communityPostIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of posts) ids.add(p.id);
    for (const p of saved) ids.add(p.id);
    return Array.from(ids);
  }, [posts, saved]);
  const { data: postCommunities = {} } = useQuery({
    queryKey: ['mypage-post-communities', communityPostIds.join('|')],
    queryFn: () => fetchCommunitiesForPosts(communityPostIds),
    enabled: communityPostIds.length > 0,
    staleTime: 60_000,
  });

  const nickname = stats?.nickname ?? user?.nickname ?? 'ユーザー';
  const coverUri = useMemo(
    () => (stats?.cover_url ? thumbedUrl(stats.cover_url, 1080) : null),
    [stats?.cover_url],
  );

  // ---- 初回ナッジ ----
  // 登録を email+パスワードだけに最小化した代わりに、プロフィール(ニックネーム)と
  // 通知をマイページで後から促す。dismiss は user 別 key で永続化(端末ローカル)。
  const pushEnabled = useSettingsStore((s) => s.pushEnabled);
  const nudgeKey = userId ? `geek:nudge:profile_setup:dismissed:${userId}` : '';
  const [nudgeDismissed, setNudgeDismissed] = useState(() =>
    nudgeKey ? getBool(nudgeKey) === true : false,
  );
  const dismissNudge = useCallback(() => {
    if (nudgeKey) setBool(nudgeKey, true);
    setNudgeDismissed(true);
  }, [nudgeKey]);
  // userId が初回 render で未確定だと nudgeKey='' で false 初期化されるため、nudgeKey 確定時に
  // storage を読み直して dismiss 状態を同期する (dismiss 済が auth hydrate 競合で再出現するのを防ぐ)。
  useEffect(() => {
    if (nudgeKey) setNudgeDismissed(getBool(nudgeKey) === true);
  }, [nudgeKey]);
  // OS の push 許可状態 (未許可 = 有効化を促す)。focus ごとに読み直す (通知設定へ往復して許可を
  // 付けて戻っても古い状態が残らないように。逆に許可後もナッジが残るのも防ぐ)。
  // web は Push 非対応ブラウザ / VAPID 未設定だと「通知をオン」に到達しても操作不能なので、
  // その場合は needsEnable を立てない (空振りナッジを出さない)。判定不能なら false のまま = 控えめに非表示。
  const [pushNeedsEnable, setPushNeedsEnable] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          if (Platform.OS === 'web') {
            const supported =
              typeof window !== 'undefined' &&
              typeof navigator !== 'undefined' &&
              'Notification' in window &&
              'serviceWorker' in navigator &&
              'PushManager' in window;
            if (!supported || !isVapidConfigured()) {
              if (!cancelled) setPushNeedsEnable(false);
              return;
            }
            const granted =
              typeof Notification !== 'undefined' && Notification.permission === 'granted';
            if (!cancelled) setPushNeedsEnable(!granted);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
            const Notifications = require('expo-notifications') as typeof import('expo-notifications');
            const perm = await Notifications.getPermissionsAsync();
            if (!cancelled) setPushNeedsEnable(!perm.granted);
          }
        } catch {
          /* 判定不能 — ナッジを出さない */
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );
  // nickname がサーバ自動採番のまま (user_ + 8桁hex / migration 0146) or 空なら「未設定」。
  // {6,} で桁数に非依存に検出 — 採番長を将来変えても (旧 6 桁/新 8 桁とも) nudge が壊れない。
  const needProfile =
    !!stats && (!stats.nickname || /^user_[0-9a-f]{6,}$/.test(stats.nickname));
  const needPush = pushNeedsEnable || pushEnabled === false;
  const showNudge = !!userId && !nudgeDismissed && (needProfile || needPush);

  // 現タブのロード中(まだ 1 件も無い)か。本文領域に skeleton を出す条件。
  const activeLoading =
    (tab === 'posts' && postsLoading && posts.length === 0) ||
    (tab === 'comments' && commentsLoading && comments.length === 0) ||
    (tab === 'saved' && savedLoading && saved.length === 0);

  // ---- data 構築 ----
  const rows: Row[] = useMemo(() => {
    // ★ 重要(web): FlashList は data が空だと ListHeaderComponent(マストヘッド)ごと
    //   描画しない(ローディング中に画面が真っ黒になる)。skeleton を data 行として
    //   流し rows を絶対に空にしない。
    if (activeLoading) return [{ kind: 'skeleton' }];
    if (tab === 'posts') {
      if (posts.length === 0) return [{ kind: 'empty', tab: 'posts' }];
      return posts.map((post): Row => ({ kind: 'post', post }));
    }
    if (tab === 'comments') {
      if (comments.length === 0) return [{ kind: 'empty', tab: 'comments' }];
      return comments.map((comment): Row => ({ kind: 'comment', comment }));
    }
    if (saved.length === 0) return [{ kind: 'empty', tab: 'saved' }];
    return [{ kind: 'lock' }, ...saved.map((post): Row => ({ kind: 'saved', post }))];
  }, [tab, activeLoading, posts, comments, saved]);

  // ---- pull-to-refresh ----
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['mypage-stats'] }),
        qc.invalidateQueries({ queryKey: ['user-posts'] }),
        qc.invalidateQueries({ queryKey: ['user-comments'] }),
        qc.invalidateQueries({ queryKey: ['saved-posts'] }),
      ]);
    } catch {
      showToast('更新に失敗しました', 'error');
    } finally {
      setRefreshing(false);
    }
  }, [qc, refreshing, showToast]);

  // ---- タブ操作: 同じタブ再タップで先頭へ、別タブは切替 ----
  const onSelectTab = useCallback(
    (k: ProfileTabKey) => {
      if (k === tab) {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      } else {
        setTab(k);
      }
    },
    [tab],
  );

  const openSettings = useCallback(() => router.push('/settings' as never), [router]);
  const editAvatar = useCallback(() => router.push('/settings/profile-edit' as never), [router]);
  const openNotifications = useCallback(
    () => router.push('/settings/notifications' as never),
    [router],
  );
  const openPost = useCallback((id: string) => router.push(`/post/${id}` as never), [router]);
  const openCommunity = useCallback((id: string) => router.push(`/community/${id}` as never), [router]);
  const openImage = useCallback((url: string) => setLightboxUri(thumbedUrl(url, 1280)), []);

  // 「…」→ 削除確認 → 実削除。posts/comments の RLS で本人のみ削除可。
  //  削除後は該当タブの query を invalidate して一覧から消す(counter は DB トリガで減算)。
  const handleDelete = useCallback(async () => {
    const t = confirmTarget;
    if (!t || deletingRef.current) return;
    deletingRef.current = true;
    try {
      if (t.kind === 'post') {
        await deleteOwnPost(t.id);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['user-posts', userId] }),
          // 同じ投稿は保存タブ/投稿詳細キャッシュにも居るので一緒に無効化。
          qc.invalidateQueries({ queryKey: ['saved-posts', userId] }),
          qc.invalidateQueries({ queryKey: ['post', t.id] }),
        ]);
      } else {
        await deleteComment(t.id);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['user-comments', userId] }),
          // 開いている投稿詳細のコメント一覧/件数も更新する。
          ...(t.postId
            ? [
                qc.invalidateQueries({ queryKey: ['post-comments', t.postId] }),
                qc.invalidateQueries({ queryKey: ['post', t.postId] }),
              ]
            : []),
        ]);
      }
      showToast(t.kind === 'comment' ? 'コメントを削除しました' : '投稿を削除しました', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '削除に失敗しました', 'error');
    } finally {
      deletingRef.current = false;
      setConfirmTarget(null);
    }
  }, [confirmTarget, qc, userId, showToast]);

  // ---- ListHeader(誌面マストヘッド + 実体タブA + ロード中 skeleton)----
  const ListHeader = useMemo(
    () => (
      <View>
        <ProfileMastheadV2
          nickname={nickname}
          avatarUrl={stats?.avatar_url}
          avatarEmoji={stats?.avatar_emoji}
          coverUri={coverUri}
          topInset={insets.top}
          scrollY={scrollY}
          onEditAvatar={editAvatar}
          onOpenSettings={openSettings}
        />
        {showNudge && (
          <FirstRunNudge
            needProfile={needProfile}
            needPush={needPush}
            onSetProfile={editAvatar}
            onEnablePush={openNotifications}
            onDismiss={dismissNudge}
          />
        )}
        <ProfileTabsBar active={tab} onChange={onSelectTab} />
      </View>
    ),
    [
      nickname,
      stats?.avatar_url,
      stats?.avatar_emoji,
      coverUri,
      insets.top,
      scrollY,
      editAvatar,
      openSettings,
      tab,
      onSelectTab,
      showNudge,
      needProfile,
      needPush,
      openNotifications,
      dismissNudge,
    ],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      switch (item.kind) {
        case 'skeleton':
          return (
            <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['4'], gap: SP['3'] }}>
              <MyEntryRowSkeleton count={5} />
            </View>
          );
        case 'lock':
          return <LockNotice />;
        case 'empty':
          return (
            <EmptyForTab
              tab={item.tab}
              onPostAction={() => router.push('/post/create' as never)}
              onFeedAction={() => router.push('/(tabs)/feed' as never)}
            />
          );
        case 'post':
          return (
            <PostRow
              post={item.post}
              community={postCommunities[item.post.id]?.[0] ?? null}
              onPress={() => openPost(item.post.id)}
              onOpenImage={openImage}
              onOpenCommunity={openCommunity}
              onMore={() => setMenuTarget({ kind: 'post', id: item.post.id })}
            />
          );
        case 'comment':
          return (
            <CommentRow
              comment={item.comment}
              onPress={() => item.comment.post && openPost(item.comment.post.id)}
              onOpenImage={openImage}
              onMore={() => setMenuTarget({ kind: 'comment', id: item.comment.id, postId: item.comment.post_id })}
            />
          );
        case 'saved':
          return (
            <SavedRow
              post={item.post}
              community={postCommunities[item.post.id]?.[0] ?? null}
              onPress={() => openPost(item.post.id)}
              onOpenImage={openImage}
              onOpenCommunity={openCommunity}
            />
          );
      }
    },
    [router, openPost, openImage, openCommunity, postCommunities],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlashList
        ref={listRef}
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        // ★ 縦長メディア行(画像/動画)の実高は ~350-650px。旧 180 は過小で、
        //   スクロール中に実測との差でコンテンツが跳ね「かくかく」していた。
        estimatedItemSize={400}
        // ★ 行種別ごとに recycle プールを分離。post/comment/saved の縦長行と
        //   skeleton/lock/empty の小行が混ざると、別種セルへの再利用で全面 relayout
        //   が走りスクロールがカクつく。kind で分けると同種同士のみ再利用される。
        getItemType={(item) => item.kind}
        // ★ 1 ビューポート分先読みして、メディア行の空セル白点滅を抑える(feed と同値)。
        drawDistance={600}
        // ★ web で FlashList が親の高さを取れず 0 高さに潰れて中身が見えなく
        //   なる(画面が真っ黒)のを防ぐ。初期サイズを明示して必ず描画させる。
        estimatedListSize={{ width: winW, height: winH }}
        ListHeaderComponent={ListHeader}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        refreshControl={
          <GeekRefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            progressViewOffset={insets.top + 40}
          />
        }
      />

      {/* ===== 擬似 sticky タブ複製(B)— ヒーロー末で出現。実体A と active を共有 ===== */}
      <Animated.View
        pointerEvents={showStickyTabs ? 'auto' : 'none'}
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: insets.top + STICKY_BAR_H,
            backgroundColor: C.bg, // blur ネスト回避(ミニバーが既に blur 面)= solid
            zIndex: 4,
          },
          stickyTabStyle,
        ]}
      >
        <ProfileTabsBar active={tab} onChange={onSelectTab} />
      </Animated.View>

      {/* ===== 上端ガラスミニバー(誌名受け渡し)— 自己 absolute ===== */}
      <MypageStickyBar
        nickname={nickname}
        avatarUrl={stats?.avatar_url}
        avatarEmoji={stats?.avatar_emoji}
        topInset={insets.top}
        scrollY={scrollY}
        onOpenSettings={openSettings}
      />

      {/* ===== 画像タップ → 全画面ビューア(常時インライン表示 + 拡大は任意) ===== */}
      <ImageLightbox visible={!!lightboxUri} uri={lightboxUri} onClose={() => setLightboxUri(null)} />

      {/* ===== 「…」メニュー(自分の投稿/コメント)— 下端シート ===== */}
      <Modal
        transparent
        visible={!!menuTarget}
        animationType="fade"
        onRequestClose={() => setMenuTarget(null)}
      >
        <Pressable
          onPress={() => setMenuTarget(null)}
          style={{ flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' }}
        >
          {/* シート本体。onPress を握って背景タップ(閉じる)と分離する。 */}
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R.xl,
              borderTopRightRadius: R.xl,
              paddingBottom: insets.bottom + SP['2'],
              borderTopWidth: 1,
              borderColor: C.border,
            }}
          >
            <View style={{ alignItems: 'center', paddingTop: SP['3'] }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border }} />
            </View>
            <ActionSheet
              actions={[
                {
                  label: menuTarget?.kind === 'comment' ? 'コメントを削除' : '投稿を削除',
                  icon: Icon.trash,
                  destructive: true,
                  onPress: () => setConfirmTarget(menuTarget),
                },
              ]}
              onClose={() => setMenuTarget(null)}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== 削除の確認 ===== */}
      <ConfirmDialog
        visible={!!confirmTarget}
        destructive
        title={confirmTarget?.kind === 'comment' ? 'このコメントを削除しますか？' : 'この投稿を削除しますか？'}
        message="削除すると元に戻せません。"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        onConfirm={handleDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </View>
  );
}

function keyExtractor(item: Row): string {
  switch (item.kind) {
    case 'skeleton':
      return '__skeleton';
    case 'lock':
      return '__lock';
    case 'empty':
      return '__empty';
    case 'post':
      return `post:${item.post.id}`;
    case 'comment':
      return `comment:${item.comment.id}`;
    case 'saved':
      return `saved:${item.post.id}`;
  }
}

// -----------------------------------------------------------------------------
// 行ラッパ(MyEntryRow に metaNode/badgeNode/quoteNode を組んで渡す)
// -----------------------------------------------------------------------------
const PostMeta = memo(function PostMeta({ likes, comments, at }: { likes: number; comments: number; at: string }): ReactNode {
  return (
    <>
      <MetaNum Icon={MetaHeartIcon} value={likes} />
      <MetaNum Icon={MetaCommentIcon} value={comments} />
      <Text style={[T.caption, { color: C.text4 }]}>· {formatRelative(at)}</Text>
    </>
  );
});

// 投稿が「どのコミュニティに投稿されているか」を示す小型 chip(アイコン + 名前)。
// カード本体タップ(投稿を開く)と衝突しないよう stopPropagation で握る。
const CommunityChip = memo(function CommunityChip({ community, onPress }: { community: PostCommunityRef; onPress: () => void }): ReactNode {
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation();
        onPress();
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`コミュニティ ${community.name} を開く`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        maxWidth: '80%',
        marginBottom: SP['2'],
        paddingVertical: 3,
        paddingLeft: 3,
        paddingRight: 9,
        backgroundColor: C.bg2,
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <CommunityIcon
        size={18}
        iconUrl={community.icon_url}
        iconEmoji={community.icon_emoji}
        iconColor={community.icon_color}
        name={community.name}
      />
      <Text style={[T.caption, { color: C.text2, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>
        {community.name}
      </Text>
    </Pressable>
  );
});

const PostRow = memo(function PostRow({
  post,
  community,
  onPress,
  onOpenImage,
  onOpenCommunity,
  onMore,
}: {
  post: UserPost;
  community: PostCommunityRef | null;
  onPress: () => void;
  onOpenImage: (url: string) => void;
  onOpenCommunity: (id: string) => void;
  onMore: () => void;
}): ReactNode {
  const title = post.title?.trim() || null;
  const badge = !post.is_public ? (
    <Text
      style={[
        T.caption,
        {
          color: C.amber,
          borderWidth: 1,
          borderColor: C.amber + '55',
          borderRadius: 4,
          paddingHorizontal: 5,
        },
      ]}
    >
      非公開
    </Text>
  ) : undefined;
  return (
    <MyEntryRow
      variant="post"
      title={title}
      snippet={post.content?.trim() ?? ''}
      media={toMedia(post.media_urls, post.media_blurhashes, post.video_urls, post.video_posters)}
      metaNode={<PostMeta likes={post.likes_count} comments={post.comments_count} at={post.created_at} />}
      badgeNode={badge}
      communityNode={
        community ? (
          <CommunityChip community={community} onPress={() => onOpenCommunity(community.community_id)} />
        ) : undefined
      }
      onPress={onPress}
      onOpenImage={onOpenImage}
      onMore={onMore}
      accessibilityLabel="投稿を開く"
    />
  );
});

const SavedRow = memo(function SavedRow({
  post,
  community,
  onPress,
  onOpenImage,
  onOpenCommunity,
}: {
  post: SavedPost;
  community: PostCommunityRef | null;
  onPress: () => void;
  onOpenImage: (url: string) => void;
  onOpenCommunity: (id: string) => void;
}): ReactNode {
  const title = post.title?.trim() || null;
  return (
    <MyEntryRow
      variant="saved"
      title={title}
      snippet={post.content?.trim() ?? ''}
      media={toMedia(post.media_urls, post.media_blurhashes, post.video_urls, post.video_posters)}
      metaNode={<PostMeta likes={post.likes_count} comments={post.comments_count} at={post.created_at} />}
      communityNode={
        community ? (
          <CommunityChip community={community} onPress={() => onOpenCommunity(community.community_id)} />
        ) : undefined
      }
      onPress={onPress}
      onOpenImage={onOpenImage}
      accessibilityLabel="保存した投稿を開く"
    />
  );
});

const CommentRow = memo(function CommentRow({
  comment,
  onPress,
  onOpenImage,
  onMore,
}: {
  comment: MyCommentRow;
  onPress: () => void;
  onOpenImage: (url: string) => void;
  onMore: () => void;
}): ReactNode {
  const body = comment.content?.trim() || '';
  const post = comment.post;
  const source = post ? post.title?.trim() || post.content?.trim().slice(0, 40) || '投稿' : null;
  const quote = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        marginTop: SP['2'],
        paddingTop: SP['2'],
        borderTopWidth: 1,
        borderTopColor: C.divider,
        opacity: post ? 1 : 0.6,
      }}
    >
      <MyEntryIcons.arrowUL size={12} color={C.text3} strokeWidth={2} />
      <Text style={[T.small, { color: C.text3, flex: 1 }]} numberOfLines={1}>
        {source ? `${source}への返信` : '削除された投稿'}
      </Text>
      {source ? <MyEntryIcons.chevronR size={14} color={C.text4} strokeWidth={2} /> : null}
    </View>
  );
  return (
    <MyEntryRow
      variant="comment"
      snippet={body}
      media={commentToMedia(comment.media_urls)}
      quoteNode={quote}
      onPress={post ? onPress : () => {}}
      onOpenImage={onOpenImage}
      onMore={onMore}
      accessibilityLabel="コメントした投稿を開く"
    />
  );
});

// -----------------------------------------------------------------------------
// Lock notice(保存タブ専用「自分だけ」宣言)— 安心はグレーで語る(1画面1アクセント)
// -----------------------------------------------------------------------------
const LockNotice = memo(function LockNotice(): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        marginHorizontal: SP['4'],
        marginTop: SP['3'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.divider,
      }}
    >
      <Icon.lock size={14} color={C.text3} strokeWidth={2.2} />
      <Text style={[T.caption, { color: C.text3, flex: 1 }]}>保存済みはあなただけが見られます</Text>
    </View>
  );
});

// -----------------------------------------------------------------------------
// 初回ナッジ — 登録を最小化した代わりに、プロフィール(ニックネーム)と通知を
// マイページで後から促す。カードはグレー、CTA だけ accent(1画面1アクセント)。dismiss 可。
// -----------------------------------------------------------------------------
const FirstRunNudge = memo(function FirstRunNudge({
  needProfile,
  needPush,
  onSetProfile,
  onEnablePush,
  onDismiss,
}: {
  needProfile: boolean;
  needPush: boolean;
  onSetProfile: () => void;
  onEnablePush: () => void;
  onDismiss: () => void;
}): ReactNode {
  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SP['2'],
    paddingVertical: SP['2'],
  };
  return (
    <View
      style={{
        marginHorizontal: SP['4'],
        marginTop: SP['3'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['2'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SP['1'] }}>
        <Text style={[T.caption, { color: C.text3, flex: 1 }]}>プロフィールを仕上げましょう</Text>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="閉じる">
          <Icon.close size={16} color={C.text3} strokeWidth={2.2} />
        </Pressable>
      </View>
      {needProfile && (
        <Pressable onPress={onSetProfile} style={rowStyle} accessibilityRole="button">
          <Icon.edit size={18} color={C.accent} strokeWidth={2.2} />
          <Text style={[T.body, { color: C.text, flex: 1 }]}>ニックネームを設定する</Text>
          <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
        </Pressable>
      )}
      {needPush && (
        <Pressable onPress={onEnablePush} style={rowStyle} accessibilityRole="button">
          <Icon.bell size={18} color={C.accent} strokeWidth={2.2} />
          <Text style={[T.body, { color: C.text, flex: 1 }]}>通知をオンにする</Text>
          <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  );
});

// -----------------------------------------------------------------------------
// 空状態(「欠落」でなく「これから」)— EmptyState の circle は常に紫(仕様既知)
// -----------------------------------------------------------------------------
function EmptyForTab({
  tab,
  onPostAction,
  onFeedAction,
}: {
  tab: ProfileTabKey;
  /** 「投稿する」ボタン押下時(posts タブ専用) */
  onPostAction: () => void;
  /** 「フィードを見る」ボタン押下時(comments / saved タブ) */
  onFeedAction: () => void;
}): ReactNode {
  if (tab === 'posts') {
    return (
      <EmptyState
        emoji="✍️"
        tone="accent"
        title="まだ、最初の一編を書いていません"
        message={'"好き"を、匿名で気軽に。最初の記録がここに綴じられます。'}
        actionLabel="投稿する"
        onAction={onPostAction}
      />
    );
  }
  if (tab === 'comments') {
    return (
      <EmptyState
        emoji="💬"
        tone="accent"
        title="まだ声を残していません"
        message="気になる記事に、あなたの言葉を。残したコメントはここに集まります。"
        actionLabel="フィードを見る"
        onAction={onFeedAction}
      />
    );
  }
  return (
    <EmptyState
      icon={Icon.save}
      tone="amber"
      title="切り抜きはまだ空っぽです"
      message="あとで読み返したい投稿は ブックマーク を。保存はあなただけが見られます。"
      actionLabel="フィードを見る"
      onAction={onFeedAction}
    />
  );
}
