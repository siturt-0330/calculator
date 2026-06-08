import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, useWindowDimensions, ActivityIndicator, RefreshControl, ScrollView, Pressable, StyleSheet, Image as RNImage,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { fetchPostById, fetchCommunitiesForPosts, deleteOwnPost, fetchPostEditedAt } from '../../lib/api/posts';
import { fetchSimilarPosts } from '../../lib/api/similarPosts';
import { fetchComments, createComment } from '../../lib/api/comments';
import { attachChannel } from '../../lib/realtime';
import { useFeedPage } from '../../hooks/useFeedPage';
import { useReactionToggle } from '../../hooks/useReactions';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { invalidateFeedPage } from '../../lib/cacheUpdates/feedPagePatcher';
import { MemeReactionPicker } from '../../components/feed/MemeReactionPicker';
import { ReactionListSheet } from '../../components/feed/ReactionListSheet';
import { getCachedAspect } from '../../components/feed/AnonPostCard';
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
import { extractFirstUrl, stripPreviewUrl } from '../../lib/utils/extractUrl';
import { Spinner } from '../../components/ui/Spinner';
import { formatRelative } from '../../lib/utils/date';
import type { Comment } from '../../types/models';
import { Icon } from '../../constants/icons';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';
import { CommentThreadItem } from '../../components/post/CommentThreadItem';
import { ReportSheet } from '../../components/post/ReportSheet';
import { PostAuthorSheet } from '../../components/post/PostAuthorSheet';
import { MoreHorizontal, Film, Send } from 'lucide-react-native';
import { useCommentReactions, useCommentReactionToggle } from '../../hooks/useCommentReactions';
import { CollapsedComment } from '../../components/post/CollapsedComment';
import { buildCommentTree } from '../../lib/utils/commentTree';
import {
  shouldCollapseComment,
  groupConsecutiveCollapsed,
} from '../../lib/utils/commentCollapse';
import { isValidUuid } from '../../lib/validation';
import { pseudonymFor } from '../../lib/utils/pseudonym';
import * as ImagePicker from 'expo-image-picker';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { hap } from '../../design/haptics';
import { peekRate, rateLimitMessage } from '../../lib/rateLimit';
import { validateVideoSource, uploadPostImage, uploadPostVideo } from '../../lib/media';
import { makeWebPreviewDataUrl } from '../../lib/image';
import { ComposerMediaGrid } from '../../components/post/composer/ComposerMediaGrid';

const MAX_W = 720;

// インライン返信コンポーザーで扱うローカル動画 (アップロード前)
type LocalVideo = { uri: string; mime: string; ext: string; size: number };

// クイック絵文字 (コメント欄でタップ挿入・YouTube 風)
const QUICK_EMOJIS = ['❤️', '😂', '🎉', '😢', '😮', '😅', '😊'] as const;

export default function PostDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  // route param を UUID validation して cache DoS を防ぐ (詳細は lib/validation.ts)
  const id = isValidUuid(rawId) ? rawId : null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
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
  // 返信は全画面コメント作成画面 (app/post/comment) へ遷移して行う
  // (旧: インライン replyTo バナー + 下部入力欄。Instagram/Threads 風に全画面化)。

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
  const { fullPosts, isLoading: feedPageLoading } = useFeedPage(postIdsForFeedPage);
  const fullPost = id ? fullPosts.get(id) : undefined;

  // 「編集済み」バッジ用に edited_at を耐性付き取得 (0133 未適用なら null=バッジ非表示)。
  //   POSTS_SELECT_COLS とは分離して deploy-ordering 結合を避けている。
  const { data: editedAt } = useQuery({
    queryKey: ['post-edited-at', id],
    queryFn: () => fetchPostEditedAt(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
  // ★ de-anon Phase2: 投稿者の擬似アイデンティティ (handle / 色 / 頭文字) を
  //   server 供給の pseudonym_id から導出 (author_id 非依存・AnonPostCard と同方針)。
  const pseudo = useMemo(() => pseudonymFor(fullPost?.pseudonym_id), [fullPost?.pseudonym_id]);
  // 公式管理者の実名 + 所属。RPC (useFeedPage) 供給を優先 — REST (fetchPostById) は
  //   2b で author_id を外したため official_author を算出しなくなった。
  const officialAuthor = fullPost?.official_author ?? post?.official_author ?? null;
  const reactions = useMemo(() => fullPost?.reactions ?? [], [fullPost]);
  const myMemes = useMemo(
    () => reactions.filter((r) => r.mine).map((r) => r.meme),
    [reactions],
  );
  const { toggle: toggleReact } = useReactionToggle();
  const [memePickerOpen, setMemePickerOpen] = useState(false);
  // 「…」タップで「押された全スタンプ」一覧シートを開く
  const [reactionsDetailOpen, setReactionsDetailOpen] = useState(false);

  // ============================================================
  // インライン コメント / 返信 コンポーザー (別画面に遷移しない)
  // ------------------------------------------------------------
  // replyTarget=null: ルートコメント / 非null: そのコメントへの返信。
  // 送信は submitComment が parent/reply id 付きで createComment を呼ぶ。
  // ============================================================
  const show = useToastStore((s) => s.show);
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [commentText, setCommentText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [video, setVideo] = useState<LocalVideo | null>(null);
  const [posting, setPosting] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [pickingVideo, setPickingVideo] = useState(false);
  const [composerActive, setComposerActive] = useState(false);
  const composerRef = useRef<TextInput>(null);
  const canPost = (commentText.trim().length > 0 || images.length > 0 || !!video) && !posting;

  const { data: replies = [], isLoading: repliesLoading, refetch, isRefetching } = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => fetchComments(id!),
    enabled: !!id,
    // Realtime で INSERT 即時 invalidate される — 通常時の polling は抑える
    staleTime: 30_000,
  });

  // 似た投稿
  // ★ waterfall 解消: tag_names が分かれば即発射 (post object 全体の解決を待たない)。
  //   フィードからの遷移で ['post', id] が seed 済なら mount 時に tag_names が揃い、
  //   post 本文 RTT の裏で並行起動できる。cold deep-link 時は従来どおり post 本文
  //   到着と同時に tag_names が揃うので挙動は不変。
  const { data: similarPosts = [] } = useQuery({
    queryKey: ['similar-posts', id, post?.tag_names ?? []],
    queryFn: () => fetchSimilarPosts(id!, post?.tag_names ?? [], 3),
    enabled: !!id && (post?.tag_names?.length ?? 0) > 0,
    staleTime: 60_000,
  });

  // 紐付いたコミュニティ (cross-post / community_only / community_public)
  // 監査指摘: 投稿詳細から community への遷移経路が存在しなかった。
  // 旧版はフィードカード (AnonPostCard) でだけピル表示していたが、直リンク
  // やシェアから来たユーザーが community に戻れない問題があった。
  // ★ 遅延 fallback (案B): 通常 (feed RPC 有効) は useFeedPage([id]) 由来の
  //   fullPost.communities を使い、この HTTP は撃たない。RPC が settle しても
  //   communities を得られなかった時 (kill-switch EXPO_PUBLIC_FEED_PAGE_RPC='0' /
  //   RPC error / RLS 全 deny で fullPost 自体が undefined) だけ従来経路へ fallback し、
  //   コミュピル + CommentThreadItem.parentCommunityId の紐付けが消えないようにする。
  // enabled 条件の肝:
  //   - feedPageLoading 中は撃たない → RPC とレースしない / 通常経路で無駄 fetch しない
  //   - fullPost?.communities === undefined は『fullPost 自体が undefined』と同値
  //     (normalize() が communities を常に配列で返すため)。コミュ無し投稿は [] になり
  //     === undefined に該当しないので fallback は撃たれない。
  const { data: communitiesByPost = {} } = useQuery({
    queryKey: ['post-communities-of', id],
    queryFn: () => fetchCommunitiesForPosts([id!]),
    enabled: !!id && !feedPageLoading && fullPost?.communities === undefined,
    staleTime: 60_000,
  });
  // RPC 由来を最優先。得られなかった時だけ fallback query の結果を使う。
  const postCommunities =
    fullPost?.communities ?? (id ? (communitiesByPost[id] ?? []) : []);

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

  // 縦長写真が詳細画面を占有しないための絶対最大高さ (フィードカードと同方針)。
  // web は固定 600px、モバイルは画面高の 65%。
  const { height: winH } = useWindowDimensions();
  const portraitMaxH = Platform.OS === 'web' ? 600 : Math.round(winH * 0.65);
  const previewUrl = useMemo(
    () => post?.source_url || extractFirstUrl(post?.content),
    [post?.source_url, post?.content],
  );

  // 画像アスペクト比 — 240px サムネで getSize し比率だけ測る (帯域節約)。
  // 解決前は 4:3 (1.333) 仮置き。失敗時もそのまま。
  // ★ レイアウトシフト解消: フィードカード (AnonPostCard) が module-level
  //   _aspectCache に同 URL の比率を測って残しているので、初期 state を共有
  //   キャッシュからシードする。フィードから開いた画像は 1.333 仮置き → 実比率
  //   の reflow が起きず、初回描画から正しいアスペクト比で表示される。
  const [imgAspects, setImgAspects] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const url of mediaUrls) {
      if (!url) continue;
      const r = getCachedAspect(url);
      if (r !== undefined) seed[url] = r;
    }
    return seed;
  });
  const mediaUrlsKey = mediaUrls.join('|');
  useEffect(() => {
    if (mediaUrls.length === 0) return undefined;
    let alive = true;
    for (const url of mediaUrls) {
      if (!url) continue;
      // 共有キャッシュ hit 済なら getSize を呼ばない (miss のときだけ実測)
      const cached = getCachedAspect(url);
      if (cached !== undefined) {
        setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: cached }));
        continue;
      }
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
  // 運営への通報シート (この投稿が対象)
  const [reportOpen, setReportOpen] = useState(false);
  const [authorSheetOpen, setAuthorSheetOpen] = useState(false);

  // Smart skeleton timing — Spinner only after 200ms of continuous loading.
  // <200ms loads (cache hits via TanStack staleTime) skip flash entirely.
  const showPostSpinner = useDelayedLoading(postLoading, 200);
  const showRepliesSpinner = useDelayedLoading(repliesLoading, 200);


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

  // 未読コメント (snapshot 基準) の id 集合 — 未読コメントの軽いハイライト用。
  // ※「新着 N 件」フローティング pill は廃止 (セッション中 lastViewedSnapshot が
  //   固定で件数が減らず「消えない」ため)。未読ハイライトのみ残す。
  const unreadIds = useMemo(() => {
    if (lastViewedSnapshot === null) return new Set<string>();
    const set = new Set<string>();
    for (let i = 0; i < replies.length; i++) {
      const c = replies[i];
      if (!c) continue;
      const created = Date.parse(c.created_at);
      if (Number.isFinite(created) && created > lastViewedSnapshot) {
        set.add(c.id);
      }
    }
    return set;
  }, [replies, lastViewedSnapshot]);

  // ============================================================
  // コメントツリー化 (migration 0059)
  // ------------------------------------------------------------
  // - commentTree: buildCommentTree で組み立てた root[] (各 root に children/depth)
  // - rootIndexById: id → root の index (#1, #2, ...)。root 自身 + 子孫すべてに
  //   同じ index を貼って表示に使う。 _rootOfId は子孫 id → root id を引く逆引き map。
  // ============================================================
  const commentTree = useMemo(() => buildCommentTree(replies), [replies]);

  // コメントのテキストスタンプ反応 (comment_reactions を配線して Threads 風の反応行を出す)。
  const allCommentIds = useMemo(() => replies.map((r) => r.id), [replies]);
  const { data: commentReactions } = useCommentReactions(allCommentIds);
  const { toggle: toggleCommentReact } = useCommentReactionToggle();


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

  // 返信ボタン押下: 別画面に遷移せず、下部インラインコンポーザーを返信モードにして
  // フォーカスする (Reddit / X 風)。送信は submitComment が parent/reply id 付きで行う。
  const handleReply = (c: Comment) => {
    setReplyTarget(c);
    setComposerActive(true);
    // YouTube 風: @ハンドルを下書きに前置きしてフォーカス (既に入力中なら上書きしない)
    const handle = pseudonymFor(c.pseudonym_id).handle;
    setCommentText((prev) => (prev.trim().length === 0 ? `@${handle} ` : prev));
    setTimeout(() => composerRef.current?.focus(), 50);
  };

  // 画像ピッカー (create.tsx / comment.tsx と同方針 — Web は data URL 前処理で blob 地雷回避)
  const pickImage = async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        quality: 0.85,
        selectionLimit: 4,
      });
      if (!r.canceled) {
        const uris = r.assets.map((a) => a.uri).slice(0, 4);
        if (Platform.OS === 'web') {
          const processed = await Promise.all(
            uris.map(async (u) => {
              try {
                return await makeWebPreviewDataUrl(u, 1600, 0.85);
              } catch (e) {
                console.warn('[post detail] web image pre-process failed:', e);
                return u;
              }
            }),
          );
          setImages(processed.slice(0, 4));
        } else {
          setImages(uris);
        }
        hap.tap();
      }
    } catch (e) {
      console.warn('[post detail] pick image failed:', e);
      show('画像の取得に失敗しました', 'error');
    } finally {
      setPickingImage(false);
    }
  };

  // 動画ピッカー
  const pickVideo = async () => {
    if (pickingVideo) return;
    setPickingVideo(true);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'videos',
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (r.canceled || r.assets.length === 0) return;
      const asset = r.assets[0];
      if (!asset) return;
      const v = await validateVideoSource({ uri: asset.uri, fileSize: asset.fileSize, mimeType: asset.mimeType });
      if (!v.ok) {
        hap.warn();
        show(v.reason, 'warn');
        return;
      }
      setVideo({ uri: asset.uri, mime: v.mime, ext: v.ext, size: v.size });
      hap.confirm();
    } catch (e) {
      console.warn('[post detail] pick video failed:', e);
      show('動画の取得に失敗しました', 'error');
    } finally {
      setPickingVideo(false);
    }
  };

  // コメント / 返信の送信 — 別画面に遷移せず、その場で createComment を呼ぶ。
  // 成功したら入力をクリアし ['post-comments', id] を invalidate (スレッドへ反映)。
  const submitComment = async () => {
    if (posting) return;
    if (!id) {
      show('投稿が見つかりませんでした', 'error');
      return;
    }
    if (!commentText.trim() && images.length === 0 && !video) {
      show('本文・画像・動画のいずれかを入力してください。', 'warn');
      return;
    }
    setPosting(true);
    try {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) {
        show('ログインし直してください', 'error');
        return;
      }
      // レート制限を upload 前に先読み (超過なら upload せず即 return → 孤児メディア防止)
      const rl = peekRate('comment');
      if (!rl.ok) {
        show(rateLimitMessage('comment', rl.retryAfterMs), 'error');
        return;
      }
      let mediaUrls: string[] = [];
      try {
        const [imageUrls, vidUrls] = await Promise.all([
          images.length > 0
            ? Promise.all(images.map((uri) => uploadPostImage(uri, userId)))
            : Promise.resolve<string[]>([]),
          video
            ? uploadPostVideo(video.uri, userId, { mime: video.mime, ext: video.ext }).then((url) => [url])
            : Promise.resolve<string[]>([]),
        ]);
        mediaUrls = [...imageUrls, ...vidUrls];
      } catch (e) {
        show(e instanceof Error ? e.message : String(e), 'error');
        return;
      }

      await createComment(id, commentText, {
        parentId: replyTarget?.id ?? null,
        replyToId: replyTarget?.id ?? null,
        mediaUrls,
      });

      hap.success();
      show(replyTarget ? '返信しました' : 'コメントしました', 'success');
      setCommentText('');
      setImages([]);
      setVideo(null);
      setReplyTarget(null);
      setComposerActive(false);
      composerRef.current?.blur();
      void qc.invalidateQueries({ queryKey: ['post-comments', id] });
      // 送信後、新規コメントが見える位置まで自動スクロール (再フェッチ反映待ち 80ms)。
      // 返信(ネスト)は末尾に出ないこともあるが、最低限「動いた」フィードバックになる。
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e: unknown) {
      hap.error();
      const msg = e instanceof Error ? e.message : String(e);
      let userMsg = '送信に失敗しました。再度お試しください。';
      if (msg.includes('row-level security') || msg.includes('RLS')) userMsg = '権限エラー。ログインし直してください。';
      else if (msg.includes('Not authenticated') || msg.includes('未ログイン')) userMsg = 'ログインし直してください。';
      else if (msg.includes('Network') || msg.includes('Failed to fetch')) userMsg = '通信エラー。電波を確認してください。';
      else if (msg.includes('速すぎ') || msg.includes('時間を置いて') || msg.includes('ペースが')) userMsg = msg;
      show(userMsg, 'error');
    } finally {
      setPosting(false);
    }
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

  // render 内で定義した関数を `<ListHeader/>` で要素化すると、親が打鍵ごとに
  // re-render する度に React が「新しいコンポーネント型」とみなしヘッダー全体を
  // unmount/remount する (画像再読込・state喪失)。`{renderListHeader()}` と関数呼び出しで
  // インライン展開し、コンポーネント境界を作らない (#12)。
  const renderListHeader = () => (
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
          <View style={{ flex: 1 }} />
          {/* ⋯ → 著者本人は編集/削除シート、他人は通報シート */}
          <PressableScale
            onPress={() => (fullPost?.is_own ? setAuthorSheetOpen(true) : setReportOpen(true))}
            haptic="tap"
            hitSlop={12}
            accessibilityLabel={fullPost?.is_own ? 'この投稿の操作' : 'この投稿を通報'}
            style={{ padding: SP['2'] }}
          >
            <MoreHorizontal size={20} color={C.text2} strokeWidth={2.2} />
          </PressableScale>
        </View>
        {/* 投稿本体カード */}
        <View style={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['2'],
          paddingBottom: SP['4'],
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: C.divider,
        }}>
          <View style={{ gap: SP['3'] }}>
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
            {/* ============================================================
                投稿者エリア (★ de-anon Phase2)
                ------------------------------------------------------------
                - 公式管理者投稿: shield + 実名 (official_author)。official_author は
                  REST (fetchPostById) ではなく RPC (useFeedPage) 供給を優先する
                  (2b で REST から author_id を外したため REST 経路では算出されない)。
                - それ以外: 投稿者の擬似アイデンティティ (avatar + handle) を主役にする
                  (AnonPostCard と同方針 / author_id 非依存)。avatar は画像優先 →
                  emoji → 色+頭文字 fallback。投稿先コミュニティは上部ピルで導線確保済。
                ============================================================ */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              {officialAuthor ? (
                // 公式管理者: shield アイコン
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: C.accentBg, alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon.shield size={16} color={C.accent} strokeWidth={2.4} />
                </View>
              ) : (
                // 投稿者アバター (擬似人格) — 本人アイコン優先 → emoji → 色+頭文字
                <Avatar
                  size={36}
                  uri={fullPost?.avatar_url}
                  emoji={fullPost?.avatar_url ? undefined : fullPost?.avatar_emoji}
                  color={pseudo.color}
                  name={pseudo.initial}
                />
              )}
              <View style={{ flex: 1 }}>
                {officialAuthor ? (
                  <Text style={[T.captionM, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                    {officialAuthor.name || '公式管理者'}
                  </Text>
                ) : (
                  <Text style={[T.captionM, { color: pseudo.color, fontWeight: '700' }]} numberOfLines={1}>
                    {pseudo.handle}
                  </Text>
                )}
                <Text style={[T.caption, { color: C.text3 }]}>{formatRelative(post.created_at)}</Text>
                {editedAt ? (
                  <Text style={[T.caption, { color: C.text3 }]}> ・編集済み</Text>
                ) : null}
              </View>
              <ObsidianSaveButton note={postToObsidianNote(post)} size={18} />
            </View>
            {post.title && (
              <Text style={[T.h2, { color: C.text, fontWeight: '800', marginBottom: SP['2'] }]} numberOfLines={4}>
                {post.title}
              </Text>
            )}
            <Text style={[T.body, { color: C.text, lineHeight: 24 }]}>
              {stripPreviewUrl(post.content, (previewUrl && useOgPreview) ? previewUrl : null)}
            </Text>
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
                        // 縦長は 4:5 を上限にクロップ表示 (フィードカードと同方針)。
                        // 画像全体はタップ→ライトボックスで確認できる。
                        aspectRatio: Math.max(0.8, aspect),
                        // 縦長 (aspect < 1) は絶対高さでもクランプ — 画面占有を防ぐ。
                        maxHeight: aspect < 1 ? portraitMaxH : undefined,
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
                            // ★ contain: 写真全体を表示 (cover だとクロップ拡大される)
                            contentFit="contain"
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
              {reactions.slice(0, 5).map((r) => {
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
              {reactions.length > 5 && (
                <PressableScale
                  onPress={() => setReactionsDetailOpen(true)}
                  haptic="tap"
                  hitSlop={10}
                  accessibilityLabel="押された全スタンプを見る"
                  style={{
                    paddingHorizontal: SP['3'],
                    paddingVertical: 5,
                    borderRadius: R.full,
                    backgroundColor: C.bg3,
                    borderWidth: 1.5,
                    borderColor: C.border,
                  }}
                >
                  <Text style={{ fontSize: 12, color: C.text2, fontWeight: '700' }}>…</Text>
                </PressableScale>
              )}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['1'] }}>
            <Icon.comment size={15} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
              {replies.length}件のコメント
            </Text>
          </View>
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
        {renderListHeader()}
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
                        reactionsByComment={commentReactions}
                        onReact={toggleCommentReact}
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
                          reactionsByComment={commentReactions}
                          onReact={toggleCommentReact}
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

      {/* 「新着 N 件」フローティング pill は廃止 (セッション中ずっと残り「消えない」
          UX だったため)。未読ハイライト (unreadIds) は各コメント側で維持。 */}
      {/* ============================================================
          インライン コメント / 返信 コンポーザー (別画面に遷移しない)
          - 返信時は上部に「○○ さんに返信」チップ (✕でキャンセル)
          - 画像/動画を添付 → ComposerMediaGrid でプレビュー
          - キーボードは KeyboardAvoidingView がこのバーごと押し上げる
          ============================================================ */}
      <View style={{ width: '100%', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 }}>
        <View style={{ width: '100%', maxWidth: MAX_W, paddingHorizontal: SP['3'], paddingTop: SP['2'], paddingBottom: insets.bottom + SP['2'], gap: SP['2'] }}>
          {/* 返信先ラベル「@◯◯ さんに返信しています」(YouTube 風)・×でキャンセル */}
          {replyTarget && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SP['1'] }}>
              <Icon.arrowUL size={13} color={C.accent} strokeWidth={2.4} />
              <Text style={[T.caption, { color: C.text3, flex: 1 }]} numberOfLines={1}>
                <Text style={{ color: C.accent, fontWeight: '700' }}>
                  {`@${pseudonymFor(replyTarget.pseudonym_id).handle}`}
                </Text>
                {' さんに返信しています'}
              </Text>
              <PressableScale
                onPress={() => setReplyTarget(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="返信をやめる"
                style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon.close size={15} color={C.text3} strokeWidth={2.4} />
              </PressableScale>
            </View>
          )}

          {/* 添付メディアのプレビュー */}
          {(images.length > 0 || video) && (
            <ComposerMediaGrid
              images={images}
              video={video ? { uri: video.uri, sizeMb: video.size / 1024 / 1024 } : null}
              onRemoveImage={(index) => setImages(images.filter((_, i) => i !== index))}
              onRemoveVideo={() => setVideo(null)}
              containerPaddingH={0}
            />
          )}

          {/* クイック絵文字 (フォーカス中・YouTube 風)。タップで本文末尾に挿入 */}
          {composerActive && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'], paddingVertical: 2 }}>
              {QUICK_EMOJIS.map((e) => (
                <PressableScale
                  key={e}
                  onPress={() => { setCommentText((prev) => prev + e); composerRef.current?.focus(); }}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`絵文字 ${e} を挿入`}
                  style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </PressableScale>
              ))}
            </View>
          )}

          {/* 入力行: 画像 / 動画 / テキスト / 送信(丸) */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: SP['2'] }}>
            <PressableScale
              onPress={images.length >= 4 || pickingImage || posting ? undefined : pickImage}
              disabled={images.length >= 4 || pickingImage || posting}
              haptic="select"
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="画像を追加"
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: images.length >= 4 || pickingImage || posting ? 0.4 : 1 }}
            >
              <Icon.image size={22} color={C.text2} strokeWidth={2} />
            </PressableScale>
            <PressableScale
              onPress={!!video || pickingVideo || posting ? undefined : pickVideo}
              disabled={!!video || pickingVideo || posting}
              haptic="select"
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="動画を追加"
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: video || posting ? 0.4 : 1 }}
            >
              <Film size={22} color={C.text2} strokeWidth={2} />
            </PressableScale>
            <View style={{ flex: 1, backgroundColor: C.bg3, borderRadius: R.lg, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP['3'], minHeight: 40, justifyContent: 'center' }}>
              <TextInput
                ref={composerRef}
                value={commentText}
                onChangeText={setCommentText}
                onFocus={() => setComposerActive(true)}
                editable={!posting}
                placeholder={replyTarget ? '返信を入力…' : 'コメントを入力…'}
                placeholderTextColor={C.text3}
                multiline
                returnKeyType="send"
                onKeyPress={
                  Platform.OS === 'web'
                    ? (e) => {
                        // Web/Desktop: Enter で送信、Shift+Enter で改行 (チャット系の慣習)。
                        // モバイルは multiline の改行挙動をそのまま維持 (この分岐に入らない)。
                        const ne = e.nativeEvent as unknown as { key?: string; shiftKey?: boolean };
                        if (ne.key === 'Enter' && !ne.shiftKey) {
                          (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                          if (canPost) submitComment();
                        }
                      }
                    : undefined
                }
                style={{ color: C.text, fontSize: 15, lineHeight: 20, paddingTop: Platform.OS === 'ios' ? 10 : 6, paddingBottom: Platform.OS === 'ios' ? 10 : 6, maxHeight: 120 }}
              />
            </View>
            <PressableScale
              onPress={canPost ? submitComment : () => {
                // disabled にせず「押せない理由」を提示 (無言の無反応を避ける)
                if (!posting && commentText.trim().length === 0 && images.length === 0 && !video) {
                  show('コメントを入力してください。', 'warn');
                }
              }}
              haptic="tap"
              accessibilityRole="button"
              accessibilityLabel={replyTarget ? '返信を送信' : 'コメントを送信'}
              accessibilityState={{ disabled: !canPost }}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: canPost ? C.accent : C.bg3, alignItems: 'center', justifyContent: 'center', opacity: canPost ? 1 : 0.6 }}
            >
              {posting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Send size={18} color={canPost ? '#fff' : C.text3} strokeWidth={2.2} />
              )}
            </PressableScale>
          </View>
        </View>
      </View>

      {/* テキストスタンプ Picker — フィードカードと同じ component を再利用 */}
      <MemeReactionPicker
        visible={memePickerOpen}
        onClose={() => setMemePickerOpen(false)}
        onPick={(meme) => toggleReact(id, meme)}
        picked={myMemes}
        reactions={reactions}
      />

      {/* 「…」から開く: 押された全スタンプの一覧 (閲覧 + タップでトグル) */}
      <ReactionListSheet
        visible={reactionsDetailOpen}
        onClose={() => setReactionsDetailOpen(false)}
        reactions={reactions}
        onReact={(meme) => toggleReact(id, meme)}
      />

      {/* 画像ライトボックス — 本文の画像タップで拡大表示 (AnonPostCard と同じ component) */}
      <ImageLightbox
        visible={!!lightboxUri}
        uri={lightboxUri}
        onClose={() => setLightboxUri(null)}
      />

      {/* 通報シート (運営への通報・理由選択) */}
      <ReportSheet
        visible={reportOpen}
        postId={id}
        onClose={() => setReportOpen(false)}
      />
      <PostAuthorSheet
        visible={authorSheetOpen}
        onClose={() => setAuthorSheetOpen(false)}
        onEdit={() => {
          if (id) router.push(`/post/create?editId=${id}` as never);
        }}
        onDelete={() => {
          if (!id) return;
          void (async () => {
            try {
              await deleteOwnPost(id);
              hap.success();
              show('削除しました', 'success');
              void qc.invalidateQueries({ queryKey: ['feed'] });
              invalidateFeedPage(qc);
              void qc.invalidateQueries({ queryKey: ['user-posts'] });
              void qc.invalidateQueries({ queryKey: ['community'] });
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/feed' as never);
            } catch (e) {
              show(
                e instanceof Error && e.message.includes('権限')
                  ? '削除権限がありません。'
                  : '削除に失敗しました。',
                'error',
              );
            }
          })();
        }}
      />
    </KeyboardAvoidingView>
    </Animated.View>
  );
}
