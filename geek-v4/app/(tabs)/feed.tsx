import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  RefreshControl,
  Platform,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image as ExpoImage } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import { fetchNotifications } from '../../lib/api/notifications';
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
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
// useTagFilter は BlockedTagBanner と一緒に削除済み (banner をホームから外した)
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
// BlockedTagBanner はホームから非表示にした (フィルタ画面 /filter で確認可能)
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
  // Smart skeleton timing — skeleton only after 200ms of continuous loading.
  // <200ms loads (cache hits / fast network) skip skeleton entirely to avoid flash.
  const showSkeleton = useDelayedLoading(loading, 200);
  // ★ blockedCount は元々 BlockedTagBanner で表示していたが、ホームから外したため未使用
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
  // ★ Background prefetch — feed first paint 後に隣接タブのデータを idle 時間で先読み。
  //   React Query の cache に乗るので、ユーザーが /notifications や /mypage を tap した
  //   瞬間に「白画面 → spinner → データ」ではなく即表示できる。
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

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

  // ★ Idle prefetch — feed が settle (loading=false) してから 1.5s 後に
  //   隣接タブ用 query を裏で温めておく。tap した瞬間にデータが既に cache にある状態を作る。
  //
  //   pre-warm 対象:
  //     1. ['notifications']                — 通知タブ tap で即表示 (fetchNotifications 内部で limit 50)
  //     2. ['mypage-stats', userId]         — マイページ Hero (post_count / nickname / avatar)
  //
  //   既に _layout.tsx で 'my-communities' / 'my-community-feed-rich' は prewarm 済なので
  //   ここでは重複させない (二重 fetch 防止 + staleTime 30s と整合)。
  //
  //   ガード:
  //     - loading 中はスキップ (feed 自体のクリティカルパスを邪魔しない)
  //     - userId が無ければ全 skip (auth-gated query)
  //     - cleanup で setTimeout 解除 — fast unmount 時に余計な network を出さない
  useEffect(() => {
    if (loading) return;
    if (!userId) return;
    const id = setTimeout(() => {
      // 通知 top N — fetchNotifications は内部で .limit(50) しているため
      // 「最新通知バッジ + 一覧の最初の chunk」をまとめて温められる。
      void qc.prefetchQuery({
        queryKey: ['notifications'],
        queryFn: fetchNotifications,
        staleTime: 60_000,
      });
      // マイページ Hero — profiles 1 行だけなので軽量。
      // queryKey / queryFn / staleTime は app/(tabs)/mypage.tsx の useQuery と完全一致させる
      // (mount 時に refetchOnMount=false で cache hit させるため key の形が合っていないと無意味)。
      void qc.prefetchQuery({
        queryKey: ['mypage-stats', userId],
        queryFn: async () => {
          const { data } = await supabase
            .from('profiles')
            .select('post_count, like_received_count, comment_count, concern_received_count, created_at, nickname, avatar_emoji, avatar_url')
            .eq('id', userId)
            .single();
          return data;
        },
        staleTime: 60_000,
      });
    }, 1500);
    return () => clearTimeout(id);
  }, [loading, userId, qc]);

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

  // ============================================================
  // ★ Viewport + Scroll velocity ベースの画像 prewarm
  // ------------------------------------------------------------
  // 設計:
  //   1) **基本 lookahead = 3 セル** — 半分以上見えてる viewableItem の
  //      最後の index から 3 つ先まで prefetch (静止 / 緩やか scroll 用)。
  //   2) **velocity-aware**: scroll px/s に応じて lookahead を 3 → 最大 10 に拡張。
  //      閾値: |v| > 800 px/s で 6、|v| > 1600 px/s で 10。
  //   3) **concurrency cap = 4**: 同時 prefetch を 4 まで。browser は host あたり
  //      6 で詰まるので 4 に絞ると CPU / JS スレッドを食わない。
  //   4) **dedup**: 既に prefetch 試行した URL は Set でスキップ。
  //
  //   思想: 「次に見える 1-3 枚は絶対欲しい (UX 直結) / 速く scroll してる時だけ
  //          先読み深くする (帯域とトレードオフ)」
  // ============================================================
  const PREFETCH_BASE_LOOKAHEAD = 3;       // 静止〜緩や scroll: 3 セル先
  const PREFETCH_FAST_LOOKAHEAD = 6;       // |v| > 800: 6 セル先
  const PREFETCH_FLING_LOOKAHEAD = 10;     // |v| > 1600: 10 セル先 (フリック)
  const PREFETCH_VELOCITY_FAST = 800;      // px/s
  const PREFETCH_VELOCITY_FLING = 1600;    // px/s
  const PREFETCH_CONCURRENCY_CAP = 4;      // 同時 prefetch 最大数

  // 速度トラッキング — render に影響を与えたくないので ref で管理 (state にすると
  // 毎 scroll で feed 全体が re-render してしまう)
  const lastScrollYRef = useRef(0);
  const lastScrollTRef = useRef(0);
  const scrollVelocityRef = useRef(0);

  // dedup + concurrency 制御 — 試行済 URL を Set、in-flight 数を number で管理
  const prefetchedUrlsRef = useRef<Set<string>>(new Set());
  const inFlightCountRef = useRef(0);

  const enqueuePrefetch = useCallback((url: string) => {
    if (!url) return;
    if (prefetchedUrlsRef.current.has(url)) return;
    if (inFlightCountRef.current >= PREFETCH_CONCURRENCY_CAP) return;
    prefetchedUrlsRef.current.add(url);
    inFlightCountRef.current += 1;
    // expo-image の prefetch は Promise を返す — settle で counter を戻して
    // 次の prefetch を許可する。失敗 URL も dedup されてるので無限再試行はしない。
    Promise.resolve()
      .then(() => ExpoImage.prefetch(url, 'memory-disk'))
      .catch(() => { /* ignore — viewer 側で再 fetch される */ })
      .finally(() => {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      });
  }, []);

  // feedItems の宣言後に定義する必要がある (依存している)
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length === 0) return;
      const lastIdx = Math.max(...viewableItems.map((v) => v.index ?? 0));
      const absV = Math.abs(scrollVelocityRef.current);
      const lookahead =
        absV > PREFETCH_VELOCITY_FLING
          ? PREFETCH_FLING_LOOKAHEAD
          : absV > PREFETCH_VELOCITY_FAST
            ? PREFETCH_FAST_LOOKAHEAD
            : PREFETCH_BASE_LOOKAHEAD;
      const slice = feedItems.slice(lastIdx + 1, lastIdx + 1 + lookahead);
      for (const item of slice) {
        if (isAdItem(item)) continue;
        const urls = item.media_urls ?? [];
        for (const u of urls) {
          // 480 で AnonPostCard 側の ProgressiveImage thumbWidth と揃える
          // (URL が完全一致しないと cache hit しない — 揃えれば prefetch が活きる)
          enqueuePrefetch(thumbedUrl(u, 480));
        }
      }
    },
    [feedItems, enqueuePrefetch],
  );

  // スクロール速度トラッキング — onScroll は 16ms throttle 想定 (60fps)。
  // dt が 0 の最初のサンプルは無視。state に書かないので余計な re-render なし。
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const now = Date.now();
    const prevT = lastScrollTRef.current;
    if (prevT > 0) {
      const dt = now - prevT;
      if (dt > 0) {
        const dy = y - lastScrollYRef.current;
        // px/s — 16ms 単位だと 1px の dy でも 62.5 px/s なので、スパイク抑制に
        // simple low-pass (0.7 既存 + 0.3 新規) を当てる
        const instant = (dy / dt) * 1000;
        scrollVelocityRef.current =
          scrollVelocityRef.current * 0.7 + instant * 0.3;
      }
    }
    lastScrollYRef.current = y;
    lastScrollTRef.current = now;
  }, []);

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
  // ★ BlockedTagBanner はユーザー要望でホームから削除済み (フィルタ画面 /filter で確認可能)
  const ListHeader = useMemo(() => (
    <View>
      <TrendingRow />
    </View>
  ), []);

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
        // ★ scroll velocity tracking: 16ms (60fps) で sample → handleScroll で
        //   ref に書き込み (state ではない → re-render なし)。viewability コールバック
        //   が velocity を読んで lookahead 量を 3/6/10 に切替える。
        onScroll={handleScroll}
        scrollEventThrottle={16}
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
            showSkeleton ? <FeedSkeleton /> : null
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
