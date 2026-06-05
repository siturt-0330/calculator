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

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
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
import { supabase } from '../../lib/supabase';
import { fetchMyComments, type MyCommentRow } from '../../lib/api/comments';
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
  const { data } = await supabase
    .from('profiles')
    .select('nickname, avatar_emoji, avatar_url, cover_url')
    .eq('id', userId)
    .single();
  return (data ?? null) as MypageStats | null;
}

async function fetchPostsByAuthor(authorId: string): Promise<UserPost[]> {
  // 自分視点 (= 自分の RLS) では is_public=false も見える。カード描画に使う列のみ。
  const { data } = await supabase
    .from('posts')
    .select(
      'id, content, title, media_urls, media_blurhashes, video_urls, video_posters, likes_count, comments_count, is_public, created_at',
    )
    .eq('author_id', authorId)
    .order('created_at', { ascending: false })
    .limit(30);
  return (data ?? []) as UserPost[];
}

async function fetchSavedPosts(userId: string): Promise<SavedPost[]> {
  const { data: saves } = await supabase
    .from('saves')
    .select('post_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (!saves || saves.length === 0) return [];
  const postIds = (saves as { post_id: string }[]).map((s) => s.post_id);
  const { data: posts } = await supabase
    .from('posts')
    .select(
      'id, content, title, media_urls, media_blurhashes, video_urls, video_posters, likes_count, comments_count, created_at',
    )
    .in('id', postIds);
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

  // ---- スクロール駆動値(全 collapse / parallax / ミニバーの単一ソース)----
  const scrollY = useSharedValue(0);
  // 擬似 sticky タブ複製の出現しきい値(ヒーロー実高 − ミニバー高)。
  const stickyThreshold = HERO_H - (insets.top + 52) - 20;
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
    const start = HERO_H - (insets.top + 52) - 40;
    const end = HERO_H - (insets.top + 52);
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
    queryFn: () => fetchPostsByAuthor(userId!),
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

  const nickname = stats?.nickname ?? user?.nickname ?? 'ユーザー';
  const coverUri = useMemo(
    () => (stats?.cover_url ? thumbedUrl(stats.cover_url, 1080) : null),
    [stats?.cover_url],
  );

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
    } finally {
      setRefreshing(false);
    }
  }, [qc, refreshing]);

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
  const openPost = useCallback((id: string) => router.push(`/post/${id}` as never), [router]);
  const openImage = useCallback((url: string) => setLightboxUri(thumbedUrl(url, 1280)), []);

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
          return <EmptyForTab tab={item.tab} router={router} />;
        case 'post':
          return (
            <PostRow post={item.post} onPress={() => openPost(item.post.id)} onOpenImage={openImage} />
          );
        case 'comment':
          return (
            <CommentRow
              comment={item.comment}
              onPress={() => item.comment.post && openPost(item.comment.post.id)}
              onOpenImage={openImage}
            />
          );
        case 'saved':
          return (
            <SavedRow post={item.post} onPress={() => openPost(item.post.id)} onOpenImage={openImage} />
          );
      }
    },
    [router, openPost, openImage],
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
            top: insets.top + 52,
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
function PostMeta({ likes, comments, at }: { likes: number; comments: number; at: string }): ReactNode {
  return (
    <>
      <MetaNum Icon={MetaHeartIcon} value={likes} />
      <MetaNum Icon={MetaCommentIcon} value={comments} />
      <Text style={[T.caption, { color: C.text4 }]}>· {formatRelative(at)}</Text>
    </>
  );
}

function PostRow({
  post,
  onPress,
  onOpenImage,
}: {
  post: UserPost;
  onPress: () => void;
  onOpenImage: (url: string) => void;
}) {
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
      onPress={onPress}
      onOpenImage={onOpenImage}
      accessibilityLabel="投稿を開く"
    />
  );
}

function SavedRow({
  post,
  onPress,
  onOpenImage,
}: {
  post: SavedPost;
  onPress: () => void;
  onOpenImage: (url: string) => void;
}) {
  const title = post.title?.trim() || null;
  return (
    <MyEntryRow
      variant="saved"
      title={title}
      snippet={post.content?.trim() ?? ''}
      media={toMedia(post.media_urls, post.media_blurhashes, post.video_urls, post.video_posters)}
      metaNode={<PostMeta likes={post.likes_count} comments={post.comments_count} at={post.created_at} />}
      onPress={onPress}
      onOpenImage={onOpenImage}
      accessibilityLabel="保存した投稿を開く"
    />
  );
}

function CommentRow({
  comment,
  onPress,
  onOpenImage,
}: {
  comment: MyCommentRow;
  onPress: () => void;
  onOpenImage: (url: string) => void;
}) {
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
      accessibilityLabel="コメントした投稿を開く"
    />
  );
}

// -----------------------------------------------------------------------------
// Lock notice(保存タブ専用「自分だけ」宣言)— 安心はグレーで語る(1画面1アクセント)
// -----------------------------------------------------------------------------
function LockNotice() {
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
}

// -----------------------------------------------------------------------------
// 空状態(「欠落」でなく「これから」)— EmptyState の circle は常に紫(仕様既知)
// -----------------------------------------------------------------------------
function EmptyForTab({ tab, router }: { tab: ProfileTabKey; router: ReturnType<typeof useRouter> }) {
  if (tab === 'posts') {
    return (
      <EmptyState
        emoji="✍️"
        tone="accent"
        title="まだ、最初の一編を書いていません"
        message={'“好き”を、匿名で気軽に。最初の記録がここに綴じられます。'}
        actionLabel="投稿する"
        onAction={() => router.push('/post/create' as never)}
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
        onAction={() => router.push('/(tabs)/feed' as never)}
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
      onAction={() => router.push('/(tabs)/feed' as never)}
    />
  );
}
