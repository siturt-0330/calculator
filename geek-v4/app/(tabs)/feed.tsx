import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, RefreshControl, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image as ExpoImage } from 'expo-image';
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
import { ScopeToggle } from '../../components/feed/ScopeToggle';
import { BlockedTagBanner } from '../../components/feed/BlockedTagBanner';
import { logEvent } from '../../lib/personalize';
import { PostCardSkeleton } from '../../components/feed/PostCardSkeleton';
import { TrendingRow } from '../../components/feed/TrendingRow';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Icon } from '../../constants/icons';
import { C, SP, SHADOW } from '../../design/tokens';
import { FONT } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import type { Post } from '../../types/models';

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { posts, reasonsMap, communitiesByPost, ads, interestTags, loading, refreshing, refresh, loadMore } = useFeed();
  const { blockedCount } = useTagFilter();
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const scope = useFeedStore((s) => s.scope);
  const setScope = useFeedStore((s) => s.setScope);
  // 並び替えは廃止 — 常に for-you (パーソナライズ) で配信。
  // 既存ユーザーが旧 sort='hot' を localStorage に持っていても
  // mount 時に強制的に for-you へ書き戻して画面と整合させる。
  const sort = useFeedStore((s) => s.sort);
  const setSort = useFeedStore((s) => s.setSort);
  const hydrateFeed = useFeedStore((s) => s.hydrate);
  useEffect(() => {
    if (sort !== 'for-you') setSort('for-you');
  }, [sort, setSort]);
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
  const { fullPosts, isLoading: rpcLoading, isDisabled: rpcDisabled, isEmpty: rpcEmpty } =
    useFeedPage(postIds);

  // fallback 判定:
  //   - ENV flag で RPC が無効 (= isDisabled)
  //   - RPC は走ったが空集合 (= isEmpty かつ postIds は非空)
  //     → RPC 未適用 / RLS 全 deny / 全件削除 等の可能性
  //   いずれかなら legacy hook 群を起動 (postIds を渡す)
  const useLegacy =
    rpcDisabled || (!rpcLoading && rpcEmpty && postIds.length > 0);
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
      if (msg.includes('duplicate')) showToast('そのタグは既に追加されています', 'warn');
      else showToast('追加に失敗しました', 'error');
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
          // RPC 経路 → fullPosts、fallback → legacy map
          const cur = fullPosts.get(id)?.my_concern ?? !!legacyMyConcerns[id];
          toggleConcern(id, cur);
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
          try { ExpoImage.prefetch(thumbedUrl(u, 720)); } catch { /* ignore */ }
        }
      }
    },
    [feedItems],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      if (isAdItem(item)) {
        return <AdCard ad={item.ad} position={item.position} matchedTags={item.matchedTags} />;
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
      <View style={{ alignItems: 'center', backgroundColor: C.bg }}>
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
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: C.accent,
              alignItems: 'center', justifyContent: 'center',
              marginRight: SP['3'],
              // primary CTA halo を付けて「最も主要な action」をひと目で示す
              ...SHADOW.accentGlow,
            }}
          >
            <Plus size={20} color="#fff" strokeWidth={2.6} />
          </PressableScale>
          {/* Geek brand wordmark — Orbitron Black + accent gradient (web) + glow */}
          <Text
            allowFontScaling={false}
            style={[
              {
                flex: 1,
                fontFamily: 'Orbitron_900Black',
                fontSize: 30,
                lineHeight: 34,
                letterSpacing: 2,
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
          <PressableScale
            onPress={() => router.push('/search' as never)}
            hitSlop={10}
            haptic="tap"
            accessibilityLabel="検索"
            style={{ padding: SP['2'] }}
          >
            <Search size={22} color={C.text} strokeWidth={2.2} />
          </PressableScale>
          <PressableScale
            onPress={() => router.push('/notifications' as never)}
            hitSlop={10}
            haptic="tap"
            accessibilityLabel={`通知${unreadCount > 0 ? ` ${unreadCount}件` : ''}`}
            style={{ padding: SP['2'] }}
          >
            <View>
              <Bell size={22} color={C.text} strokeWidth={2.2} />
              <NotificationBadge count={unreadCount} top={-4} right={-6} />
            </View>
          </PressableScale>
        </View>
      </View>

      {/* SortTabs は非表示 — 常にパーソナライズ (for-you) で配信。
          ユーザーには「並び替え」という概念を見せず、あなた向けが唯一のホーム体験。 */}

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

      {/* ヘッダーとリストの境界を 1px の hairline で示す — 他タブ画面と統一感 */}
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
          paddingTop: SP['2'],
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
        <PostCardSkeleton key={i} />
      ))}
    </View>
  );
}
