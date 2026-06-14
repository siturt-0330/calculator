import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  Platform,
  StyleSheet,
  ActivityIndicator,
  InteractionManager,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
// ★ FlashList v2 パイロット (検証ロールアウト・既定OFF): alias 'flash-list-v2' = @shopify/flash-list@2。
import { FlashList as FlashListV2Raw } from 'flash-list-v2';
import { Image as ExpoImage } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { fetchNotifications } from '../../lib/api/notifications';
import { fetchProfileStatsFull } from '../../lib/api/profile';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useScrollToTop } from '@react-navigation/native';
import {
  HomeDrawer,
  HOME_DRAWER_SPRING,
  HOME_DRAWER_DIST_THRESHOLD,
  HOME_DRAWER_VEL_THRESHOLD,
  HOME_DRAWER_EDGE_GRAB,
  getHomeDrawerWidth,
} from '../../components/nav/HomeDrawer';
import { haptic as triggerHaptic } from '../../lib/haptics';
import { EASE_OUT_QUART, TIMING_NORM, clampHandoff } from '../../design/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useNavigation, useLocalSearchParams } from 'expo-router';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useFeed } from '../../hooks/useFeed';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { markStartupOnce } from '../../lib/perf';
// BlockedTagBanner はホームから削除済。旧 scope='選択タグのみ' 時代の useTagFilterStore
// 購読も 2026-06-12 の scope 意味変更 (未参加コミュ) で不要になり撤去。
// 参加コミュ一覧 (未参加 filter 用) は fetchMyCommunities の cache を共有。
import { fetchMyCommunities } from '../../lib/api/communities';
import { useLike, useLikes } from '../../hooks/useLike';
import { useConcern, useConcerns } from '../../hooks/useConcern';
import { useSave, useSaves } from '../../hooks/useSave';
import { useShare } from '../../hooks/useShare';
import { ReportSheet } from '../../components/post/ReportSheet';
import { AccountStateBanner } from '../../components/account/AccountStateBanner';
import { useReactions, useReactionToggle } from '../../hooks/useReactions';
import { useAddedTags, useAddTag } from '../../hooks/useAddedTags';
import { usePolls } from '../../hooks/usePolls';
import { useFeedPage } from '../../hooks/useFeedPage';
import { useFeedRealtime } from '../../hooks/useFeedRealtime';
import { useUnreadCount } from '../../hooks/useNotifications';
import { useTabBarScrollSV } from '../../lib/contexts/tabBarScroll';
import { NotificationBadge } from '../../components/ui/NotificationBadge';
import { GeekRefreshControl } from '../../components/ui/GeekRefreshControl';
import { useToastStore } from '../../stores/toastStore';
import { useFeedStore, type FeedScope } from '../../stores/feedStore';
import { AnonPostCard } from '../../components/feed/AnonPostCard';
import { AdCard } from '../../components/feed/AdCard';
import type { Ad } from '../../lib/api/ads';

// フィード上の item — 通常 post か広告アイテム (__ad マーカー付き)
type AdItem = { __ad: true; ad: Ad; position: number; matchedTags: string[]; key: string };
type FeedItem = Post | AdItem;
const isAdItem = (it: FeedItem): it is AdItem => (it as AdItem).__ad === true;

// MeProfileLite は lib/api/profile.ts の ProfileStats に統合済み

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

// handlersByPostId の値型 — 明示的な型アノテーションで安全性を向上
interface PostHandlers {
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
}
// legacy hook 群が disabled (postIds=[]) のときの空マップ — 参照安定化
const EMPTY_BOOL_MAP: Record<string, boolean> = {};
const VIEWABILITY_CONFIG = { viewAreaCoveragePercentThreshold: 30 } as const;

// ============================================================
// FeedRowEnter — per-row 入場アニメ (opacity 0→1 + translateY 12→0)
// ------------------------------------------------------------
// 220ms ease-out-quart, stagger index*40ms (上限 6 cell = 240ms 上限) で、
// 50+ items でも 2 秒待ちにならないよう cap している。
// ★ animate=false なら即表示 (アニメ・delay 一切なし)。
//   親 (FeedScreen) は「画面 mount から 1.5s 以内」だけ animate=true を渡す。
//   理由 [scroll perf 監査 2026-06-12 確証]: FlashList はスクロールで cell pool を
//   拡張する際に新規 mount が起き、旧実装 (無条件アニメ) では高速スクロール中の
//   新セルが「opacity 0 で出現 → 遅れてフェードイン」して知覚的な重さ + アニメ
//   コストを生んでいた。入場演出は初回表示の 1.5s だけで十分。
// reduceMotion=true も即表示。
// ============================================================
const ROW_ENTER_DURATION = 220;
const ROW_ENTER_STAGGER_MS = 40;
const ROW_ENTER_STAGGER_CAP = 6; // index*40 を最大 240ms に
const ROW_ENTER_WINDOW_MS = 1500; // 画面 mount からこの間だけ入場アニメを再生
const FeedRowEnter = memo(function FeedRowEnter({
  index,
  animate,
  children,
}: {
  index: number;
  // false なら初期値 1/0 で即表示 (高速スクロール中の新規 mount cell 用)
  animate: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const play = animate && !reduceMotion;
  const opacity = useSharedValue(play ? 0 : 1);
  const translateY = useSharedValue(play ? 12 : 0);

  // アニメ開始は mount 後の effect で行う。render 中に shared value を書くと
  // React 並行モードの二重 invocation でアニメが走らない問題が起きる。
  useEffect(() => {
    if (!play) return;
    const delay = Math.min(index, ROW_ENTER_STAGGER_CAP) * ROW_ENTER_STAGGER_MS;
    const cfg = { duration: ROW_ENTER_DURATION, easing: EASE_OUT_QUART };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    translateY.value = withDelay(delay, withTiming(0, cfg));
  // mount once のみ — play/index/opacity/translateY は初回アニメ専用で再実行不要
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
});

import { ScopeToggle } from '../../components/feed/ScopeToggle';
import { ContestList } from '../../components/contest/ContestList';
import { logEvent } from '../../lib/personalize';
import { recordImpression } from '../../lib/personalize/impressions';
import { PostCardSkeleton } from '../../components/feed/PostCardSkeleton';
import { TrendingRow } from '../../components/feed/TrendingRow';
import { PressableScale } from '../../components/ui/PressableScale';
import { Menu as MenuIcon } from 'lucide-react-native';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon } from '../../constants/icons';
import { SP, isLightActive } from '../../design/tokens';
import { useTheme } from '../../hooks/useColors';
import { LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import { LinearGradient } from 'expo-linear-gradient';
import type { Post } from '../../types/models';

// フィードヘッダー — 依存なし・毎 render で新しい JSX を作ると TrendingRow が
// remount されるため、モジュールスコープの定数として安定化する。
const LIST_HEADER_ELEMENT = (
  <View>
    <AccountStateBanner />
    <TrendingRow />
  </View>
);

// ============================================================
// モジュールスコープ定数 — viewport + scroll velocity 画像 prewarm 設定
// ============================================================
/** 静止〜緩やか scroll: 3 セル先まで prefetch */
const PREFETCH_BASE_LOOKAHEAD = 3;
/** |v| > PREFETCH_VELOCITY_FAST: 6 セル先 */
const PREFETCH_FAST_LOOKAHEAD = 6;
/** |v| > PREFETCH_VELOCITY_FLING: 10 セル先 (フリック) */
const PREFETCH_FLING_LOOKAHEAD = 10;
/** fast scroll 閾値 (px/s) */
const PREFETCH_VELOCITY_FAST = 800;
/** fling scroll 閾値 (px/s) */
const PREFETCH_VELOCITY_FLING = 1600;
/** 同時 prefetch 最大数 — browser は host あたり 6 で詰まるので 4 に絞る */
const PREFETCH_CONCURRENCY_CAP = 4;

// 右スワイプ中の `progress` 更新を worklet で行うためのヘルパー。
// dx (右方向への絶対距離) と drawer 幅から 0..1 へ写像してクランプ。
// useMemo 内で worklet 化される使い方なので 'worklet' 指定。
function progressFromDx(
  dx: number,
  width: number,
  progress: { value: number },
): void {
  'worklet';
  const next = dx / Math.max(1, width);
  progress.value = Math.max(0, Math.min(1, next));
}

// ★ FlashList v2 パイロット (検証ロールアウト・既定OFF):
//   EXPO_PUBLIC_FLASHLIST_V2='1' のときだけ feed のリストを v2 (自動測定で estimatedItemSize 不要・
//   maintainVisibleContentPosition 既定ON) に切替える。v2 を v1 の型として扱う薄いブリッジにすることで
//   余剰 props (estimatedItemSize 等) は v2 側で無視される (無害)。本番既定は従来の v1 (1.7.3) のまま。
//   feed 1 画面のみのパイロット — 実機/実ビルドで blank 率・スクロール追従を v1/v2 で A/B 検証する用途。
const FLASHLIST_V2_ENABLED = process.env.EXPO_PUBLIC_FLASHLIST_V2 === '1';
const FeedListComponent = FLASHLIST_V2_ENABLED
  ? (FlashListV2Raw as unknown as typeof FlashList)
  : FlashList;

// タブ即時表示: feed (landing・常時マウント) 内で first paint 後 idle に隣接タブを v7 の
// navigation.preload() で事前マウントする。preload された route は freezeOnBlur の
// !isPreloaded 除外で生きたまま背面に置かれ、タブを開いた瞬間に表示される。
// (旧 lazyPreloadDistance は v7 で no-op だったため撤去 → これが実プリロードの代替)。
// search の重い Discovery fetch は useIsFocused ゲートで preload 中は撃たない (search.tsx)。
type TabsParamList = { feed: undefined; search: undefined; community: undefined; mypage: undefined };
function TabPreloader() {
  // feed タブ画面内で呼ぶので useNavigation は bottom-tab navigator を指す
  // (root stack の app/search.tsx に誤爆しない)。
  const nav = useNavigation<BottomTabNavigationProp<TabsParamList>>();
  useEffect(() => {
    let cancelled = false;
    const g = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    // first paint / 初回フェッチと帯域を食い合わせないよう idle に逃がす。
    const idle = (fn: () => void): (() => void) => {
      if (typeof g.requestIdleCallback === 'function') {
        const id = g.requestIdleCallback(fn, { timeout: 3000 });
        return () => g.cancelIdleCallback?.(id);
      }
      const h = InteractionManager.runAfterInteractions(fn);
      return () => h.cancel();
    };
    // 1 マウント=1 長タスク化で INP を汚さないよう search と community を別 idle に分割。
    let cancelInner: (() => void) | undefined;
    const cancelOuter = idle(() => {
      if (cancelled) return;
      nav.preload('search');
      cancelInner = idle(() => {
        if (!cancelled) nav.preload('community');
      });
    });
    return () => {
      cancelled = true;
      cancelOuter();
      cancelInner?.();
    };
  }, [nav]);
  return null;
}

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // テーマ購読 — light/dark 切替で feed 画面が自動再 render される
  const { C, GRAD } = useTheme();

  // ============================================================
  // ★ HomeDrawer (X 風の左ドロワー) — 右スワイプで open / 左スワイプで close
  // ------------------------------------------------------------
  //   - progress: 0=closed, 1=open の shared value (Reanimated worklet)
  //   - drawerOpen: 同期 boolean (FlashList の scroll lock 用)
  //   - openSwipe gesture: 画面左端 24pt 以内から開始した右ドラッグだけ active
  //     (左端 grab 以外は FlashList の縦 scroll を邪魔しない)
  // ============================================================
  const { width: WW } = useWindowDimensions();
  // デスクトップ (Web ≥1100) は LeftSidebar がナビを担うので ☰ + HomeDrawer は出さない。
  // (旧: ☰ が常時表示で HomeDrawer を開けるが、PC では × もスワイプ閉じも無く
  //  「サイドバーを押すと戻れない」状態になっていた)
  const isDesktop = Platform.OS === 'web' && WW >= 1100;
  const DRAWER_WIDTH = getHomeDrawerWidth(WW);
  const drawerProgress = useSharedValue(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ★ PC / アクセシビリティ対策: 右スワイプできない環境 (デスクトップ Web など) でも
  //   ヘッダー左上のアバターボタンから明示的にドロワーを開けるようにする。
  // ボタン起動は指の velocity を持たないため、初速0の spring (緩→加速→僅かに行き過ぎる
  // S 字) より一定時間の ease-out timing の方がキレ良く吸い付く。lock は即時。
  const openDrawer = useCallback(() => {
    triggerHaptic('tap');
    setDrawerOpen(true);
    drawerProgress.value = withTiming(1, TIMING_NORM);
  }, [drawerProgress]);

  // 画面左端 24pt 以内から右にスワイプで open。drawerOpen=true のときは無効化
  // (HomeDrawer 内部の close gesture が担当)。
  const openGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isDesktop) // デスクトップは LeftSidebar を使うため開くスワイプを無効化
        .activeOffsetX([-9999, 10]) // 右方向に 10pt 以上動いたら active
        .failOffsetY([-15, 15])       // 縦に 15pt 以上動いたら fail (scroll に道を譲る)
        // 左端 grab 範囲外で開始した swipe は onChange / onEnd の startX 判定で無視。
        // Gesture API には onBegin から fail させる手段が無いため、効果的には no-op。
        .onChange((e) => {
          'worklet';
          // 開いてる状態は close gesture 側に任せて何もしない
          if (drawerProgress.value > 0.99) return;
          // 左端 grab 範囲: x の出発点が DRAWER_EDGE_GRAB 内
          // gesture e.x は currently absolute X of the active touch
          // 出発点は (e.x - e.translationX) で復元できる
          const startX = e.x - e.translationX;
          if (startX > HOME_DRAWER_EDGE_GRAB) return;

          // 右へのドラッグだけ追従。負値 (左) は 0 でクランプ
          const dx = Math.max(0, e.translationX);
          progressFromDx(dx, DRAWER_WIDTH, drawerProgress);
        })
        .onEnd((e) => {
          'worklet';
          if (drawerProgress.value > 0.99) return;
          const startX = e.x - e.translationX;
          // 指の速度 (px/s) を progress/s に正規化してバネに引き継ぐ → 段付き解消。
          const vNorm = e.velocityX / DRAWER_WIDTH;
          // 左端 grab 範囲外で始まった場合は何もせず spring で戻す
          if (startX > HOME_DRAWER_EDGE_GRAB) {
            drawerProgress.value = withSpring(0, {
              ...HOME_DRAWER_SPRING,
              velocity: clampHandoff(vNorm, 0),
            });
            return;
          }
          const shouldOpen =
            e.translationX > HOME_DRAWER_DIST_THRESHOLD ||
            e.velocityX > HOME_DRAWER_VEL_THRESHOLD;
          if (shouldOpen) {
            // コミット確定時に即 lock (spring 完了待ちにしない) → 開アニメ中の縦 scroll
            // 競合を断ち、着地フレームの再 render カクつきも排除。
            runOnJS(setDrawerOpen)(true);
            drawerProgress.value = withSpring(1, {
              ...HOME_DRAWER_SPRING,
              velocity: clampHandoff(vNorm, 1),
            });
            runOnJS(triggerHaptic)('tap');
          } else {
            drawerProgress.value = withSpring(0, {
              ...HOME_DRAWER_SPRING,
              velocity: clampHandoff(vNorm, 0),
            });
          }
        }),
    [DRAWER_WIDTH, drawerProgress, isDesktop],
  );

  // feed content を drawer width 分 右に push する animated style
  const feedContentStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          drawerProgress.value,
          [0, 1],
          [0, DRAWER_WIDTH],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));
  const { posts, reasonsMap, communitiesByPost, ads, interestTags, loading, isError, loadingMore, refreshing, refresh, loadMore } = useFeed();
  // Smart skeleton timing — skeleton only after 200ms of continuous loading.
  // <200ms loads (cache hits / fast network) skip skeleton entirely to avoid flash.
  const showSkeleton = useDelayedLoading(loading, 200);
  const scope = useFeedStore((s) => s.scope);
  const setScope = useFeedStore((s) => s.setScope);
  const hydrateFeed = useFeedStore((s) => s.hydrate);

  // ★ URL の ?scope= を view 状態に同期 (2026-06-14)。
  //   コンテスト一覧を URL で表せるようにして、ブックマーク / 共有 / ブラウザ「戻る」を機能させる。
  //   contest→closed / home(=open)。素のタブ tap (param 無し) は hydrate 済みの永続値を尊重。
  //   ref で「適用済み param」を記録し、param が実際に変化した時だけ反映する
  //   (= ユーザーの手動トグルと喧嘩しない。scope を deps に入れると上書き合戦になるため入れない)。
  const params = useLocalSearchParams<{ scope?: string }>();
  const appliedScopeParamRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const p = typeof params.scope === 'string' ? params.scope : undefined;
    if (p === appliedScopeParamRef.current) return;
    appliedScopeParamRef.current = p;
    if (p === 'contest') setScope('closed');
    else if (p === 'home' || p === 'open') setScope('open');
  }, [params.scope, setScope]);

  // ScopeToggle / 各導線から呼ぶ scope 変更。store を即更新しつつ URL param も同期し、
  //   現在の view (すべて / コンテスト) がブックマーク・共有 URL に反映されるようにする。
  //   setParams は history を積まない (replace) ので手動トグルで戻る履歴を汚さない。
  const handleScopeChange = useCallback(
    (next: FeedScope) => {
      setScope(next);
      appliedScopeParamRef.current = next === 'closed' ? 'contest' : 'home';
      router.setParams({ scope: next === 'closed' ? 'contest' : 'home' });
    },
    [setScope, router],
  );
  // ★ Background prefetch — feed first paint 後に隣接タブのデータを idle 時間で先読み。
  //   React Query の cache に乗るので、ユーザーが /notifications や /mypage を tap した
  //   瞬間に「白画面 → spinner → データ」ではなく即表示できる。
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  // mypage-stats のキャッシュ温めは下の idle prefetch effect (setTimeout 1500ms) で
  // fetchProfileStatsFull を使って一元化済み。ここで重複 useQuery は不要。

  // ★ scope='closed' = 「未参加コミュの投稿のみ」(2026-06-12 意味変更・発見モード)。
  //   旧「選択した # のみ」時代の "タグ無しなら open へ強制" effect は撤去。
  //   自分の参加コミュ一覧は community タブ/_layout prewarm と同一 key の cache を共有。
  const { data: myCommunities } = useQuery({
    queryKey: ['my-communities', userId],
    queryFn: fetchMyCommunities,
    enabled: !!userId,
    staleTime: 30_000,
  });
  const myCommunityIdSet = useMemo(
    () => new Set((myCommunities ?? []).map((c) => c.id)),
    [myCommunities],
  );
  // 未ログイン (参加 0) は「全コミュ投稿が未参加」扱いで OK。
  // ログイン済みは my-communities 解決を待ってから filter (誤って全部出すのを防ぐ)。
  const myCommunitiesReady = !userId || myCommunities !== undefined;
  const { toggle: toggleLike } = useLike();
  const { toggle: toggleConcern } = useConcern();
  const { toggle: toggleSave } = useSave();
  const { toggle: toggleReact } = useReactionToggle();
  const unreadCount = useUnreadCount();
  const { share } = useShare();
  const listRef = useRef<FlashList<FeedItem>>(null);
  // ホームタブを再タップで listRef を先頭にスクロール (X / Instagram と同等の挙動)。
  // TabBar 側で focused 時に router.navigate で root へ戻すのと合わせて、
  // 「再タップ = 先頭 + ルート」が成立する。
  useScrollToTop(listRef as unknown as React.RefObject<{ scrollToOffset: (p: { offset: number; animated?: boolean }) => void }>);
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
        queryKey: ['notifications', userId],
        queryFn: fetchNotifications,
        staleTime: 60_000,
      });
      // マイページ Hero — profiles 1 行だけなので軽量。
      // queryKey / queryFn / staleTime は app/(tabs)/mypage.tsx の useQuery と完全一致させる
      // (mount 時に refetchOnMount=false で cache hit させるため key の形が合っていないと無意味)。
      // fetchProfileStatsFull は mypage.tsx の fetchProfileStats と同一 SELECT を持つ共通関数。
      void qc.prefetchQuery({
        queryKey: ['mypage-stats', userId],
        queryFn: () => fetchProfileStatsFull(userId),
        staleTime: 60_000,
      });
    }, 1500);
    return () => clearTimeout(id);
  }, [loading, userId, qc]);

  // ★ リロード/タブ復帰のたびに最新投稿を反映 (ユーザー要望: 投稿push通知ではなく
  //   「リロードするたびに新着が出る」)。focus 時に ['feed'] を invalidate → page1 を
  //   取り直し新着が出る (staleTime:0 と協調)。コミュタブと同じ手法。
  // ★ 毎フォーカスで invalidate すると For-You が時刻シードのランクで毎回並び替わり、
  //   タブ往復のたびに(新着が無くても)下の投稿がチラチラ入れ替わる。直近 30s 以内の
  //   再フォーカスは skip し、明示更新は pull-to-refresh に委ねる。
  const lastFeedFocusRefreshRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFeedFocusRefreshRef.current < 30_000) return;
      lastFeedFocusRefreshRef.current = now;
      void qc.invalidateQueries({ queryKey: ['feed'] });
    }, [qc]),
  );

  // 起動計測: feed が初めて実コンテンツを描画した時刻を 1 度だけ記録 (cross-platform な TTI 近似)。
  // markStartupOnce が内部で重複を弾くので毎 render 評価でも送信は 1 回きり。native の唯一の起動シグナル。
  useEffect(() => {
    if (!loading && posts.length > 0) markStartupOnce('feed_first_content');
  }, [loading, posts.length]);

  // posts は毎 render で新しい配列参照になる (data?.pages.flatMap 経由)。
  // ID リストの中身が変わらない限り再計算したくないので、id を join したハッシュで
  // 安定化する。これで下流の useQuery/useMemo が ID 集合が同じ render では
  // 再評価されない。
  // ★ perf: postIdsHash も useMemo 内で計算 — render body で毎回 map+join が走るのを防ぐ
  const postIdsHash = useMemo(() => posts.map((p) => p.id).join('|'), [posts]);
  const postIds = useMemo(() => posts.map((p) => p.id), [postIdsHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- RPC 経路: get_feed_page で周辺データを 1 RTT で取得 ---
  // 旧 6 hook (useLikes/useConcerns/useSaves/useReactions/useAddedTags/usePolls)
  // を 1 RPC に統合。失敗 / ENV flag 無効時は legacy hook 群へフォールバック。
  // rpcLoading / rpcEmpty は使わない (旧 fallback ロジック用) — 上記コメント参照。
  const { fullPosts, isDisabled: rpcDisabled, isEmpty: rpcEmpty } = useFeedPage(postIds);

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
  // ★ 安全網 (2026-06): RPC が無効 (ENV flag) または「成功したのに 0 件 (= pseudonym_id 列欠落等で
  //   degrade して空配列が返る)」のとき、legacy hook 群へフォールバックして反応(スタンプ)/いいね等が
  //   消えないようにする。正常時 (RPC が周辺データを返す) は rpcEmpty=false なので従来どおり legacy は走らない。
  const useLegacy = rpcDisabled || rpcEmpty;
  const legacyIds = useLegacy ? postIds : EMPTY_LEGACY_IDS;

  const { data: legacyMyLikes = EMPTY_BOOL_MAP } = useLikes(legacyIds);
  const { data: legacyMyConcerns = EMPTY_BOOL_MAP } = useConcerns(legacyIds);
  const { data: legacyMySaves = EMPTY_BOOL_MAP } = useSaves(legacyIds);
  const { data: legacyReactions } = useReactions(legacyIds);
  const { data: legacyAddedTags } = useAddedTags(legacyIds);
  const { polls: legacyPolls } = usePolls(legacyIds);
  const { addTag } = useAddTag();
  const showToast = useToastStore((s) => s.show);

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

  // コミュニティページへの遷移 — post に依存しないので単一の安定コールバックとして定義。
  // per-post dict の中で毎回 arrow を作ると posts 変化時に全カードが新 handler を受け取る。
  const handleCommunityPress = useCallback((communityId: string) => {
    router.push(`/community/${communityId}` as never);
  }, [router]);

  // ★ perf: postsRef で「最新の posts 配列」をクロージャ外から読む。
  //   handlersByPostId の deps を posts → postIds に変えることで、同じ ID セットを
  //   持つ background refetch (参照は変わるが内容は同じ) で全ハンドラが再生成される
  //   のを防ぐ。ハンドラ内で tag_names などの最新データが必要な場合は postsRef.current
  //   から逆引きする。
  const postsRef = useRef(posts);
  postsRef.current = posts;

  // Per-post handler cache. Rebuilds when `postIds` (stable ID set) or upstream callbacks
  // change, but NOT when posts array reference changes due to background refetch with same IDs.
  // This prevents every AnonPostCard from receiving new handler refs on each background refetch.
  //
  // onConcern は「現在の concerned 状態」を引数に取る — RPC fullPosts を最優先で
  // 参照、無ければ legacy の myConcerns map を見る。両方とも空でも問題なし
  // (toggleConcern は false を受けて INSERT 試行 → unique violation で安全に冪等)。
  const handlersByPostId = useMemo((): Record<string, PostHandlers> => {
    const dict: Record<string, PostHandlers> = {};
    for (const id of postIds) {
      // クロージャが postsRef.current を毎回読むので、background refetch 後も
      // 最新の tag_names を参照できる (stale closure にならない)。
      const getTagNames = () => postsRef.current.find((p) => p.id === id)?.tag_names ?? [];
      dict[id] = {
        onLike: () => {
          void logEvent({ kind: 'post_like', tags: getTagNames(), post_id: id });
          toggleLike(id);
        },
        onConcern: () => {
          void logEvent({ kind: 'post_concern', tags: getTagNames(), post_id: id });
          // current は useConcern 内部で cache から判定 (smart-queue + race-safe)
          toggleConcern(id);
        },
        onComment: () => {
          void logEvent({ kind: 'post_view', tags: getTagNames(), post_id: id, dwell_ms: 0 });
          router.push(`/post/${id}` as never);
        },
        onSave: () => {
          void logEvent({ kind: 'post_save', tags: getTagNames(), post_id: id });
          toggleSave(id);
        },
        onShare: () => share(`Geek の投稿 #${getTagNames()[0] ?? '雑談'}`, `/post/${id}`),
        onTagPress: (name: string) => {
          void logEvent({ kind: 'tag_click', tags: [name] });
          router.push(`/tag/${encodeURIComponent(name)}` as never);
        },
        onMore: () => setReportPostId(id),
        onReact: (meme: string) => toggleReact(id, meme),
        onAddTag: (tag: string) => handleAddTag(id, tag),
        onCommunityPress: handleCommunityPress,
      };
    }
    return dict;
  }, [postIds, toggleLike, toggleConcern, toggleSave, toggleReact, share, router, handleAddTag, handleCommunityPress]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------
  // posts + ads を 1 つの混在配列にマージ
  // -------------------------------------------------------------------
  // 8 件ごとに 1 つ広告を差し込む (8, 17, 26, ...) — ads が足りなければそこで終わり。
  // ad item は __ad プレフィックス + index の安定 key を持つ (ad.id が同じでも
  // 別ポジションに同一広告が出る場合に React のキー衝突を避ける)。
  // ★ scope='closed' (未参加コミュのみ・発見モード 2026-06-12):
  //   「コミュニティ付きの投稿」かつ「どのコミュにも参加していない」ものだけ残す。
  //   コミュ無し投稿は対象外 (発見モードの趣旨 = 新しいコミュとの出会い)。
  //   my-communities 解決前は素通し (一瞬の全消えと誤表示を防ぐ)。
  const scopedPosts = useMemo<Post[]>(() => {
    if (scope !== 'closed' || !myCommunitiesReady) return posts;
    return posts.filter((p) => {
      const comms = communitiesByPost[p.id];
      if (!comms || comms.length === 0) return false;
      return comms.every((c) => !myCommunityIdSet.has(c.community_id));
    });
  }, [posts, scope, communitiesByPost, myCommunityIdSet, myCommunitiesReady]);

  const feedItems = useMemo<FeedItem[]>(() => {
    const posts = scopedPosts;
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
  }, [scopedPosts, ads, interestTags]);

  // ============================================================
  // ★ Viewport + Scroll velocity ベースの画像 prewarm
  // ------------------------------------------------------------
  // 設計:
  //   1) **基本 lookahead = 3 セル** — 半分以上見えてる viewableItem の
  //      最後の index から 3 つ先まで prefetch (静止 / 緩やか scroll 用)。
  //   2) **velocity-aware**: scroll px/s に応じて lookahead を 3 → 最大 10 に拡張。
  //      閾値: |v| > PREFETCH_VELOCITY_FAST で 6、|v| > PREFETCH_VELOCITY_FLING で 10。
  //   3) **concurrency cap = PREFETCH_CONCURRENCY_CAP**: 同時 prefetch を 4 まで。
  //   4) **dedup**: 既に prefetch 試行した URL は Set でスキップ。
  //
  //   定数はモジュールスコープ (PREFETCH_BASE_LOOKAHEAD 等) で宣言済み。
  // ============================================================

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
    ({ viewableItems }: { viewableItems: Array<{ item: FeedItem; index: number | null }> }) => {
      if (viewableItems.length === 0) return;

      // ★ インプレッション記録 — For You フィードの再閲覧抑制と個人化フィードの改善に使う。
      //   viewableItems (30%以上表示) の各 post に対して recordImpression を呼ぶ。
      //   広告アイテムはスキップ。flushImpressions はアプリ終了/BG 時に呼ぶ想定。
      for (const v of viewableItems) {
        if (!isAdItem(v.item)) {
          recordImpression(v.item.id);
        }
      }

      // ★ perf: spread + map を for-of ループに置換 — 中間配列アロケーションを排除
      let lastIdx = 0;
      for (const v of viewableItems) {
        const idx = v.index ?? 0;
        if (idx > lastIdx) lastIdx = idx;
      }
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

  // TabBar shrink 用の scrollY SharedValue (Context 経由で共有)
  const tabBarScrollSV = useTabBarScrollSV();

  // スクロール速度トラッキング — onScroll は 16ms throttle 想定 (60fps)。
  // dt が 0 の最初のサンプルは無視。state に書かないので余計な re-render なし。
  // ⚠ ~60Hz の hot path — 同期軽処理のみ (setState / async / 重い計算の追加禁止)。
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      // TabBar が読む scrollY を更新 (shrink interpolation のソース)
      if (tabBarScrollSV) tabBarScrollSV.value = y;
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
    },
    [tabBarScrollSV],
  );

  // ★ perf (scroll 監査 2026-06-12): enrichedPost の参照キャッシュ。
  //   AnonPostCard の memo comparator は `prev.post !== next.post` の **参照比較** なので、
  //   renderItem 内で毎回 spread 生成すると親 re-render のたびに全 visible カードの
  //   memo が破れて再レンダしていた [実証済: comparator L1233]。
  //   入力 (base post 参照 + full 由来の merge フィールド) が変わらない限り
  //   同一オブジェクトを返して memo を効かせる。
  //   sig はタプル比較 (string 連結より安価で型も安全)。
  const enrichedCacheRef = useRef(
    new Map<string, { sig: readonly unknown[]; value: Post }>(),
  );

  // 入場アニメの再生 window — 画面 mount から ROW_ENTER_WINDOW_MS の間だけ true。
  // lazy init (render 中の ref 初期化は React 公式の許容パターン)。
  const rowEnterUntilRef = useRef<number | null>(null);
  if (rowEnterUntilRef.current === null) {
    rowEnterUntilRef.current = Date.now() + ROW_ENTER_WINDOW_MS;
  }
  const rowEnterActive = useCallback(
    () => Date.now() < (rowEnterUntilRef.current ?? 0),
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => {
      if (isAdItem(item)) {
        return (
          <FeedRowEnter index={index} animate={rowEnterActive()}>
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
      // ★ liked と同じく likes_count / comments_count も RPC cache (full) を優先する。
      //   base post は rank pipeline の memo が id ベースで再計算されず likes_count 変化に
      //   追従しない(= いいねしても数字が増えない bug)。full は useFeedPage の cache から
      //   毎 render 再生成され optimistic patch (patchFeedPagePost) で即時更新されるので新鮮。
      // de-anon Phase2: 投稿者アイデンティティ (avatar / pseudonym) も RPC cache (full)
      //   から merge して AnonPostCard に渡す (author_id 非依存で投稿者を主役表示するため)。
      let enrichedPost: Post;
      if (full) {
        const likes = full.likes_count ?? post.likes_count;
        const comments = full.comments_count ?? post.comments_count;
        const oa = full.official_author ?? undefined;
        const av = full.avatar_url ?? post.avatar_url ?? null;
        const ae = full.avatar_emoji ?? post.avatar_emoji ?? null;
        const pid = full.pseudonym_id ?? post.pseudonym_id ?? null;
        const sig = [post, likes, comments, oa, av, ae, pid] as const;
        const cached = enrichedCacheRef.current.get(post.id);
        if (cached && cached.sig.every((v, i) => v === sig[i])) {
          enrichedPost = cached.value;
        } else {
          enrichedPost = {
            ...post,
            likes_count: likes,
            comments_count: comments,
            ...(oa ? { official_author: oa } : {}),
            avatar_url: av,
            avatar_emoji: ae,
            pseudonym_id: pid,
          };
          enrichedCacheRef.current.set(post.id, { sig, value: enrichedPost });
        }
      } else {
        enrichedPost = post;
      }
      return (
        <FeedRowEnter index={index} animate={rowEnterActive()}>
          <AnonPostCard
            post={enrichedPost}
            isOwn={full?.is_own}
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
      rowEnterActive,
    ],
  );

  // ★ perf: static base style と Reanimated worklet style を useMemo で結合 —
  //   毎 render で新しい配列リテラルが生成されるのを防ぐ。C.bg はテーマ切替時のみ変化。
  const animatedViewStyle = useMemo(
    () => [{ flex: 1, backgroundColor: C.bg }, feedContentStyle],
    [C.bg, feedContentStyle],
  );

  // ★ perf: contentContainerStyle はインライン object だと毎 render で新参照が生成される。
  //   insets.bottom が変わる場合のみ再計算。
  const listContentStyle = useMemo(
    () => ({
      paddingTop: 0,
      paddingHorizontal: 0,
      paddingBottom: TABBAR.height + insets.bottom + SP['10'],
    }),
    [insets.bottom],
  );

  // ★ perf: FeedEmptyState の onAction / ReportSheet の onClose を useCallback で安定化
  //   FeedEmptyState と ReportSheet は React.memo のため、新しい関数参照が渡ると
  //   memo 比較が false になり不要な再 render が走る。
  const handleCreatePost = useCallback(() => router.push('/post/create' as never), [router]);
  const handleCloseReport = useCallback(() => setReportPostId(null), []);

  const Bell = Icon.bell;
  const Search = Icon.search;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TabPreloader />
      <GestureDetector gesture={openGesture}>
        <Animated.View style={animatedViewStyle}>
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
          {/* ★ 左上ハンバーガー = ドロワーを開くボタン (モバイルのみ)。
              三本横棒の menu アイコン。右スワイプできない環境向けの導線。
              デスクトップ (≥1100) は LeftSidebar がナビを担うため非表示にする
              (旧: 常時表示で HomeDrawer を開けてしまい、PC では閉じる手段が乏しく
               「サイドバーを押すと戻れない」状態になっていた)。 */}
          {!isDesktop && (
            <PressableScale
              onPress={openDrawer}
              hitSlop={10}
              haptic="tap"
              accessibilityRole="button"
              accessibilityLabel="メニューを開く"
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: SP['2'],
              }}
            >
              <MenuIcon size={24} color={C.text} strokeWidth={2.2} />
            </PressableScale>
          )}
          {/* 新規投稿 FAB はグローバル TabBar の「+」に一本化したため削除 (2026-05-29)。
              投稿作成導線は画面下の TabBar 右隣「+」円ボタンへ集約。 */}
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
                    // ★ 2026-06-13: ライト = フラットなチャコール (モノトーン)。
                    //   ダーク = ブランド確定グラデ GEEK_GRADIENT_CSS (紫→ピンク・水色なし)。
                    //   旧「紫→水色→ミント」は確定スプラッシュ (typography.ts) と不一致で
                    //   ユーザー指摘の「水色」混入の元だったため canonical に統一。
                    backgroundImage: isLightActive()
                      ? 'linear-gradient(110deg, #1d1d1f 0%, #1d1d1f 100%)'
                      : 'linear-gradient(120deg, #7C6AF7 0%, #B98CFF 48%, #E891C7 100%)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    textShadow: isLightActive()
                      ? 'none'
                      : '0 0 14px rgba(124,106,247,0.55), 0 0 28px rgba(232,145,199,0.25)',
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
        <ScopeToggle value={scope} onChange={handleScopeChange} />
        </View>
      </View>

      {/* ヘッダーとリストの境界 — 各投稿の下罫線と太さを揃えた hairline。
          (フラット化で投稿が全幅 hairline 区切りになったため、先頭境界も同じ細さに) */}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.divider }} />

      {/* 第2セグメント = コンテストタブ (store 値 'closed' を踏襲)。コンテスト一覧を
          表示する (フィード本体は scope==='open' 専用に保つ)。 */}
      {scope === 'closed' ? (
        <ContestList />
      ) : (
      <FeedListComponent
        ref={listRef}
        data={feedItems}
        drawDistance={600}
        // 慣性スクロールの減速を速める — bbs / tag / liked と同値に統一 (キレのある停止感)。
        // ScrollView pass-through prop で recycling / layout に影響しない。Web は no-op。
        decelerationRate="fast"
        // drawer open 中は scroll を lock — drawer の左 swipe close と FlashList の
        // 垂直 scroll が両方走ると親 GestureDetector との競合が出るため。
        scrollEnabled={!drawerOpen}
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
        // ★ perf: estimatedItemSize を実測 P75 に近い値に調整。
        // 520 は text-only post の下限に近く、メディア付き post では 650-700px になる。
        // 過小見積もりだと FlashList の overscan バッファが小さくなり fast scroll で blank が出る。
        // 640 は mixed feed (text+media) の P50/P75 に近い経験値。
        estimatedItemSize={640}
        ListHeaderComponent={LIST_HEADER_ELEMENT}
        refreshControl={
          // ★ brand polish: OS 既定 spinner を Geek の brand gradient tint に置換 (mypage と同じ使い方)
          <GeekRefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: SP['5'], alignItems: 'center' }}>
              <ActivityIndicator size="small" color={C.accent} />
            </View>
          ) : null
        }
        contentContainerStyle={listContentStyle}
        ListEmptyComponent={
          <FeedEmptyState
            loading={loading}
            isError={isError}
            showSkeleton={showSkeleton}
            scope={scope}
            onAction={handleCreatePost}
            onRetry={refresh}
          />
        }
      />
      )}

      {/* 通報シート (運営への通報・理由選択) */}
      <ReportSheet
        visible={!!reportPostId}
        postId={reportPostId}
        onClose={handleCloseReport}
      />
        </Animated.View>
      </GestureDetector>

      {/* ★ HomeDrawer — overlay (absolute fill)。progress 共有で feed と同期動作。
          drawerOpen は backdrop タップ / 左スワイプ閉操作後の同期 boolean state。 */}
      <HomeDrawer
        progress={drawerProgress}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </View>
  );
}

/** スケルトンカード 3 枚を縦に並べる — loading 中に表示 */
function FeedSkeleton() {
  return (
    <View>
      {Array.from({ length: 3 }).map((_, i) => (
        <PostCardSkeleton key={`skel-post-${i}`} />
      ))}
    </View>
  );
}

/** フィードが空のときに表示するコンポーネント。loading 中は skeleton を優先 */
const FeedEmptyState = memo(function FeedEmptyState({
  loading,
  isError,
  showSkeleton,
  scope,
  onAction,
  onRetry,
}: {
  loading: boolean;
  isError: boolean;
  showSkeleton: boolean;
  scope: string;
  onAction: () => void;
  onRetry: () => void;
}) {
  if (loading) {
    return showSkeleton ? <FeedSkeleton /> : null;
  }
  // ★ 2026-06-13: fetch 失敗を「投稿がありません」と誤表示しない (ユーザー報告)。
  //   通信断・トークン失効・一時障害では投稿は存在するのに query が空で確定する。
  //   Apple HIG「エラーは原因と次のアクションを平易に」: 再試行ボタンを出す。
  if (isError) {
    return (
      <EmptyState
        icon={Icon.refresh}
        title="読み込めませんでした"
        message="通信状況をご確認のうえ、もう一度お試しください"
        actionLabel="再試行"
        onAction={onRetry}
        tone="accent"
      />
    );
  }
  return (
    <EmptyState
      icon={Icon.sparkles}
      title={
        scope === 'closed' ? '未参加コミュニティの投稿はありません' : '投稿がありません'
      }
      message={
        scope === 'closed'
          ? 'いまは参加中のコミュニティの投稿だけのようです。「すべて」に切り替えるか、検索で新しいコミュニティを探してみよう'
          : 'タグをフォローして興味のある投稿を見つけるか、最初の投稿をしてみよう'
      }
      actionLabel="投稿する"
      onAction={onAction}
      tone="accent"
    />
  );
});
