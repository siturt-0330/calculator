import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl, ScrollView, Pressable, Image as RNImage,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { getLastViewed, setLastViewed } from '../../lib/utils/lastViewed';
import { fetchPostById, fetchCommunitiesForPosts } from '../../lib/api/posts';
import { fetchSimilarPosts } from '../../lib/api/similarPosts';
import { fetchComments, createComment } from '../../lib/api/comments';
import { attachChannel } from '../../lib/realtime';
import { useFeedPage } from '../../hooks/useFeedPage';
import { useReactionToggle } from '../../hooks/useReactions';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { invalidateFeedPage } from '../../lib/cacheUpdates/feedPagePatcher';
import { MemeReactionPicker } from '../../components/feed/MemeReactionPicker';
import { LinkPreviewCard } from '../../components/feed/LinkPreviewCard';
import { SP, R } from '../../design/tokens';
import { useColors } from '../../hooks/useColors';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { ProgressiveImage } from '../../components/ui/ProgressiveImage';
import { VideoPlayer } from '../../components/ui/VideoPlayer';
import { MediaWithCWGuard } from '../../components/post/MediaWithCWGuard';
import { ImageLightbox } from '../../components/ui/ImageLightbox';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { extractFirstUrl } from '../../lib/utils/extractUrl';
import { Spinner } from '../../components/ui/Spinner';
import { useToastStore } from '../../stores/toastStore';
import { formatRelative } from '../../lib/utils/date';
import type { Comment } from '../../types/models';
import { Icon } from '../../constants/icons';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';
import { CommentThreadItem } from '../../components/post/CommentThreadItem';
import { CollapsedComment } from '../../components/post/CollapsedComment';
import { buildCommentTree } from '../../lib/utils/commentTree';
import {
  shouldCollapseComment,
  groupConsecutiveCollapsed,
} from '../../lib/utils/commentCollapse';
import * as Haptics from 'expo-haptics';
import { isValidUuid } from '../../lib/validation';

function safeHaptic(type: Haptics.NotificationFeedbackType) {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(type).catch(() => {});
}

const MAX_W = 720;

export default function PostDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  // route param を UUID validation して cache DoS を防ぐ (詳細は lib/validation.ts)
  const id = isValidUuid(rawId) ? rawId : null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const SendIcon = Icon.send;
  const BackIcon = Icon.arrowL;
  // テーマ購読 — light/dark 切替で post 詳細が自動再 render
  const C = useColors();

  // ============================================================
  // Entering animation — Reddit iOS 風 "lift up & expand" 演出
  // ------------------------------------------------------------
  // タップしたカードが画面下から「持ち上がってきて広がる」錯視を演出。
  //   - modal slide-up (Stack.Screen options: slide_from_bottom 380ms) で
  //     画面全体が下から上にスライドしてくる
  //   - 同時に screen root をこの spring で 0.94 → 1.0 + opacity 0 → 1
  //     で展開させると、スライドと scale-up が重なり「カードが lift up」
  //   - ReducedMotion ON: 150ms timing で fade のみ (scale 無し / spring 無し)
  // shared value で worklet 駆動 — React state を使わないので大量 mount でも軽い。
  //
  // mount 直後に発火させると Stack の modal slide と同時に進んでしまい、
  // 場合によっては開始 frame で scale 0.94 が見える前に詳細画面まで遷移が
  // 完了してしまう (= 効果が消える)。よって `useEffect([])` の即時起動で
  // 良いが、ReducedMotion 切替時にも再評価が必要なので依存に reduceMotion。
  // ============================================================
  const reduceMotion = useReducedMotion();
  const enterProgress = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      enterProgress.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.cubic) });
    } else {
      enterProgress.value = withSpring(1, { damping: 22, stiffness: 240, mass: 0.7 });
    }
  }, [reduceMotion, enterProgress]);
  const enterStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      // ReducedMotion: 拡大演出は外し fade のみ (scale 1 固定)
      return { opacity: enterProgress.value };
    }
    return {
      opacity: enterProgress.value,
      // 0.94 → 1.0 (= 0.94 + progress * 0.06)
      transform: [{ scale: 0.94 + enterProgress.value * 0.06 }],
    };
  });

  // ============================================================
  // 既読/未読ハイライト (issue #18)
  // ------------------------------------------------------------
  // - mount 時に保存済の lastViewed を snapshot として state に持つ
  //   (render 中に setLastViewed → 同 effect で再読み込みすると
  //    画面表示中に「未読」が次々消える挙動になり UX 上紛らわしいため、
  //    開いた瞬間の値を画面開放中は固定する)
  // - 開いた 3 秒後と unmount 時に setLastViewed で更新
  //   (3 秒は誤タップ・誤遷移で「既読」扱いになるのを防ぐ猶予)
  // ============================================================
  const [lastViewedSnapshot, setLastViewedSnapshot] = useState<number | null>(null);
  // 連続 setLastViewed を避けるためのフラグ
  const lastViewedSavedRef = useRef(false);
  // 新着までのスクロール用 ref (タップで scroll する用)
  const scrollRef = useRef<ScrollView>(null);

  // ============================================================
  // 返信モード (migration 0059)
  // ------------------------------------------------------------
  // 「このコメントに返信」をタップしたら replyTo に Comment をセットする。
  //   - 送信時: parentId = replyTo.id, replyToId = replyTo.id を attach
  //   - 返信先は「#N さんに返信中」バナー + ツリーのレール/エルボーで示す。
  //     本文には何も差し込まない (旧: 「↳ #N さんへ」自動挿入は本文を汚すため廃止)。
  //   - キャンセル ✕ ボタンで replyTo を null に戻す
  // ============================================================
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  const { data: post, isLoading: postLoading, isError: postError } = useQuery({
    queryKey: ['post', id],
    queryFn: () => fetchPostById(id!),
    enabled: !!id,
    // 投稿本文は immutable に近い (counter のみ Realtime で invalidate される)
    // 同じ投稿を 30 秒以内に再オープン → 再 fetch しない
    staleTime: 60_000,
  });

  // ★ 投稿詳細でも reactions / my_like 等を表示するため、feed と同じ RPC
  // 経路 (useFeedPage) で 1 件分の周辺データを取得する。
  // フィードで使ってる useFeedPage と同じ cache prefix `[FEED_PAGE_KEY]` を共有
  // するので、useReactionToggle.onMutate の patchFeedPagePost が
  // 詳細画面の cache も自動で更新する (= 楽観 update が UI に即時反映される)。
  const postIdsForFeedPage = useMemo(() => (id ? [id] : []), [id]);
  const { fullPosts } = useFeedPage(postIdsForFeedPage);
  const fullPost = id ? fullPosts.get(id) : undefined;
  const reactions = useMemo(() => fullPost?.reactions ?? [], [fullPost]);
  const myMemes = useMemo(
    () => reactions.filter((r) => r.mine).map((r) => r.meme),
    [reactions],
  );
  const { toggle: toggleReact } = useReactionToggle();
  const [memePickerOpen, setMemePickerOpen] = useState(false);

  const { data: replies = [], isLoading: repliesLoading, refetch, isRefetching } = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => fetchComments(id!),
    enabled: !!id,
    // Realtime で INSERT 即時 invalidate される — 通常時の polling は抑える
    staleTime: 30_000,
  });

  // 似た投稿
  const { data: similarPosts = [] } = useQuery({
    queryKey: ['similar-posts', id, post?.tag_names ?? []],
    queryFn: () => fetchSimilarPosts(id!, post?.tag_names ?? [], 3),
    enabled: !!id && !!post && (post?.tag_names?.length ?? 0) > 0,
    staleTime: 60_000,
  });

  // 紐付いたコミュニティ (cross-post / community_only / community_public)
  // 監査指摘: 投稿詳細から community への遷移経路が存在しなかった。
  // 旧版はフィードカード (AnonPostCard) でだけピル表示していたが、直リンク
  // やシェアから来たユーザーが community に戻れない問題があった。
  const { data: communitiesByPost = {} } = useQuery({
    queryKey: ['post-communities-of', id],
    queryFn: () => fetchCommunitiesForPosts([id!]),
    enabled: !!id,
    staleTime: 60_000,
  });
  const postCommunities = id ? (communitiesByPost[id] ?? []) : [];

  // ============================================================
  // メディア (写真 / 動画) — クリック先の投稿詳細でも表示する
  // ------------------------------------------------------------
  // フィードカード (AnonPostCard) と同じ描画方針:
  //   - 画像は自然なアスペクト比 (0.5〜2.0 クランプ) で全体表示。
  //     タップで ImageLightbox (全画面ズーム) を開く。
  //   - 動画は VideoPlayer (16:9)。
  //   - CW (spoiler/nsfw/violence) は MediaWithCWGuard で per-item gate。
  // post は fetchPostById 由来 (media_urls/blurhashes/video_urls/posters を
  // SELECT 済) なので RPC (fullPost) 経路 off でも確実に出る。
  // ============================================================
  const mediaUrls = post?.media_urls ?? [];
  const mediaBlurhashes = post?.media_blurhashes ?? [];
  const videoUrls = post?.video_urls ?? [];
  const videoPosters = post?.video_posters ?? [];
  const hasMedia = mediaUrls.length > 0 || videoUrls.length > 0;

  // OG リンクプレビュー対象 URL: 明示的な source_url を優先し、
  // 無ければ本文中の最初の URL を拾って OG カード化する (フィードカードと同方針)。
  const useOgPreview = useFeatureFlag('og_preview');
  const previewUrl = useMemo(
    () => post?.source_url || extractFirstUrl(post?.content),
    [post?.source_url, post?.content],
  );

  // 画像アスペクト比 — 240px サムネで getSize し比率だけ測る (帯域節約)。
  // 解決前は 4:3 (1.333) 仮置き。失敗時もそのまま。
  const [imgAspects, setImgAspects] = useState<Record<string, number>>({});
  const mediaUrlsKey = mediaUrls.join('|');
  useEffect(() => {
    if (mediaUrls.length === 0) return undefined;
    let alive = true;
    for (const url of mediaUrls) {
      if (!url) continue;
      RNImage.getSize(
        thumbedUrl(url, 240),
        (w, h) => {
          if (!alive || !(w > 0) || !(h > 0)) return;
          const ratio = Math.max(0.5, Math.min(2.0, w / h));
          setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: ratio }));
        },
        () => { /* measure 失敗 → default 1.333 のまま */ },
      );
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrlsKey]);

  // 画像ライトボックス (全画面表示) の対象 URL
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  const { show } = useToastStore();

  // Smart skeleton timing — Spinner only after 200ms of continuous loading.
  // <200ms loads (cache hits via TanStack staleTime) skip flash entirely.
  const showPostSpinner = useDelayedLoading(postLoading, 200);
  const showRepliesSpinner = useDelayedLoading(repliesLoading, 200);

  const { mutateAsync: submitReply, isPending } = useMutation({
    // 返信モード時は parent_comment_id / reply_to_comment_id をセット
    mutationFn: (args: { content: string; parentId?: string; replyToId?: string }) =>
      createComment(id!, args.content, {
        parentId: args.parentId ?? null,
        replyToId: args.replyToId ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-comments', id] });
      setText('');
      setReplyTo(null);
      safeHaptic(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: unknown) => {
      // 失敗時は haptic だけだとユーザーには無反応に見える — トーストでも明示
      safeHaptic(Haptics.NotificationFeedbackType.Error);
      const msg = e instanceof Error ? e.message : '';
      show(msg ? `送信に失敗しました: ${msg}` : '送信に失敗しました', 'error');
    },
  });

  // lastViewed: post を開いた瞬間の snapshot を取り、3 秒後 + unmount 時に save。
  // - mount 時 1 回だけ snapshot を読む (id 変更で reset)
  // - 3 秒以内に画面を離れた場合は unmount で確実に save される
  useEffect(() => {
    if (!id) return undefined;
    // 開いた瞬間の保存済値を snapshot (render 中はこれを使って未読判定)
    setLastViewedSnapshot(getLastViewed('post', id));
    lastViewedSavedRef.current = false;
    const t = setTimeout(() => {
      setLastViewed('post', id);
      lastViewedSavedRef.current = true;
    }, 3000);
    return () => {
      clearTimeout(t);
      // 3 秒経過前に離脱 → unmount で書き込む (重複でも害は無いが、無駄を避ける)
      if (!lastViewedSavedRef.current) {
        setLastViewed('post', id);
      }
    };
  }, [id]);

  // 未読コメント (snapshot 基準 + 自分の post-comments 結果) の id 集合と先頭 index
  const { unreadIds, firstUnreadIndex } = useMemo(() => {
    if (lastViewedSnapshot === null) return { unreadIds: new Set<string>(), firstUnreadIndex: -1 };
    const set = new Set<string>();
    let firstIdx = -1;
    for (let i = 0; i < replies.length; i++) {
      const c = replies[i];
      if (!c) continue;
      const created = Date.parse(c.created_at);
      if (Number.isFinite(created) && created > lastViewedSnapshot) {
        set.add(c.id);
        if (firstIdx === -1) firstIdx = i;
      }
    }
    return { unreadIds: set, firstUnreadIndex: firstIdx };
  }, [replies, lastViewedSnapshot]);

  // ============================================================
  // コメントツリー化 (migration 0059)
  // ------------------------------------------------------------
  // - commentTree: buildCommentTree で組み立てた root[] (各 root に children/depth)
  // - rootIndexById: id → root の index (#1, #2, ...)。root 自身 + 子孫すべてに
  //   同じ index を貼って表示に使う。 _rootOfId は子孫 id → root id を引く逆引き map。
  // ============================================================
  const commentTree = useMemo(() => buildCommentTree(replies), [replies]);

  const { rootIndexById, rootOfId } = useMemo(() => {
    const idx = new Map<string, number>();
    const rootOf = new Map<string, string>();
    commentTree.forEach((root, i) => {
      idx.set(root.id, i);
      rootOf.set(root.id, root.id);
      const visit = (nodes: Comment[]) => {
        for (const n of nodes) {
          rootOf.set(n.id, root.id);
          if (n.children && n.children.length > 0) visit(n.children);
        }
      };
      if (root.children && root.children.length > 0) visit(root.children);
    });
    return { rootIndexById: idx, rootOfId: rootOf };
  }, [commentTree]);

  const rootOfCommentId = (cid: string): string => rootOfId.get(cid) ?? cid;

  // Realtime: 同じ投稿への新規コメント + 投稿カウンター更新 + リアクション
  //
  // ★ Audit E#5 (2026-05-28):
  //   旧版は 3 channel (comments / posts / post_reactions) に分離していたが、
  //   3 テーブルとも publication 登録済 (0008) なので 1 channel + 3 `.on()` に統合。
  //   CLAUDE.md § 5.3 「publication 未登録 table を chain しない」の cascade リスクが
  //   無いケース。post 詳細画面の同時 channel 数を 3 → 1 に削減。
  //
  // 注: 旧 reactions invalidate は ['reactions'] (legacy cache key) を叩いて
  //     いたが、投稿詳細では useFeedPage 経由で [FEED_PAGE_KEY] cache を使う。
  //     正しい target は invalidateFeedPage(qc) (= [FEED_PAGE_KEY] 全 cache)。
  useEffect(() => {
    if (!id) return;
    const detach = attachChannel(`post-detail-bundle:${id}`, (ch) =>
      ch
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ['post-comments', id] }),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'posts', filter: `id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ['post', id] }),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'post_reactions', filter: `post_id=eq.${id}` },
          () => invalidateFeedPage(qc),
        ),
    );
    return () => {
      try { detach(); } catch { /* ignore */ }
    };
  }, [id, qc]);

  const handleSend = async () => {
    if (!text.trim() || isPending) return;
    // 返信モードなら parent_comment_id / reply_to_comment_id を attach
    const args = replyTo
      ? { content: text.trim(), parentId: replyTo.id, replyToId: replyTo.id }
      : { content: text.trim() };
    // mutateAsync は失敗時に reject するが、onError でトーストを出すので
    // ここでは握り潰して UI を壊さない (unhandled rejection 防止)
    await submitReply(args).catch((e: unknown) => {
      console.warn('[post/handleSend] submit failed:', e);
    });
  };

  // 返信ボタン押下: replyTo をセットするだけ。
  // 返信先は「#N さんに返信中」バナー + ツリーのレール/エルボーで示し、DB は
  // handleSend が parent_comment_id / reply_to_comment_id を attach する。
  // 本文には何も差し込まない (旧実装の「↳ #N (hash) さんへ」自動挿入は、その
  // テキストがそのまま投稿本文に混ざってしまうため廃止)。
  const handleReply = (c: Comment) => {
    setReplyTo(c);
  };

  // route param validation 失敗 → cache 汚染を防ぐため早期 return
  // 早期 return も entering animation の対象にする (modal slide-up と組み合わさり
  // 「エラー画面が下から ぬっ と出る」一貫した体感)。
  if (!id) {
    return (
      <Animated.View style={[{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: SP['6'] }, enterStyle]}>
        <Text style={[T.body, { color: C.text2 }]}>無効な URL です</Text>
      </Animated.View>
    );
  }

  if (postLoading) {
    return (
      <Animated.View style={[{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }, enterStyle]}>
        {showPostSpinner ? <Spinner /> : null}
      </Animated.View>
    );
  }

  if (postError || !post) {
    return (
      <Animated.View style={[{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: SP['6'], gap: SP['3'] }, enterStyle]}>
        {/* 装飾絵文字 (📭) を撤去 — テキストだけで十分意味は通る */}
        <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>投稿を取得できませんでした</Text>
        <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
          通信エラーまたは削除された投稿の可能性があります
        </Text>
        <PressableScale
          onPress={() => router.back()}
          haptic="tap"
          hitSlop={10}
          style={{
            marginTop: SP['2'],
            paddingHorizontal: SP['5'], paddingVertical: SP['3'],
            backgroundColor: C.bg3, borderRadius: R.full,
            borderWidth: 1, borderColor: C.border,
          }}
        >
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>戻る</Text>
        </PressableScale>
      </Animated.View>
    );
  }

  // renderReply は CommentThreadItem に切り出した (migration 0059)。
  // ツリー化されたコメント (commentTree) を再帰的に描画する。

  const ListHeader = () => (
    <View style={{ alignItems: 'center' }}>
      {/* ヘッダー */}
      <View style={{ width: '100%', maxWidth: MAX_W }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP['3'], paddingTop: insets.top + SP['2'], paddingBottom: SP['2'] }}>
          <PressableScale
            onPress={() => router.back()}
            haptic="tap"
            hitSlop={12}
            accessibilityLabel="戻る"
            style={{ padding: SP['2'] }}
          >
            <BackIcon size={22} color={C.text} strokeWidth={2.2} />
          </PressableScale>
          <Text style={[T.smallM, { color: C.text3, marginLeft: SP['2'] }]}>投稿</Text>
        </View>
        {/* 投稿本体カード */}
        <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['3'] }}>
          <View style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1, borderColor: C.border,
            gap: SP['3'],
          }}>
            {/* 投稿先コミュニティ — カード上部に表示 (📍 アイコンは廃止) */}
            {postCommunities.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Text style={[T.caption, { color: C.text3 }]}>投稿先:</Text>
                {postCommunities.map((c) => (
                  <PressableScale
                    key={c.community_id}
                    onPress={() => router.push(`/community/${c.community_id}` as never)}
                    haptic="tap"
                    hitSlop={6}
                    accessibilityLabel={`${c.name} コミュニティへ移動`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: SP['2'],
                      paddingVertical: 3,
                      backgroundColor: c.is_official ? C.accentBg : C.bg3,
                      borderWidth: 1,
                      borderColor: c.is_official ? C.accent : C.border,
                      borderRadius: R.full,
                    }}
                  >
                    {c.icon_url ? null : <Text style={{ fontSize: 11 }}>{c.icon_emoji}</Text>}
                    <Text style={[T.caption, {
                      color: c.is_official ? C.accent : C.text2,
                      fontWeight: '700',
                    }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Avatar size={36} anonymous />
              <Text style={[T.caption, { color: C.text3, flex: 1 }]}>{formatRelative(post.created_at)}</Text>
              <ObsidianSaveButton note={postToObsidianNote(post)} size={18} />
            </View>
            {post.title && (
              <Text style={[T.h2, { color: C.text, fontWeight: '800', marginBottom: SP['2'] }]} numberOfLines={4}>
                {post.title}
              </Text>
            )}
            <Text style={[T.body, { color: C.text, lineHeight: 24 }]}>{post.content}</Text>
            {/* ============================================================
                メディア (写真 / 動画) — フィードカードと同じ表示方針。
                画像タップで全画面ライトボックス、動画は VideoPlayer。
                ============================================================ */}
            {hasMedia && (
              <View style={{ gap: SP['2'] }}>
                {mediaUrls.map((url, i) => {
                  const aspect = imgAspects[url] ?? 1.333;
                  const blurhash = mediaBlurhashes[i];
                  return (
                    <View
                      key={url}
                      style={{
                        width: '100%',
                        aspectRatio: aspect,
                        borderRadius: R.md,
                        overflow: 'hidden',
                        backgroundColor: C.bg3,
                      }}
                    >
                      <MediaWithCWGuard cwCategory={post.cw_category} blurhash={blurhash}>
                        <Pressable
                          onPress={() => setLightboxUri(thumbedUrl(url, 1280))}
                          style={{ flex: 1 }}
                          accessibilityRole="imagebutton"
                          accessibilityLabel="画像を拡大表示"
                        >
                          <ProgressiveImage
                            uri={url}
                            blurhash={blurhash ?? undefined}
                            width="100%"
                            height="100%"
                            radius={R.md}
                            thumbWidth={720}
                          />
                        </Pressable>
                      </MediaWithCWGuard>
                    </View>
                  );
                })}
                {videoUrls.map((vurl, i) => (
                  <View
                    key={`v-${vurl}`}
                    style={{
                      width: '100%',
                      aspectRatio: 16 / 9,
                      borderRadius: R.md,
                      overflow: 'hidden',
                      backgroundColor: '#000',
                    }}
                  >
                    <MediaWithCWGuard cwCategory={post.cw_category}>
                      <VideoPlayer uri={vurl} poster={videoPosters[i]} />
                    </MediaWithCWGuard>
                  </View>
                ))}
              </View>
            )}
            {/* リンクプレビュー — source_url か本文中の URL を OG カード化。
                画像タップで該当 URL を開く (LinkPreviewCard 内で処理)。 */}
            {previewUrl && useOgPreview && <LinkPreviewCard url={previewUrl} />}
            {/* 投稿先はカード上部に移動 (📍 アイコン廃止) */}
            {/* ============================================================
                リアクション (テキストスタンプ)
                ------------------------------------------------------------
                useFeedPage([id]) で取得した reactions を表示。タップで toggle。
                useReactionToggle が patchFeedPagePost 経由で [FEED_PAGE_KEY]
                cache を即時更新するので、ピル数値も即時反映される。
                ============================================================ */}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center',
                marginTop: 2,
              }}
            >
              {reactions.slice(0, 12).map((r) => {
                const mine = r.mine;
                return (
                  // クリック応答監査: 旧版は hitSlop={6} + paddingVertical:5 で
                  // 実タップ高 ~32px。スマホ親指タップで隣の pill を踏むケース多発。
                  // 見た目を維持しつつ hitSlop を 10 に拡張し ~40px を確保。
                  <PressableScale
                    key={r.meme}
                    onPress={() => toggleReact(id, r.meme)}
                    haptic="tap"
                    hitSlop={10}
                    accessibilityLabel={`${r.meme} ${r.count} 件 ${mine ? '(押下済み)' : ''}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      paddingHorizontal: SP['3'],
                      paddingVertical: 5,
                      borderRadius: R.full,
                      backgroundColor: mine ? C.accent : C.bg3,
                      borderWidth: 1.5,
                      borderColor: mine ? C.accent : C.border,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: mine ? '#fff' : C.text,
                        fontWeight: '700',
                      }}
                    >
                      {r.meme}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: mine ? '#fff' : C.text2,
                        fontWeight: '700',
                      }}
                    >
                      {r.count}
                    </Text>
                  </PressableScale>
                );
              })}
              <PressableScale
                onPress={() => setMemePickerOpen(true)}
                haptic="tap"
                hitSlop={10}
                accessibilityLabel="テキストスタンプを追加"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: SP['3'],
                  paddingVertical: 5,
                  borderRadius: R.full,
                  backgroundColor: C.bg3,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderStyle: 'dashed',
                }}
              >
                <Icon.plus size={12} color={C.accent} strokeWidth={2.6} />
                <Text style={{ fontSize: 11, color: C.accent, fontWeight: '700' }}>
                  {reactions.length === 0 ? 'テキストスタンプを送る' : 'スタンプ'}
                </Text>
              </PressableScale>
            </View>
          </View>
        </View>

        {/* 似たような投稿はコメントの下 (一番下) に移動した — ScrollView 末尾を参照 */}

        {replies.length > 0 && (
          <Text style={[T.smallM, { color: C.text2, paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['1'], fontWeight: '700' }]}>
            💬 {replies.length}件のコメント
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: C.bg }, enterStyle]}>
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ============================================================
          コメントツリー (migration 0059)
          ------------------------------------------------------------
          - FlashList から ScrollView に切替: 階層描画では item の高さが
            可変かつ再帰なので flash list の recycler は活かしづらい。
            投稿あたりのコメント数は通常 50 件以下 (1 root + 子孫合計でも
            ~200 件程度) なので ScrollView で十分。
          - ListHeader (投稿本体カード + 類似投稿 + コメント件数) はそのまま。
          - 各 root を CommentThreadItem に渡して再帰描画。
          ============================================================ */}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: SP['8'] }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.accent} />
        }
      >
        <ListHeader />
        {repliesLoading ? (
          showRepliesSpinner ? (
            <View style={{ padding: SP['6'], alignItems: 'center' }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : null
        ) : commentTree.length === 0 ? (
          <View style={{ padding: SP['6'], alignItems: 'center' }}>
            <Text style={[T.small, { color: C.text3 }]}>コメントはまだありません</Text>
          </View>
        ) : (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: '100%', maxWidth: MAX_W, paddingHorizontal: SP['4'] }}>
              {/* ============================================================
                  自動 collapse (migration 0063 / Reddit ガイド 5.3 / 5.10)
                  ------------------------------------------------------------
                  - root レベルの comment を walk して shouldCollapseComment で
                    annotate → groupConsecutiveCollapsed で連続 collapse を 1
                    グループにまとめる。
                  - 2 件以上連続 collapse → <CollapsedComment> でラップ。
                  - 単体 (collapse 1 件 or 通常) は今までどおり <CommentThreadItem>。
                  - 未読 (unread) になっている collapse 対象は誤判定の可能性が
                    高いので、ここでは展開済の single として扱う (UX 優先)。
                  ============================================================ */}
              {(() => {
                const annotated = commentTree.map((root, idx) => {
                  const counts = root as typeof root & {
                    concern_count?: number;
                    likes_count?: number;
                    is_hidden_by_author?: boolean;
                  };
                  const collapsed =
                    !unreadIds.has(root.id) && shouldCollapseComment(counts);
                  return { root, idx, id: root.id, collapsed };
                });
                const grouped = groupConsecutiveCollapsed(annotated);
                return grouped.map((item, gIdx) => {
                  if (item.kind === 'single') {
                    const { root, idx } = item.comment;
                    return (
                      <CommentThreadItem
                        key={root.id}
                        comment={root}
                        rootIndex={idx + 1}
                        unread={unreadIds.has(root.id)}
                        postContent={post.content}
                        postId={post.id}
                        parentCommunityId={postCommunities[0]?.community_id ?? null}
                        onReply={handleReply}
                      />
                    );
                  }
                  // group: 連続する collapse 対象を 1 chip に集約
                  return (
                    <CollapsedComment key={`grp-${gIdx}-${item.comments[0]?.id ?? ''}`} count={item.count}>
                      {item.comments.map(({ root, idx }) => (
                        <CommentThreadItem
                          key={root.id}
                          comment={root}
                          rootIndex={idx + 1}
                          unread={unreadIds.has(root.id)}
                          postContent={post.content}
                          postId={post.id}
                          parentCommunityId={postCommunities[0]?.community_id ?? null}
                          onReply={handleReply}
                        />
                      ))}
                    </CollapsedComment>
                  );
                });
              })()}
            </View>
          </View>
        )}

        {/* 似たような投稿 — コメントの下 (一番下) に表示。最大3件、🔗アイコンなし。 */}
        {similarPosts.length > 0 && (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: '100%', maxWidth: MAX_W, paddingHorizontal: SP['4'], paddingBottom: SP['3'], paddingTop: SP['4'], gap: SP['2'] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}>
                  似たような投稿
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>
                  {Math.min(similarPosts.length, 3)}件
                </Text>
              </View>
              <View style={{ gap: SP['2'] }}>
                {similarPosts.slice(0, 3).map((p) => {
                  const thumb = p.media_urls?.[0];
                  const thumbBh = p.media_blurhashes?.[0];
                  return (
                    <PressableScale
                      key={p.id}
                      onPress={() => router.push(`/post/${p.id}` as never)}
                      haptic="tap"
                      hitSlop={6}
                      accessibilityLabel={`似た投稿: ${p.content?.slice(0, 30) ?? ''} を開く`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: SP['3'],
                        padding: SP['3'],
                        backgroundColor: C.bg3,
                        borderRadius: R.md,
                        borderWidth: 1, borderColor: C.border,
                      }}
                    >
                      {thumb && (
                        <View
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: R.sm,
                            overflow: 'hidden',
                            backgroundColor: C.bg2,
                            flexShrink: 0,
                          }}
                        >
                          <ProgressiveImage
                            uri={thumb}
                            blurhash={thumbBh ?? undefined}
                            width={64}
                            height={64}
                            radius={R.sm}
                            thumbWidth={160}
                          />
                        </View>
                      )}
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[T.small, { color: C.text, lineHeight: 18 }]} numberOfLines={2}>
                          {p.content}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
                          <Text style={[T.caption, { color: C.text3 }]}>
                            💛 {p.likes_count ?? 0}
                          </Text>
                          <Text style={[T.caption, { color: C.text3 }]}>
                            · {formatRelative(p.created_at)}
                          </Text>
                          {p.media_urls && p.media_urls.length > 1 && (
                            <Text style={[T.caption, { color: C.text3 }]}>
                              · 📷 {p.media_urls.length}
                            </Text>
                          )}
                        </View>
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* 新着 N 件アンカー (issue #18) — 未読が 1 件以上ある時のみ表示。
          tap で最初の未読までスクロール。Modal ではないので入力欄の上に
          浮かぶ floating pill として配置 (pointerEvents は box-none で
          周辺のタップを邪魔しない)。 */}
      {unreadIds.size > 0 && firstUnreadIndex >= 0 && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            // 入力欄の上に配置 (insets.bottom + 入力欄高さ ~60 + 余白)
            bottom: insets.bottom + 76,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <PressableScale
            onPress={() => {
              try {
                // ScrollView では index 指定の scroll が無い。コメントツリー化で
                // 各 row の高さが不定なので、ここでは end まで飛ばす近似 (best-effort)。
                // FlashList 時代の scrollToIndex に比べ精度は落ちるが、未読 UX
                // 自体は維持できる (画面下に新着のはず)。
                scrollRef.current?.scrollToEnd({ animated: true });
              } catch {
                /* swallow — scroll は best-effort */
              }
            }}
            haptic="tap"
            hitSlop={8}
            accessibilityLabel={`新着コメント ${unreadIds.size} 件へスクロール`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              backgroundColor: C.accent,
              borderRadius: R.full,
              borderWidth: 1.5,
              borderColor: C.accentLight,
              shadowColor: C.accent,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.4,
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <Icon.chevronD size={14} color="#fff" strokeWidth={2.6} />
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
              新着 {unreadIds.size} 件
            </Text>
          </PressableScale>
        </View>
      )}
      <View style={{ width: '100%', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 }}>
        {/* 返信モードバナー (migration 0059) — replyTo がセットされてる時のみ */}
        {replyTo && (
          <View style={{
            width: '100%', maxWidth: MAX_W,
            paddingHorizontal: SP['3'], paddingTop: SP['2'],
          }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['2'],
              paddingHorizontal: SP['3'],
              paddingVertical: 6,
              backgroundColor: C.accentBg,
              borderRadius: R.md,
              borderWidth: 1, borderColor: C.accent,
            }}>
              <Icon.arrowUL size={14} color={C.accent} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]} numberOfLines={1}>
                #{(rootIndexById.get(rootOfCommentId(replyTo.id)) ?? 0) + 1} さんに返信中
              </Text>
              <View style={{ flex: 1 }} />
              <PressableScale
                onPress={() => setReplyTo(null)}
                haptic="tap"
                hitSlop={8}
                accessibilityLabel="返信モードを解除"
                style={{ padding: 2 }}
              >
                <Icon.close size={14} color={C.accent} strokeWidth={2.4} />
              </PressableScale>
            </View>
          </View>
        )}
        <View style={{
          width: '100%', maxWidth: MAX_W,
          paddingHorizontal: SP['3'],
          paddingTop: SP['2'],
          paddingBottom: insets.bottom + SP['2'],
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: SP['2'],
        }}>
          <View style={{
            flex: 1,
            backgroundColor: C.bg3,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: text.trim() ? C.accent : C.border,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
          }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={replyTo ? '返信内容を入力…' : 'コメントを入力…'}
              placeholderTextColor={C.text3}
              multiline
              maxLength={500}
              keyboardAppearance="dark"
              selectionColor={C.accent}
              style={[T.body, { color: C.text, maxHeight: 100, minHeight: 24, paddingVertical: 0 }]}
            />
            {text.length > 0 && (
              <Text style={{ fontSize: 10, color: text.length > 450 ? C.amber : C.text3, textAlign: 'right' }}>
                {text.length} / 500
              </Text>
            )}
          </View>
          <PressableScale
            onPress={handleSend}
            disabled={!text.trim() || isPending}
            haptic="confirm"
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: text.trim() && !isPending ? C.accent : C.bg4,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 2, borderColor: text.trim() && !isPending ? C.accent : C.border,
            }}
          >
            {isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <SendIcon size={20} color={text.trim() ? '#fff' : C.text3} strokeWidth={2.4} />
            )}
          </PressableScale>
        </View>
      </View>

      {/* テキストスタンプ Picker — フィードカードと同じ component を再利用 */}
      <MemeReactionPicker
        visible={memePickerOpen}
        onClose={() => setMemePickerOpen(false)}
        onPick={(meme) => toggleReact(id, meme)}
        picked={myMemes}
      />

      {/* 画像ライトボックス — 本文の画像タップで拡大表示 (AnonPostCard と同じ component) */}
      <ImageLightbox
        visible={!!lightboxUri}
        uri={lightboxUri}
        onClose={() => setLightboxUri(null)}
      />
    </KeyboardAvoidingView>
    </Animated.View>
  );
}
