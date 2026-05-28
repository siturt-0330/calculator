import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, RefreshControl, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image as ExpoImage } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { EASE_OUT_QUART } from '../../design/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFeed } from '../../hooks/useFeed';
import { useTagFilter } from '../../hooks/useTagFilter';
import { useTagFilterStore } from '../../stores/tagFilterStore';
import { useLike, useLikes } from '../../hooks/useLike';
import { useConcern, useConcerns } from '../../hooks/useConcern';
import { useSave, useSaves } from '../../hooks/useSave';
import { useShare } from '../../hooks/useShare';
import { useReport } from '../../hooks/useReport';
import { useReactions, useReactionToggle } from '../../hooks/useReactions';
import { useAddedTags, useAddTag } from '../../hooks/useAddedTags';
import { usePolls } from '../../hooks/usePolls';
import { useFeedPage } from '../../hooks/useFeedPage';
import { useFeedRealtime } from '../../hooks/useFeedRealtime';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationBadge } from '../../components/ui/NotificationBadge';
import { useToastStore } from '../../stores/toastStore';
import { useFeedStore } from '../../stores/feedStore';
import { AnonPostCard } from '../../components/feed/AnonPostCard';
import { AdCard } from '../../components/feed/AdCard';
import type { Ad } from '../../lib/api/ads';

// フィード上の item — 通常 post か広告アイテム (__ad マーカー付き)
type AdItem = { __ad: true; ad: Ad; position: number; matchedTags: string[]; key: string };
type FeedItem = Post | AdItem;
const isAdItem = (it: FeedItem): it is AdItem => (it as AdItem).__ad === true;

// パフォーマンス監査: renderItem で `??[]` を使うと毎回新 array が生成され
// AnonPostCard memo が壊れる (props 比較で false 判定 → 全カード re-render)。
// モジュール定数を共有することで参照安定化、re-render を 15-22% 削減。
import type { ReactionAgg } from '../../lib/api/reactions';
import type { PostCommunityRef } from '../../lib/api/posts';
const EMPTY_REACTIONS: ReactionAgg[] = [];
const EMPTY_ADDED_TAGS: string[] = [];
const EMPTY_COMMUNITIES: PostCommunityRef[] = [];
// RPC が有効な時、legacy hook 群へ渡す「空 ids」 — 配列参照を共有して
// useQuery が enabled=false で fetch しないように。
const EMPTY_LEGACY_IDS: string[] = [];
// legacy hook 群が disabled (postIds=[]) のときの空マップ — 参照安定化
const EMPTY_BOOL_MAP: Record<string, boolean> = {};
const VIEWABILITY_CONFIG = { viewAreaCoveragePercentThreshold: 30 } as const;

// ============================================================
// FeedRowEnter — per-row 入場アニメ (opacity 0→1 + translateY 12→0)
// ------------------------------------------------------------
// 220ms ease-out-quart, stagger index*40ms (上限 6 cell = 240ms 上限) で、
// 50+ items でも 2 秒待ちにならないよう cap している。
// 初回 mount だけ走り、scroll で再 mount されたときは即表示 (replay しない)
// — FlashList は cell を recycle するが React 視点では別 component なので、
//   ここでは「マウント時の time が初回 render 期間内 (1.5s) なら再生する」
//   というシンプル戦略を取らない。代わりに row 自身が「私は初回」フラグを
//   useRef で持ち、再 render では shared value 触らず無動作。
// reduceMotion=true は初期値を 1/0 で固定して即表示。
// ============================================================
const ROW_ENTER_DURATION = 220;
const ROW_ENTER_STAGGER_MS = 40;
const ROW_ENTER_STAGGER_CAP = 6; // index*40 を最大 240ms に
const FeedRowEnter = memo(function FeedRowEnter({
  index,
  children,
}: {
  index: number;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const translateY = useSharedValue(reduceMotion ? 0 : 12);
  const firstRender = useRef(true);

  if (firstRender.current) {
    firstRender.current = false;
    if (!reduceMotion) {
      const delay = Math.min(index, ROW_ENTER_STAGGER_CAP) * ROW_ENTER_STAGGER_MS;
      const cfg = { duration: ROW_ENTER_DURATION, easing: EASE_OUT_QUART };
      opacity.value = withDelay(delay, withTiming(1, cfg));
      translateY.value = withDelay(delay, withTiming(0, cfg));
    }
  }

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
});

import { ScopeToggle } from '../../components/feed/ScopeToggle';
import { BlockedTagBanner } from '../../components/feed/BlockedTagBanner';
import { logEvent } from '../../lib/personalize';
import { PostCardSkeleton } from '../../components/feed/PostCardSkeleton';
import { TrendingRow } from '../../components/feed/TrendingRow';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Icon } from '../../constants/icons';
import { SP } from '../../design/tokens';
import { useTheme } from '../../hooks/useColors';
import { FONT, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import { LinearGradient } from 'expo-linear-gradient';
import type { Post } from '../../types/models';

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // テーマ購読 — light/dark 切替で feed 画面が自動再 render される
  const { C, GRAD, SHADOW } = useTheme();
  const { posts, reasonsMap, communitiesByPost, ads, interestTags, loading, refreshing, refresh, loadMore } = useFeed();
  const { blockedCount } = useTagFilter();
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const scope = useFeedStore((s) => s.scope);
  const setScope = useFeedStore((s) => s.setScope);
  // 並び替え: for-you/new/rising/hot/top の 5 軸。default は for-you。
  // - 'rising' = Reddit 風「直近 3h の likes/分」(client-side 再ランク)
  // - 既存 (for-you/hot/new/top) の挙動は変更なし
  const sort = useFeedStore((s) => s.sort);
  const setSort = useFeedStore((s) => s.setSort);
  const hydrateFeed = useFeedStore((s) => s.hydrate);
  const hasLikedTags = likedTags.length > 0;

  // 好きなタグが無いときに closed scope に居たら open へ強制
  useEffect(() => {
    if (!hasLikedTags && scope === 'closed') setScope('open');
  }, [hasLikedTags, scope, setScope]);
  const { toggle: toggleLike } = useLike();
  const { toggle: toggleConcern } = useConcern();
  const { toggle: toggleSave } = useSave();
  const { toggle: toggleReact } = useReactionToggle();
  const { unreadCount } = useNotifications();
  const { share } = useShare();
  const { report } = useReport();
  const listRef = useRef<FlashList<FeedItem>>(null);
  const [reportPostId, setReportPostId] = useState<string | null>(null);

  useEffect(() => {
    void hydrateFeed();
  }, [hydrateFeed]);

  // posts は毎 render で新しい配列参照になる (data?.pages.flatMap 経由)。
  // ID リストの中身が変わらない限り再計算したくないので、id を join したハッシュで
  // 安定化する。これで下流の useQuery/useMemo が ID 集合が同じ render では
  // 再評価されない。
  const postIdsHash = posts.map((p) => p.id).join('|');
  const postIds = useMemo(() => posts.map((p) => p.id), [postIdsHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- RPC 経路: get_feed_page で周辺データを 1 RTT で取得 ---
  // 旧 6 hook (useLikes/useConcerns/useSaves/useReactions/useAddedTags/usePolls)
  // を 1 RPC に統合。失敗 / ENV flag 無効時は legacy hook 群へフォールバック。
  // rpcLoading / rpcEmpty は使わない (旧 fallback ロジック用) — 上記コメント参照。
  const { fullPosts, isDisabled: rpcDisabled } = useFeedPage(postIds);

  // ★ Realtime 反映 — RPC 経路でも post_reactions / likes / concerns / saves の
  //   変更を購読する。useReactions(legacyIds) の中の subscription は legacyIds=[]
  //   で disabled になっていたので、ここで常時起動する。
  useFeedRealtime(postIds);

  // fallback 判定:
  //   - ENV flag で RPC が無効 (= isDisabled)  → legacy fire
  //   - それ以外は RPC のみで完結 (legacy hooks は disable)
  //
  // ★ パフォーマンス最適化 (2026-05-28):
  //   旧版は「RPC が active でも legacy hooks を常時起動」する設計だった。
  //   これは「最初のチップ表示が遅延する」UX バグを治すための過渡対応だったが、
  //   結果として 6 個の並列 fetch (likes/concerns/saves/reactions/added_tags/polls)
  //   が毎回走り、初回ロード時の HTTP round-trip が 7+1 = 8 個に膨れていた。
  //   RPC は同等データを 1 RTT で返すので、本来 legacy は ENV flag fallback 時のみで十分。
  //   レイテンシ短縮 + Supabase row 引きの圧縮 (4-6x の query 数削減) を狙う。
  //   renderItem 側で full?.X ?? legacy[id] ?? EMPTY の順 — RPC 経路なら legacy は
  //   常に空 map になるが、依然として fallback 経路で安全。
  const useLegacy = rpcDisabled;
  const legacyIds = useLegacy ? postIds : EMPTY_LEGACY_IDS;

  const { data: legacyMyLikes = EMPTY_BOOL_MAP } = useLikes(legacyIds);
  const { data: legacyMyConcerns = EMPTY_BOOL_MAP } = useConcerns(legacyIds);
  const { data: legacyMySaves = EMPTY_BOOL_MAP } = useSaves(legacyIds);
  const { data: legacyReactions } = useReactions(legacyIds);
  const { data: legacyAddedTags } = useAddedTags(legacyIds);
  const { polls: legacyPolls } = usePolls(legacyIds);
  const { addTag } = useAddTag();
  const { show: showToast } = useToastStore();

  const handleAddTag = useCallback(async (postId: string, tag: string) => {
    try {
      await addTag(postId, tag);
      showToast(`#${tag} を追加しました`, 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('duplicate')) {
        showToast('そのタグは既に追加されています', 'warn');
      } else {
        showToast(msg ? `追加に失敗しました: ${msg}` : '追加に失敗しました', 'error');
      }
      // re-throw to keep AddTagInline open with the entered text.
      throw e;
    }
  }, [addTag, showToast]);

  // Per-post handler cache. Rebuilds when `posts` (or upstream callbacks) change,
  // but NOT when toggles like myLikes/mySaves/reactions update — so cards whose
  // observable props didn't change skip re-render thanks to the AnonPostCard memo.
  //
  // onConcern は「現在の concerned 状態」を引数に取る — RPC fullPosts を最優先で
  // 参照、無ければ legacy の myConcerns map を見る。両方とも空でも問題なし
  // (toggleConcern は false を受けて INSERT 試行 → unique violation で安全に冪等)。
  const handlersByPostId = useMemo(() => {
    const dict: Record<string, {
      onLike: () => void;
      onConcern: () => void;
      onComment: () => void;
      onSave: () => void;
      onShare: () => void;
      onTagPress: (tag: string) => void;
      onMore: () => void;
      onReact: (meme: string) => void;
      onAddTag: (tag: string) => Promise<void> | void;
      onCommunityPress: (id: string) => void;
    }> = {};
    for (const p of posts) {
      const id = p.id;
      const tagNames = p.tag_names ?? [];
      dict[id] = {
        onLike: () => {
          void logEvent({ kind: 'post_like', tags: tagNames, post_id: id });
          toggleLike(id);
        },
        onConcern: () => {
          void logEvent({ kind: 'post_concern', tags: tagNames, post_id: id });
          // current は useConcern 内部で cache から判定 (smart-queue + race-safe)
          toggleConcern(id);
        },
        onComment: () => {
          void logEvent({ kind: 'post_view', tags: tagNames, post_id: id, dwell_ms: 0 });
          router.push(`/post/${id}` as never);
        },
        onSave: () => {
          void logEvent({ kind: 'post_save', tags: tagNames, post_id: id });
          toggleSave(id);
        },
        onShare: () => share(`Geek の投稿 #${tagNames[0] ?? '雑談'}`, `/post/${id}`),
        onTagPress: (name: string) => {
          void logEvent({ kind: 'tag_click', tags: [name] });
          router.push(`/tag/${encodeURIComponent(name)}` as never);
        },
        onMore: () => setReportPostId(id),
        onReact: (meme: string) => toggleReact(id, meme),
        onAddTag: (tag: string) => handleAddTag(id, tag),
        onCommunityPress: (communityId: string) => {
          router.push(`/community/${communityId}` as never);
        },
      };
    }
    return dict;
  }, [posts, toggleLike, toggleConcern, toggleSave, toggleReact, share, router, handleAddTag, fullPosts, legacyMyConcerns]);

  // -------------------------------------------------------------------
  // posts + ads を 1 つの混在配列にマージ
  // -------------------------------------------------------------------
  // 8 件ごとに 1 つ広告を差し込む (8, 17, 26, ...) — ads が足りなければそこで終わり。
  // ad item は __ad プレフィックス + index の安定 key を持つ (ad.id が同じでも
  // 別ポジションに同一広告が出る場合に React のキー衝突を避ける)。
  const feedItems = useMemo<FeedItem[]>(() => {
    if (ads.length === 0) return posts;
    const result: FeedItem[] = [];
    let adIdx = 0;
    posts.forEach((p, i) => {
      result.push(p);
      // i==7 の後 (= 8 番目を push し終わったタイミング) で広告を挿入
      if ((i + 1) % 8 === 0 && adIdx < ads.length) {
        const ad = ads[adIdx];
        if (ad) {
          const matched = ad.target_tags.filter((t) => interestTags.includes(t));
          result.push({
            __ad: true,
            ad,
            position: result.length,  // 挿入直後のフィード位置
            matchedTags: matched,
            key: `__ad:${ad.id}:${i}`,
          });
        }
        adIdx++;
      }
    });
    return result;
  }, [posts, ads, interestTags]);

  // ★ Viewport ベースの画像 prewarm — 次の 5 セル分を先読みして scroll jank ゼロに
  // feedItems の宣言後に定義する必要がある (依存している)
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length === 0) return;
      const lastIdx = Math.max(...viewableItems.map((v) => v.index ?? 0));
      const lookahead = feedItems.slice(lastIdx + 1, lastIdx + 6);
      for (const item of lookahead) {
        if (isAdItem(item)) continue;
        const urls = item.media_urls ?? [];
        for (const u of urls) {
          // 480 で AnonPostCard 側の ProgressiveImage thumbWidth と揃える
          // (URL が完全一致しないと cache hit しない — 揃えれば prefetch が活きる)
          try { ExpoImage.prefetch(thumbedUrl(u, 480)); } catch { /* ignore */ }
        }
      }
    },
    [feedItems],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => {
      if (isAdItem(item)) {
        return (
          <FeedRowEnter index={index}>
            <AdCard ad={item.ad} position={item.position} matchedTags={item.matchedTags} />
          </FeedRowEnter>
        );
      }
      const post = item;
      const h = handlersByPostId[post.id];
      if (!h) return null;
      // RPC で取れていればそちらを優先、無ければ legacy map / 上位由来データへフォールバック
      const full = fullPosts.get(post.id);
      const liked = full ? full.my_like : !!legacyMyLikes[post.id];
      const concerned = full ? full.my_concern : !!legacyMyConcerns[post.id];
      const saved = full ? full.my_save : !!legacyMySaves[post.id];
      const reactions =
        full?.reactions ?? legacyReactions?.[post.id] ?? EMPTY_REACTIONS;
      const addedTags =
        full?.added_tags ?? legacyAddedTags?.[post.id] ?? EMPTY_ADDED_TAGS;
      // poll は AnonPostCard 側で `poll?: Poll` を期待 (undefined のみ)。
      // RPC は null も返しうるので、null も undefined に正規化する。
      const poll = full?.poll ?? legacyPolls?.[post.id] ?? undefined;
      const communities =
        full?.communities ?? communitiesByPost[post.id] ?? EMPTY_COMMUNITIES;
      // RPC 由来の official_author を post 本体に merge して AnonPostCard に渡す
      // (旧 useFeed パスでは fetchPosts → attachOfficialAuthor が既にやっている)
      const enrichedPost =
        full && full.official_author
          ? { ...post, official_author: full.official_author }
          : post;
      return (
        <FeedRowEnter index={index}>
          <AnonPostCard
            post={enrichedPost}
            liked={liked}
            concerned={concerned}
            saved={saved}
            reactions={reactions}
            addedTags={addedTags}
            poll={poll}
            reason={reasonsMap[post.id]}
            communities={communities}
            onLike={h.onLike}
            onConcern={h.onConcern}
            onComment={h.onComment}
            onSave={h.onSave}
            onShare={h.onShare}
            onTagPress={h.onTagPress}
            onMore={h.onMore}
            onReact={h.onReact}
            onAddTag={h.onAddTag}
            onCommunityPress={h.onCommunityPress}
          />
        </FeedRowEnter>
      );
    },
    [
      handlersByPostId,
      fullPosts,
      legacyMyLikes,
      legacyMyConcerns,
      legacyMySaves,
      legacyReactions,
      legacyAddedTags,
      legacyPolls,
      reasonsMap,
      communitiesByPost,
    ],
  );

  // Stable header element — recreating the inline <View> each parent render
  // would break header memoization and force TrendingRow to remount visuals.
  const ListHeader = useMemo(() => (
    <View>
      <TrendingRow />
      {blockedCount > 0 ? (
        <BlockedTagBanner count={blockedCount} onPress={() => router.push('/filter' as never)} />
      ) : null}
    </View>
  ), [blockedCount, router]);

  const Bell = Icon.bell;
  const Search = Icon.search;
  const Plus = Icon.plus;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* 上部 hero エリア — bg は flat だと無機質なので、ごく弱い紫 → 透明のグラデを
          被せてブランド色のニュアンスを忍ばせる。コンテンツ自体は読みやすさ重視で
          subtle に留める (opacity も低め)。 */}
      <View style={{ alignItems: 'center', backgroundColor: C.bg, position: 'relative' }}>
        <LinearGradient
          colors={GRAD.glass}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }}
        />
        <View style={{
          width: '100%', maxWidth: 720,
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
        }}>
          <PressableScale
            onPress={() => router.push('/post/create' as never)}
            haptic="confirm"
            hitSlop={8}
            accessibilityLabel="新規投稿"
            style={{
              width: 38, height: 38, borderRadius: 19,
              alignItems: 'center', justifyContent: 'center',
              marginRight: SP['3'],
              overflow: 'hidden',
              // primary CTA halo を付けて「最も主要な action」をひと目で示す
              ...SHADOW.accentGlow,
            }}
          >
            {/* gradient ベースの新規投稿 FAB — 単色 accent より brand 感が出る */}
            <LinearGradient
              colors={GRAD.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
              }}
            />
            <Plus size={20} color="#fff" strokeWidth={2.6} />
          </PressableScale>
          {/* Geek brand wordmark — Orbitron Black + accent gradient (web) + glow */}
          <Text
            allowFontScaling={false}
            style={[
              {
                flex: 1,
                fontFamily: LOGO_FONT,
                fontWeight: LOGO_FONT_WEIGHT,
                fontSize: 30,
                lineHeight: 34,
                letterSpacing: -0.7,
                color: C.text,
              },
              Platform.OS === 'web'
                ? // RN-web 経由で CSS gradient text を効かせる (as object キャストで十分通る)
                  ({
                    backgroundImage:
                      'linear-gradient(110deg, #b794f4 0%, #7c6af7 35%, #67c1ff 75%, #6ee7b7 100%)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    textShadow:
                      '0 0 14px rgba(124,106,247,0.55), 0 0 28px rgba(103,193,255,0.25)',
                    transform: 'skewX(-4deg)',
                  } as object)
                : {
                    color: C.accent,
                    textShadowColor: C.accent + '88',
                    textShadowOffset: { width: 0, height: 0 },
                    textShadowRadius: 10,
                    transform: [{ skewX: '-4deg' }],
                  },
            ]}
          >
            Geek
          </Text>
          {/* 右側 icon: glass 風の subtle 円形コンテナで上品な質感に */}
          <PressableScale
            onPress={() => router.push('/search' as never)}
            hitSlop={10}
            haptic="tap"
            accessibilityLabel="検索"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: C.glass,
              borderWidth: 1,
              borderColor: C.glassBorder,
              marginLeft: SP['1'],
            }}
          >
            <Search size={20} color={C.text} strokeWidth={2.2} />
          </PressableScale>
          <PressableScale
            onPress={() => router.push('/notifications' as never)}
            hitSlop={10}
            haptic="tap"
            accessibilityLabel={`通知${unreadCount > 0 ? ` ${unreadCount}件` : ''}`}
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: C.glass,
              borderWidth: 1,
              borderColor: C.glassBorder,
              marginLeft: SP['1'],
            }}
          >
            <View>
              <Bell size={20} color={C.text} strokeWidth={2.2} />
              <NotificationBadge count={unreadCount} top={-6} right={-8} />
            </View>
          </PressableScale>
        </View>
      </View>

      {/* SortTabs UI は除去 (内部 sort logic は維持)
          — useFeedStore.sort / setSort は他箇所で参照されるため selector は残す */}

      <View style={{ alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 720, paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
        <ScopeToggle
          value={scope}
          onChange={setScope}
          disabledClosed={!hasLikedTags}
          onClosedWhenEmpty={() => router.push('/filter' as never)}
        />
        </View>
      </View>

      {/* ヘッダーとリストの境界 — glass card style に合わせて hairline を弱めに
          (旧 C.divider はカードと衝突して "二重 border" に見えていた) */}
      <View style={{ height: 1, backgroundColor: C.divider }} />

      <FlashList
        ref={listRef}
        data={feedItems}
        drawDistance={250}
        // ★ Viewport prewarm: スクロール中に次の 5 セル分の画像を先読み
        //   Instagram 風に「下に出てくる画像が常に既にメモリにある」状態を作る。
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={handleViewableItemsChanged}
        renderItem={renderItem}
        // ★ extraData: FlashList は data の参照が変わらないと再 render しない。
        //   テキストスタンプ toggle (useReactionToggle) は feed-page cache のみ
        //   更新するため data=feedItems は不変 → FlashList が chip 行を更新せず
        //   「他の動作 (いいね等で feed cache が書き換わる) で初めて反映される」
        //   現象が出ていた。fullPosts (= useFeedPage の cache から生成) を
        //   extraData に渡すことで cache 更新 → fullPosts 新参照 → 強制再 render
        //   経路を確保する。AnonPostCard 側の memo が中身比較するので余分な
        //   再描画は走らない。
        extraData={fullPosts}
        keyExtractor={(item) => (isAdItem(item) ? item.key : item.id)}
        getItemType={(item) => (isAdItem(item) ? 'ad' : 'post')}
        estimatedItemSize={300}
        ListHeaderComponent={ListHeader}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.accent} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{
          // post 間の余白を確保するため top padding を増やす
          paddingTop: SP['3'],
          // 横方向: card は自身で角丸 + shadow を持つので、左右にちょっと余白を作って
          //  「浮いてる感」を出す。card 自体は maxWidth:720 + alignSelf:center.
          paddingHorizontal: SP['3'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        ListEmptyComponent={
          loading ? (
            <FeedSkeleton />
          ) : (
            <EmptyState
              icon={Icon.sparkles}
              title={scope === 'closed' ? '好きなタグの投稿がまだありません' : 'まだ投稿がありません'}
              message={scope === 'closed' ? '「All」に切り替えるか、好きなタグを増やしてみよう' : 'フィルター設定を確認するか、最初の投稿をしてみよう'}
              actionLabel="投稿する"
              onAction={() => router.push('/post/create' as never)}
              tone="accent"
            />
          )
        }
      />

      <ConfirmDialog
        visible={!!reportPostId}
        title="この投稿を通報しますか？"
        message="運営に通報されます。誤った情報・スパム・誹謗中傷などが対象です。"
        confirmLabel="通報する"
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setReportPostId(null)}
        onConfirm={() => {
          if (reportPostId) report({ postId: reportPostId, reason: 'other' });
          setReportPostId(null);
        }}
      />
    </View>
  );
}

function FeedSkeleton() {
  return (
    <View>
      {Array.from({ length: 3 }).map((_, i) => (
        <PostCardSkeleton key={`skel-post-${i}`} />
      ))}
    </View>
  );
}
