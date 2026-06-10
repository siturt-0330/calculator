import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Platform, useWindowDimensions, Image as RNImage, StyleSheet, Pressable, Alert } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { safeOpenUrl } from '../../lib/openUrl';
import type { Post, CWCategory } from '../../types/models';
import { useLanguageStore } from '../../stores/languageStore';
import { useAuthStore } from '../../stores/authStore';
import { useBlockStore } from '../../stores/blockStore';
import { translateDynamic, useT } from '../../lib/i18n';
import { ReactionListSheet } from './ReactionListSheet';
import type { ReactionAgg } from '../../lib/api/reactions';
import { R, SP } from '../../design/tokens';
import { useColors } from '../../hooks/useColors';
import type { ColorPalette } from '../../lib/theme/palettes';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { SPRING_SNAPPY } from '../../design/motion';
import { hap } from '../../design/haptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { ProgressiveImage } from '../ui/ProgressiveImage';
import { FeedMediaGrid } from './FeedMediaGrid';
import { mediaItemAspect, mediaContainerWidth } from './feedMediaLayout';
import { VideoPlayer } from '../ui/VideoPlayer';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { extractFirstUrl, stripPreviewUrl } from '../../lib/utils/extractUrl';
import { DoubleTapHeart } from '../ui/DoubleTapHeart';
// NOTE: tag chip と「+ タグ追加」 UI は撤去 (周りの人が他人投稿に tag を付与
// できないようにする方針 + ハッシュタグは feed カード上に表示しない方針)。
// DB 側の tag_names / added_tags は検索 index 用に残るが、ここでは render しない。
// TagPill / AddTagInline import は使わなくなったので削除。
import { MarkdownText } from '../ui/MarkdownText';
import { QuotePostMini } from '../post/QuotePostMini';
import { fetchQuotedPost } from '../../lib/api/quotePosts';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PollCard } from './PollCard';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useIsCommunityMod } from '../../hooks/useIsCommunityMod';
import type { Poll } from '../../lib/api/polls';
import { sanitizeUrl } from '../../lib/sanitize';
import { postToObsidianNote } from '../../hooks/useObsidian';
import type { PostCommunityRef } from '../../lib/api/posts';
import type { FeedPagePost } from '../../lib/api/feedPage';
import { stableKeyFor } from '../../lib/utils/queryKey';
import { MediaWithCWGuard } from '../post/MediaWithCWGuard';
import { getDisplayLikesForViewer } from '../../lib/utils/voteFuzz';
import { ImageLightbox } from '../ui/ImageLightbox';
import { sharePost, shareToX, copyPostLink, getEmbedCode } from '../../lib/utils/sharePost';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useToastStore } from '../../stores/toastStore';
import { PostCardHeader } from '../post/PostCardHeader';
import { PostCardActions } from '../post/PostCardActions';

// 画像アスペクト比のモジュールレベルキャッシュ。
// パフォーマンス監査: 旧版は無制限キャッシュで長時間スクロール後にメモリ蓄積。
// TTL (1h) + size cap (500 件) で LRU 風に古い entry を削除する。
type AspectEntry = { ratio: number; ts: number };
const _aspectCache = new Map<string, AspectEntry>();
const _ASPECT_TTL_MS = 60 * 60 * 1000; // 1h
const _ASPECT_MAX_SIZE = 500;
const _pending = new Set<string>();
const _MAX_CONCURRENT = 3;
const _queue: Array<() => void> = [];
function _drain() {
  while (_pending.size < _MAX_CONCURRENT && _queue.length > 0) {
    const task = _queue.shift();
    if (task) task();
  }
}
function _trimAspectCache() {
  if (_aspectCache.size < _ASPECT_MAX_SIZE) return;
  // 古い順に半数を削除 (LRU 風)
  const sorted = Array.from(_aspectCache.entries()).sort((a, b) => a[1].ts - b[1].ts);
  const removeCount = Math.floor(_ASPECT_MAX_SIZE / 2);
  for (let i = 0; i < removeCount; i++) {
    const entry = sorted[i];
    if (entry) _aspectCache.delete(entry[0]);
  }
}
function measureAspect(url: string, measureUri: string, cb: (ratio: number) => void) {
  const cached = _aspectCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < _ASPECT_TTL_MS) {
    cb(cached.ratio);
    return;
  }
  if (_pending.has(url)) { _queue.push(() => measureAspect(url, measureUri, cb)); return; }
  const start = () => {
    _pending.add(url);
    RNImage.getSize(
      measureUri,
      (w, h) => {
        _pending.delete(url);
        // アスペクト比のクランプ上限を 3.0 に緩和 (2.0 は超横長パノラマで潰れる)。
        // 下限は 0.3 (超縦長は Feed でコンパクトに表示すれば十分)。
        const ratio = h > 0 && w > 0 ? Math.max(0.3, Math.min(3.0, w / h)) : 1;
        _trimAspectCache();
        _aspectCache.set(url, { ratio, ts: Date.now() });
        cb(ratio);
        _drain();
      },
      () => {
        // WebP サムネでの getSize 失敗 → オリジナル URL で再計測してフォールバック。
        // Supabase transform が EXIF rotation を適用せず portrait を返す場合に備える。
        RNImage.getSize(
          url,
          (w, h) => {
            _pending.delete(url);
            const ratio = h > 0 && w > 0 ? Math.max(0.3, Math.min(3.0, w / h)) : 1;
            _trimAspectCache();
            _aspectCache.set(url, { ratio, ts: Date.now() });
            cb(ratio);
            _drain();
          },
          () => {
            _pending.delete(url);
            _trimAspectCache();
            _aspectCache.set(url, { ratio: 1, ts: Date.now() });
            cb(1);
            _drain();
          },
        );
      },
    );
  };
  if (_pending.size < _MAX_CONCURRENT) start();
  else _queue.push(start);
}

// 投稿詳細 (app/post/[id].tsx) からも同じアスペクト比キャッシュを使えるよう公開する。
// フィードカードで一度測った比率を詳細画面の初期 state にシードして、
// 4:3 (1.333) プレースホルダ → 実比率 のレイアウトシフトを消す (TTL 切れ/未測定は undefined)。
export function getCachedAspect(url: string): number | undefined {
  const cached = _aspectCache.get(url);
  if (cached && Date.now() - cached.ts < _ASPECT_TTL_MS) return cached.ratio;
  return undefined;
}

function shortHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ────────────────────────────────────────────────────────────────────
// Module-scope constants (拡張予定のため保持。現時点では sub-component で管理)
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// Module-level StyleSheet — 静的な inline style を一度だけ作って共有する。
// メモ: React Native の StyleSheet.create は数値 ID へ凍結するので、
//   子コンポーネントに渡したときに `===` で参照同値判定されやすくなり、
//   各カードの re-render 時の reconciliation コストが大幅に下がる。
// 動的な (props/state に依存する) style は useMemo か per-item ファクトリで処理する。
// ────────────────────────────────────────────────────────────────────
// 旧 `STYLES = StyleSheet.create(...)` だと module top-level で C が
// capture されてしまい、テーマ切替で色が変わらない (StyleSheet は 1 回しか
// 評価されない)。factory にして component 内 useMemo で C 毎に再生成する。
// 同テーマ render では useMemo が同一参照を返すので reconciliation コストは増えない。
// makeStyles は factory 経由で STYLES.xxx として参照されるため、静的解析では
// no-unused-styles が全キーを未使用と誤報する。実際にはすべて JSX 内で使用済み。
// ────────────────────────────────────────────────────────────────────
// makeStyles — AnonPostCard が直接 render するブロック専用の動的スタイル。
// ヘッダー (→ PostCardHeader) とアクション行 (→ PostCardActions) の style は
// それぞれのコンポーネントが内部で管理するため、ここには含めない。
// ────────────────────────────────────────────────────────────────────
/* eslint-disable react-native/no-unused-styles */
const makeStyles = (C: ColorPalette) => StyleSheet.create({
  // CW — iOS-native: 角 12px、amber border は少し透ける (44 = 27% alpha) と上品
  cwBox: {
    marginTop: SP['2'],
    paddingHorizontal: 0,
    paddingVertical: SP['4'],
    backgroundColor: C.bg3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.amber + '88',
    alignItems: 'center',
    gap: SP['1'],
  },
  cwEmoji: { fontSize: 32 },
  cwLabel: { color: C.amber, fontWeight: '700' },
  cwWarning: { color: C.text2, textAlign: 'center' },
  cwTap: { color: C.accent, marginTop: 4 },

  // メディア — iOS-native: 角 16px
  mediaWrap: { gap: 2, marginTop: SP['3'] },
  mediaItemBase: {
    backgroundColor: C.bg2,
    borderRadius: 16,
    overflow: 'hidden',
    alignSelf: 'center' as const,
  },

  // 本文 — Apple News 寄り: fontSize 15 / lineHeight 23
  bodyInner: { paddingTop: SP['3'], paddingBottom: SP['1'] },
  bodyText: { color: C.text, fontSize: 15, lineHeight: 23, letterSpacing: -0.08 },
  // BBS タイトル見出し (T.h3 と結合して使用)
  bbsTitle: { color: C.text, fontWeight: '700', letterSpacing: -0.3 },
  // 出典 — iOS-native: 角 12px, hairline divider
  sourceBtn: {
    marginTop: SP['2'],
    paddingHorizontal: SP['3'],
    paddingVertical: 10,
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.divider,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
  },
  sourceEmoji: { fontSize: 14 },
  sourceText: { color: C.text2, flex: 1 },

  // リアクション表示行
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: SP['2'],
  },
  reactionPillBase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: R.full,
    borderWidth: 1,
  },
  reactionOverflowPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'transparent',
    borderRadius: R.full,
    borderWidth: 1,
    borderColor: C.border,
  },
  reactionOverflowText: { fontSize: 12, color: C.text3, fontWeight: '700' },
});
/* eslint-enable react-native/no-unused-styles */

// ────────────────────────────────────────────────────────────────────
// Per-item / 動的 style ファクトリ — リアクション pill に使用
// ────────────────────────────────────────────────────────────────────

function reactionPillColors(C: ColorPalette, mine: boolean): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: mine ? C.accentBg : 'transparent',
    borderColor: mine ? C.accent : C.border,
  };
}

function reactionPillLabel(C: ColorPalette, mine: boolean): { fontSize: number; color: string; fontWeight: '700' } {
  return { fontSize: 11, color: mine ? C.accentLight : C.text2, fontWeight: '700' };
}

function reactionPillCount(C: ColorPalette, mine: boolean): { fontSize: number; color: string; fontWeight: '700' } {
  return { fontSize: 10, color: mine ? C.accentLight : C.text3, fontWeight: '700' };
}

// ============================================================
// SingleMediaItem — 単一画像の Pressable ラッパ (memo 化で onPress の anonymous arrow を排除)
// ------------------------------------------------------------
// AnonPostCard の single-image `.map()` 内で `onPress={() => openLightbox(url)}` を
// 毎 render 生成すると、Pressable の reconciliation コストが増える。
// url + onOpenLightbox を props で受け取り内部で bind することで安定化する。
// ============================================================
type SingleMediaItemProps = {
  url: string;
  blurhash?: string;
  aspect: number;
  mediaW: number;
  mediaMaxH: number;
  cwCategory: CWCategory;
  mediaItemBaseStyle: object;
  onOpenLightbox: (url: string) => void;
};
function SingleMediaItemInner({
  url,
  blurhash,
  aspect,
  mediaW,
  mediaMaxH,
  cwCategory,
  mediaItemBaseStyle,
  onOpenLightbox,
}: SingleMediaItemProps) {
  const handlePress = useCallback(() => onOpenLightbox(url), [onOpenLightbox, url]);
  const pressableStyle = useMemo(() => ({ flex: 1 }), []);
  return (
    <View style={[mediaItemBaseStyle, mediaItemAspect(aspect, mediaW, mediaMaxH)]}>
      <MediaWithCWGuard cwCategory={cwCategory} blurhash={blurhash}>
        <Pressable
          onPress={handlePress}
          style={pressableStyle}
          accessibilityRole="imagebutton"
          accessibilityLabel="画像を拡大表示"
        >
          <ProgressiveImage
            uri={url}
            blurhash={blurhash}
            width="100%"
            height="100%"
            radius={16}
            contentFit="contain"
            lazy
            thumbWidth={480}
            priority="high"
          />
        </Pressable>
      </MediaWithCWGuard>
    </View>
  );
}
const SingleMediaItem = memo(SingleMediaItemInner);

// ============================================================
// ReactionPill — リアクション行の 1 pill を memo 化したコンポーネント
// ------------------------------------------------------------
// AnonPostCard の reactions.map() 内で reactionPillColors/Label/Count を
// 毎 render 呼ぶと、各 pill が毎 render 新しい style オブジェクトを受け取り
// reconciliation コストが増える。pill を memo 化して onPress も useCallback で
// 安定化することで r.count/r.mine が変わった時のみ再 render させる。
// ============================================================
type ReactionPillProps = {
  meme: string;
  count: number;
  mine: boolean;
  onReact: (meme: string) => void;
};
function ReactionPillInner({ meme, count, mine, onReact }: ReactionPillProps) {
  const C = useColors();
  const STYLES = useMemo(() => makeStyles(C), [C]);
  const pillColorStyle = useMemo(() => reactionPillColors(C, mine), [C, mine]);
  const labelStyle = useMemo(() => reactionPillLabel(C, mine), [C, mine]);
  const countStyle = useMemo(() => reactionPillCount(C, mine), [C, mine]);
  const handlePress = useCallback(() => onReact(meme), [onReact, meme]);
  return (
    <PressableScale
      onPress={handlePress}
      haptic="tap"
      hitSlop={10}
      accessibilityLabel={`${meme} ${count} 件 ${mine ? '(押下済み)' : ''}`}
      style={[STYLES.reactionPillBase, pillColorStyle]}
    >
      <Text style={labelStyle}>{meme}</Text>
      <Text style={countStyle}>{count}</Text>
    </PressableScale>
  );
}
const ReactionPill = memo(ReactionPillInner);

// ============================================================
// QuotePostMiniLoader — quote_post_id から引用先を fetch して表示
// ------------------------------------------------------------
// AnonPostCard 内専用の小ローダ。postId を受け取り、useQuery で
// fetchQuotedPost を呼び出し、結果を QuotePostMini に渡す。
// ★ perf: TanStack Query を使うことで同 postId への並列 fetch が自動 dedup され、
//   FlashList の cell recycle でも staleTime:60s の cache から即時表示できる。
//   旧 useEffect/useState パターンでは同一 postId が複数カードに出現すると N 回
//   fetch が走り、recycle のたびにも再 fetch していた。
// - ロード中はスケルトンプレースホルダーを表示してレイアウトシフトを防ぐ
// - 削除済み/エラー時は null を QuotePostMini に渡してプレースホルダ表示
// - router.push で詳細画面へ遷移
// ============================================================
function QuotePostMiniLoaderInner({ postId, onPress }: { postId: string; onPress: () => void }) {
  const C = useColors();

  const { data: quotedPost, isLoading } = useQuery({
    queryKey: ['quoted-post', postId],
    queryFn: () => fetchQuotedPost(postId),
    staleTime: 60_000,
    enabled: !!postId,
  });

  // ロード中 → スケルトンプレースホルダーを表示してレイアウトシフトを防ぐ
  if (isLoading) {
    return (
      <View
        style={{
          height: 72,
          backgroundColor: C.bg3,
          borderRadius: R.lg,
        }}
      />
    );
  }

  // QuotePostMini は content?: string / title?: string (undefined) を期待するが
  // QuotedPostPreview.content / title は string | null — null → undefined に正規化する。
  // quotedPost が undefined (fetch 前 or エラー) または null (削除済み) の場合は null を渡す。
  const mini = quotedPost == null ? null : {
    id: quotedPost.id,
    content: quotedPost.content ?? undefined,
    title: quotedPost.title ?? undefined,
    tag_names: quotedPost.tag_names,
    created_at: quotedPost.created_at,
  };
  return <QuotePostMini post={mini} onPress={onPress} />;
}
const QuotePostMiniLoader = memo(QuotePostMiniLoaderInner);

// ────────────────────────────────────────────────────────────────────
// AnonPostCardProps の分割定義 (Interface Segregation Principle)
// ────────────────────────────────────────────────────────────────────

/** 投稿カードの主データ (post 本体 + フィード付帯データ) */
export type AnonPostCardData = {
  post: Post;
  reactions?: ReactionAgg[];
  addedTags?: string[];
  poll?: Poll;
  reason?: { text: string; kind: string };
  communities?: PostCommunityRef[];
};

/** 閲覧者の投稿に対するインタラクション状態 */
export type AnonPostViewerState = {
  liked?: boolean;
  concerned?: boolean;
  saved?: boolean;
  /** de-anon Phase2: server 供給の「自分の投稿か」フラグ (author_id 非依存) */
  isOwn?: boolean;
};

/** AnonPostCard の表示コンテキスト */
export type AnonPostDisplayContext = {
  /**
   * Reddit スタイル表示の切り替え。
   *   'home'      (既定): コミュニティ icon + 名前を主役に表示
   *   'community' : 投稿者本人のアバター + 擬似ハンドル(id)を主役に表示
   */
  viewContext?: 'home' | 'community';
};

/** AnonPostCard の安定化済みインタラクションハンドラ群 */
export type AnonPostInteractionCallbacks = {
  onLike: () => void;
  onConcern: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
  onReact: (meme: string) => void;
  onMore: () => void;
  onTagPress: (name: string) => void;
  /** 引用投稿ボタン — 未指定時はボタン非表示 */
  onQuote?: () => void;
  onAddTag?: (tag: string) => Promise<void> | void;
  onCommunityPress?: (id: string) => void;
};

/** AnonPostCard が受け取るすべての props を合成した型 */
type AnonPostCardProps =
  AnonPostCardData &
  AnonPostViewerState &
  AnonPostDisplayContext &
  AnonPostInteractionCallbacks;

function AnonPostCardInner({
  post,
  liked = false,
  concerned = false,
  saved = false,
  isOwn,
  reactions = [],
  addedTags: _addedTags = [],
  poll,
  reason: _reason,
  communities = [],
  onLike,
  onComment,
  onSave,
  onShare,
  onQuote,
  onTagPress: _onTagPress,
  onMore,
  onReact,
  onAddTag: _onAddTag,
  onCommunityPress,
  viewContext = 'home',
}: AnonPostCardProps) {
  const t = useT();
  const qc = useQueryClient();
  // ★ テーマ購読 — light/dark で全 style が再評価される。
  //   makeStyles は新 StyleSheet を生成するが useMemo で同テーマ render では
  //   同一参照を返すので、Card 再 render は色変化のときだけ。
  const C = useColors();
  const STYLES = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();

  // ★ de-anon Phase2: pseudonym_id は PostCardHeader へのルーティング用
  const pseudonymId = post.pseudonym_id ?? null;
  const goToPseudoProfile = useCallback(() => {
    if (pseudonymId) router.push(`/user/${pseudonymId}` as never);
  }, [router, pseudonymId]);

  // ★ ModActionMenu 配線 (mod だけに見える 3-dot)
  // post.community_id は型に無いが post_communities junction で 1 件以上紐付く。
  // 先頭の community を「主担当 community」と見做し、その mod 権限で判定。
  // (共通的に 1 post = 1 primary community なので衝突は実質起きない)
  const primaryCommunity = communities[0];
  const primaryCommunityId = primaryCommunity?.community_id;
  const isMod = useIsCommunityMod(primaryCommunityId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  // de-anon Phase2: server 供給の is_own を優先 (author_id 非依存)。is_own 未配線の経路
  //   (周辺データ未ロード中など) では従来の author_id 比較に fallback (2b で author_id 除去後は false)。
  const isOwnPost = isOwn ?? (!!post.author_id && post.author_id === currentUserId);

  // ユーザーブロック — ... メニューの「ユーザーをブロック」から実行
  const blockUser = useBlockStore((s) => s.blockUser);
  const unblockUser = useBlockStore((s) => s.unblockUser);
  const show = useToastStore((s) => s.show);
  const handleBlockUser = useCallback(() => {
    const pid = post.pseudonym_id;
    if (!pid) return;
    Alert.alert(
      'ユーザーをブロック',
      'このユーザーの投稿を非表示にしますか？',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'ブロック',
          style: 'destructive',
          onPress: () => {
            // Warning haptic は iOS の破壊的アクション標準 (NotificationFeedback.Warning)
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            blockUser(pid, 'harassment');
            // ネストした Alert はやめ、undo 付き toast に変更 (Android での nested Alert 問題も回避)
            show('ブロックしました', 'info', {
              undoLabel: '元に戻す',
              onUndo: () => unblockUser(pid),
            });
          },
        },
      ],
    );
  }, [post.pseudonym_id, blockUser, unblockUser, show]);

  // 「…」タップで「押された全スタンプ」一覧シートを開く
  const [reactionsDetailOpen, setReactionsDetailOpen] = useState(false);
  const reactionsList = reactions;
  // myReactionsForPost は MemeReactionPicker の `picked` に渡る — 毎 render 新 array
  // を作ると Picker 側 effect が無駄発火する。 reactions ref が変わらない限り stable。
  const myReactionsForPost = useMemo(
    () => reactions.filter((r) => r.mine).map((r) => r.meme),
    [reactions],
  );

  // CW (content warning) 開示状態
  const cwCategory = post.cw_category ?? null;
  const [cwRevealed, setCwRevealed] = useState(false);
  const isCwHidden = !!cwCategory && !cwRevealed;

  // 画像ライトボックス (tap で開く全画面ビューア)
  // 開いている画像 URL を保持 — null なら閉じている状態
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const openLightbox = useCallback((url: string) => {
    hap.tap();
    // 元画像 (フィードでは 480px サムネだが、ライトボックスでは大きく
    // 表示するため 1280px に格上げする。Supabase の transform endpoint
    // は元画像が小さければ自動でクランプしてくれるので過剰サイズは無問題)
    setLightboxUri(thumbedUrl(url, 1280));
  }, []);
  const closeLightbox = useCallback(() => setLightboxUri(null), []);

  // Feature flags
  const useMarkdown = useFeatureFlag('markdown_render');
  const useOgPreview = useFeatureFlag('og_preview');
  // NOTE: quick_reaction flag は将来利用予定 (現時点では UI 未配線のため購読しない)

  const { width: winW, height: winH } = useWindowDimensions();
  const mediaW = mediaContainerWidth(winW);
  // 高さ上限: 画面高の ~58%。
  // 投稿ヘッダー(~130px) + 画像 + リアクション(~50px) が 1 画面に収まる上限。
  // iPhone 3:4 は自然高さ(≈winW/0.75)が 58% 未満になりやすく全幅表示になる。
  // 9:16 などの超縦長は比例縮小して全体を表示 (クロップしない)。
  const mediaMaxH = Math.round(winH * 0.58);

  // OG カード対象 URL: 明示的な source_url を優先し、無ければ本文中の最初の URL を拾う。
  const previewUrl = useMemo(
    () => post.source_url || extractFirstUrl(post.content),
    [post.source_url, post.content],
  );

  // 翻訳 (自動翻訳のみ — UI ボタン/バッジは表示しない)
  // selector: AnonPostCard は feed の全 post で大量にマウントされるので
  // languageStore の他フィールド変更で全 card が再 render されないように selector 化
  const lang = useLanguageStore((s) => s.lang);
  const autoTranslate = useLanguageStore((s) => s.autoTranslate);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const canTranslate = lang !== 'ja' && post.content;

  // ★ perf: useCallback で安定化 — render ごとに async 関数が再定義されるのを防ぐ。
  //   deps に translating を含めて二重発火を防ぐ (effect 側の !translating ガードと対)。
  const doTranslate = useCallback(async () => {
    if (!post.content || translating) return;
    setTranslating(true);
    const result = await translateDynamic(post.content, lang);
    setTranslated(result);
    setTranslating(false);
  }, [post.content, translating, lang]);

  useEffect(() => {
    if (autoTranslate && canTranslate && !translated && !translating) {
      void doTranslate();
    }
  }, [autoTranslate, canTranslate, translated, translating, doTranslate]);
  // リンクカードを出すときは本文から対象 URL/「[リンク]」を隠す (URLはカードに置き換え)
  const displayContent = stripPreviewUrl(
    (autoTranslate && translated) ? translated : post.content,
    (previewUrl && useOgPreview) ? previewUrl : null,
  );
  // データ欠落でクラッシュしないよう全フィールドを安全化。
  // post ref は memo の arePropsEqual で stable なので、これらは
  // post 変化時のみ新規 array になる (= ほぼ常に同 ref)。
  const mediaUrls = useMemo(() => post.media_urls ?? [], [post.media_urls]);
  const mediaBlurhashes = useMemo(() => post.media_blurhashes ?? [], [post.media_blurhashes]);
  // 動画 (migration 0043 後の投稿のみ存在)。古い投稿は undefined → 空配列で安全
  const videoUrls = useMemo(() => post.video_urls ?? [], [post.video_urls]);
  const videoPosters = useMemo(() => post.video_posters ?? [], [post.video_posters]);
  // tag_names / addedTags は検索 index 用に props で受け取り続けるが、
  //   - feed カード UI には render しない (ハッシュタグ非表示方針)
  //   - 「+ タグ追加」 UI も廃止 (周りの人が他人投稿に tag を付与できない)
  // 旧コードの tagNames / restTagNames / filteredAddedTags useMemo は撤去。

  // 画像の自然なアスペクト比を解決 — Image.getSize は web/native 両対応
  // tall portrait や wide landscape を square に潰さないよう、各 URI ごとに記録
  // 0.5 (極端な縦長) 〜 2.0 (極端な横長) でクランプして UI 暴走を防ぐ
  //
  // 重要: getSize はオリジナル URL を渡すと**フル画像をダウンロードして**寸法を測る。
  // フィードでは数 MB の画像を 4 枚並べると合計 10MB 超 → モバイル/3G で
  // 「画像が出るまで真っ暗 (= 親 View の C.bg しか見えない)」現象が起きる。
  // → thumbedUrl 経由の 240px サムネで getSize を呼ぶ (比率計算なので最小幅で十分)。
  //   旧版は 720px で measure していたが、表示用は ProgressiveImage が別途 fetch する
  //   ので measure 専用ならもっと小さくて良い。240 にして帯域 1/9 + decode コスト削減。
  // モジュールレベルキャッシュからシード — 同 URL を一度測れば後はゼロコスト
  const [imgAspects, setImgAspects] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const u of mediaUrls) {
      if (!u) continue;
      const r = _aspectCache.get(u);
      if (r !== undefined) seed[u] = r.ratio;
    }
    return seed;
  });
  useEffect(() => {
    if (mediaUrls.length === 0) return;
    let alive = true;
    for (const url of mediaUrls) {
      if (!url) continue;
      // キャッシュヒット時は getSize を呼ばない
      if (_aspectCache.has(url)) {
        const r = _aspectCache.get(url)!;
        setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: r.ratio }));
        continue;
      }
      // format=origin: オリジナル JPEG のまま 240px にリサイズ。
      // WebP 変換すると Supabase が EXIF rotation を適用せず portrait サムネを
      // 返すケースがあり、RNImage.getSize が縦長の誤った比率を返す原因となる。
      // origin 形式なら EXIF が保持されるため iOS/Android で正しく回転して測定できる。
      const measureUri = thumbedUrl(url, 240, { format: 'origin' });
      measureAspect(url, measureUri, (ratio) => {
        if (!alive) return;
        setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: ratio }));
      });
    }
    return () => {
      alive = false;
    };
    // mediaUrls は post から派生する配列 ref なので毎 render 新規 — join して安定化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrls.join('|')]);
  const likesCount = post.likes_count ?? 0;
  // 表示用 likes 数 — Vote Fuzzing (#3) で post_id seed の決定的 noise を加える。
  // 実 ranking / score / lowTrust 計算は real value (likesCount) のまま使う。
  // ★ 自分の like 由来の ±1 は fuzz に飲み込ませず必ず反映させる (getDisplayLikesForViewer)。
  //   fuzz を「自分を除いた票数」に対して計算 → tier 境界 (10↔11 等) でも自分の操作が
  //   表示上で確実に ±1 になる。「いいね押しても数字が変わらない」UX バグの根本修正。
  const displayLikesCount = getDisplayLikesForViewer(post.id, likesCount, liked);
  const commentsCount = post.comments_count ?? 0;
  const hasMedia = mediaUrls.length > 0 || videoUrls.length > 0;

  // シェアボタン: タップ→ 共有オプションシート (X/Threads 流)
  // 長押しは廃止し、シングルタップでシートを開いて全オプションを表示する。
  // OS ネイティブシェアは選択肢の 1 つとしてシート内に収める。
  const handleShare = useCallback(() => {
    hap.tap();
    // 親 onShare も呼ぶ (親側の副作用がある場合に備える)
    onShare();
    Alert.alert(
      '共有オプション',
      undefined,
      [
        {
          text: 'シェア (OS標準)',
          onPress: () => {
            void sharePost(post).catch(() => {
              show('シェアに失敗しました', 'error');
            });
          },
        },
        {
          text: 'X でシェア',
          onPress: () => {
            void shareToX(post).catch(() => {
              show('X のシェアに失敗しました', 'error');
            });
          },
        },
        {
          text: 'リンクをコピー',
          onPress: () => {
            const copied = copyPostLink(post);
            // copyPostLink は @react-native-clipboard を試みるが、プロジェクトでは
            // expo-clipboard を使っているため直接フォールバックする
            const url = `https://geek-app.netlify.app/post/${post.id}`;
            const copyPromise = copied
              ? Promise.resolve()
              : Clipboard.setStringAsync(url);
            void copyPromise.then(() => {
              show('リンクをコピーしました', 'success');
            }).catch(() => {
              show('コピーに失敗しました', 'error');
            });
          },
        },
        {
          text: '埋め込みコードをコピー',
          onPress: () => {
            const embedHtml = getEmbedCode(post);
            void Clipboard.setStringAsync(embedHtml).then(() => {
              show('埋め込みコードをコピーしました', 'success');
            }).catch(() => {
              show('コピーに失敗しました', 'error');
            });
          },
        },
        { text: 'キャンセル', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }, [post, onShare, show]);

  const openSource = useCallback(() => {
    if (!previewUrl) return;
    // sanitizeUrl は http/https 以外を null にする — javascript:/data:/vbscript: XSS 防止
    const safe = sanitizeUrl(previewUrl);
    if (!safe) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(safe, '_blank', 'noopener,noreferrer');
    } else {
      // 旧: silent fail。新: safeOpenUrl で失敗時 toast を表示
      void safeOpenUrl(safe);
    }
  }, [previewUrl]);

  // CW 開示 — `() => setCwRevealed(true)` を JSX inline で書くと毎 render 新 ref
  const revealCw = useCallback(() => setCwRevealed(true), []);
  // ピッカー開閉 — 同様に inline arrow を避ける
  // primary community を tap したときのハンドラ — onCommunityPress / primaryCommunityId
  // が変わったときだけ新 ref。
  const onPrimaryCommunityPress = useCallback(() => {
    if (primaryCommunityId) onCommunityPress?.(primaryCommunityId);
  }, [onCommunityPress, primaryCommunityId]);
  // ModActionMenu 完了時の invalidate ハンドラ — qc は安定 ref。
  const onModActionComplete = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['feed-page'] });
    qc.invalidateQueries({ queryKey: ['feed'] });
    qc.invalidateQueries({ queryKey: ['community-feed'] });
  }, [qc]);
  // ... ボタン — タップでブロック/報告オプションを含むシートを表示
  // 旧: onLongPress で handleBlockUser を呼ぶ (不可視の affordance)
  // 新: タップでシートを開き「ユーザーをブロック」「投稿を報告」を明示的に表示
  const handleMoreMenu = useCallback(() => {
    const canBlock = !isOwnPost && !!post.pseudonym_id;
    const options: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [];
    if (canBlock) {
      options.push({
        text: 'ユーザーをブロック',
        style: 'destructive',
        onPress: handleBlockUser,
      });
    }
    options.push({
      text: '投稿を報告',
      onPress: onMore,
    });
    options.push({ text: 'キャンセル', style: 'cancel' });
    Alert.alert('その他のオプション', undefined, options, { cancelable: true });
  }, [isOwnPost, post.pseudonym_id, handleBlockUser, onMore]);

  // ============================================================
  // 投稿詳細を「即開く」prefetch + seed (latency 改善 / spinner 撲滅)
  // ------------------------------------------------------------
  // カードタップで /post/:id へ遷移する瞬間、詳細画面が再 fetch する
  // ['post', id] と ['feed-page', userId, [id]] の 2 cache を、カードが
  // 既に持っているデータ (post / reactions / communities / liked 等) から
  // 先回りでシードする。これにより PostDetail は mount 時に cache hit で
  // 即描画でき、postLoading spinner と 2 RTT (fetchPostById + get_feed_page)
  // が critical path から消える。
  //   - setQueryData は `(prev) => prev ?? seed` で既存 (より新しい) cache を
  //     上書きしない。詳細側は staleTime 経過後に background revalidate するので
  //     初期描画は即時、データ鮮度も保たれる。
  //   - ['feed-page'] の key は useFeedPage と完全一致させる
  //     ([prefix, userId ?? 'anon', stableKeyFor([id])])。
  const handleOpenDetail = useCallback(() => {
    try {
      // 1) 投稿本文 — fetchPostById は Post を返すので post prop をそのままシード
      qc.setQueryData<Post | null>(['post', post.id], (prev) => prev ?? post);
      // 2) 周辺データ (reactions / my_* / communities / poll) — 単一 id 用 feed-page cache
      const feedPageSeed: FeedPagePost = {
        ...post,
        communities,
        official_author: post.official_author ?? null,
        my_like: liked,
        my_concern: concerned,
        my_save: saved,
        reactions: reactionsList,
        added_tags: _addedTags,
        poll: poll ?? null,
        is_own: isOwnPost,
        // deanon: 表示は community-first に戻したが、詳細画面 (Stage2b) 用に
        //   avatar/pseudonym は seed に通しておく (FeedPagePost が要求)。
        avatar_url: post.avatar_url ?? null,
        avatar_emoji: post.avatar_emoji ?? null,
        pseudonym_id: post.pseudonym_id ?? null,
      };
      const feedPageKey = ['feed-page', currentUserId ?? 'anon', stableKeyFor([post.id])];
      qc.setQueryData<FeedPagePost[]>(feedPageKey, (prev) => prev ?? [feedPageSeed]);
    } catch {
      // seed は best-effort。失敗しても通常遷移にフォールバックする (UX 影響なし)
    }
    onComment();
  }, [
    qc,
    post,
    communities,
    liked,
    concerned,
    saved,
    reactionsList,
    _addedTags,
    poll,
    currentUserId,
    onComment,
    isOwnPost,
  ]);

  // 引用先投稿の詳細画面へ遷移 — quote_post_id が変わる時のみ新 ref。
  const handleOpenQuoteDetail = useCallback(() => {
    if (post.quote_post_id) {
      router.push(`/post/${post.quote_post_id}` as never);
    }
  }, [router, post.quote_post_id]);

  // ── 動的 style: props/state に依存するもののみ useMemo 化 ──
  // ルート Container — X(旧Twitter)/Threads 風の「フラットな全幅行」。
  //   - 背景: transparent (カード面 bg2 を撤廃。地 (C.bg) に溶ける。light でも正)
  //   - 角丸 / 全周 border / shadow / 投稿間 gap(marginBottom) を全て撤廃
  //   - 区切りは下罫線 hairline (C.divider) のみ。隙間を空けず罫線で分ける。
  //   - 横/縦 padding は 16 / 12 / 12 で全行の左端を 16px に一元化。
  //   - low-trust は外枠で強調せず、行内の lowTrustBanner が担う。
  //   - maxWidth:720 + alignSelf:center は PC 幅で中央 720 列に寄せる (X と同様)。
  const containerStyle = useMemo(
    () => ({
      backgroundColor: 'transparent' as const,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.divider,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      maxWidth: 720,
      alignSelf: 'center' as const,
      width: '100%' as const,
    }),
    [C.divider],
  );

  // ============================================================
  // Press feedback — フラット行の「背景ハイライト」
  // ------------------------------------------------------------
  // カードを撤廃したので scale/shadow の "lift" はやめ、行タップ中に背景を
  // transparent → C.bg2 へ薄く差し込む X/Threads 風ハイライトに置換する。
  //   - pressLift 0→1 を本文/タイトルの onPressIn/onPressOut が駆動 (流用)。
  //   - interpolateColor で transparent↔bg2 を補間 → 行全体がふっと沈む。
  // 離す: spring で滑らかに戻す。ReducedMotion: 常に transparent (変化なし)。
  // shared value 駆動なので 100 件 mount でも cheap (React state ではない)。
  // ============================================================
  const reduceMotionForCard = useReducedMotion();
  const pressLift = useSharedValue(0);

  // 本文の press feedback ハンドラを useCallback で安定化
  // (inline arrow だと毎 render 新 ref → 子 Pressable の reconciliation コストが増える)
  const handleBodyPressIn = useCallback(() => {
    if (reduceMotionForCard) return;
    pressLift.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) });
  }, [reduceMotionForCard, pressLift]);
  const handleBodyPressOut = useCallback(() => {
    if (reduceMotionForCard) return;
    pressLift.value = withSpring(0, SPRING_SNAPPY);
  }, [reduceMotionForCard, pressLift]);

  const animatedShadowStyle = useAnimatedStyle(() => {
    if (reduceMotionForCard) {
      return { backgroundColor: 'transparent' };
    }
    return {
      backgroundColor: interpolateColor(
        pressLift.value,
        [0, 1],
        ['transparent', C.bg2],
      ),
    };
  });

  // 本文 Text/Markdown 用 — T.body と body color を結合
  // 旧コード: deps が `[]` で STYLES.bodyText (テーマ変化で別 ref) を捉えていなかった
  // → light/dark 切替で本文色だけ残るバグの恐れ。STYLES を deps に追加。
  const bodyTextStyle = useMemo(() => [T.body, STYLES.bodyText], [STYLES.bodyText]);
  // BBS タイトル — T.h3(18/26) に格上げして本文(15)との見出し階層を立てる。
  const bbsTitleStyle = useMemo(() => [T.h3, STYLES.bbsTitle], [STYLES.bbsTitle]);

  // Reaction カウント色 — 自分のリアクション有無で変わる (reactions pill row で使用)
  const hasMyReaction = myReactionsForPost.length > 0;

  const cwLabelStyle = useMemo(() => [T.smallM, STYLES.cwLabel], [STYLES.cwLabel]);
  const cwWarningStyle = useMemo(
    () => [T.caption, STYLES.cwWarning],
    [STYLES.cwWarning],
  );
  const cwTapStyle = useMemo(() => [T.caption, STYLES.cwTap], [STYLES.cwTap]);
  const containerStyleCombined = useMemo(
    () => [containerStyle, animatedShadowStyle],
    [containerStyle, animatedShadowStyle],
  );

  // Obsidian ノート — PostCardActions に渡す。毎 render postToObsidianNote を
  // 呼ばないよう useMemo で安定化 (post が変わる時のみ再計算)。
  const obsidianNote = useMemo(() => postToObsidianNote(post), [post]);

  // リアクション表示行の「もっと見る」ハンドラ — PressableScale (memo済) に渡す anonymous arrow を避ける
  const openReactionsDetail = useCallback(() => setReactionsDetailOpen(true), []);
  const closeReactionsDetail = useCallback(() => setReactionsDetailOpen(false), []);

  // 引用プレビューラッパの inline style — post.quote_post_id が変わる時のみ新規オブジェクト
  // (SP['2'] は定数なのでほぼ常に同 ref だが、JSX inline では毎 render 新規になるため memoize)
  const quoteMiniWrapStyle = useMemo(
    () => ({ marginTop: SP['2'], marginBottom: SP['2'] }),
    // SP は module-level 定数なので deps なし
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // BBS タイトル行の inline style — post.content 有無で paddingBottom が変わる
  const bbsTitleWrapStyle = useMemo(
    () => ({ paddingTop: SP['3'], paddingBottom: post.content ? SP['1'] : SP['3'] }),
    [post.content],
  );

  // FeedMediaGrid onPress — mediaUrls が変わる時のみ新 ref。
  // 複数画像グリッド用。openLightbox は useCallback 済み。
  const onMediaGridPress = useCallback(
    (idx: number) => openLightbox(mediaUrls[idx]!),
    [openLightbox, mediaUrls],
  );

  // FeedMediaGrid items — imgAspects / mediaUrls / mediaBlurhashes のいずれかが変わった時のみ再計算
  const mediaGridItems = useMemo(
    () => mediaUrls.map((u, i) => ({ uri: u, blurhash: mediaBlurhashes[i], aspect: imgAspects[u] })),
    [mediaUrls, mediaBlurhashes, imgAspects],
  );

  // Twitter/Threads-style full-width row: no outer rounded card, just a
  // hairline divider between posts. Looks more "premium feed" than a
  // floating-card grid on tall screens.
  return (
    <Animated.View style={containerStyleCombined}>
      {/* ヘッダー — PostCardHeader に委譲 */}
      <PostCardHeader
        post={post}
        viewContext={viewContext}
        communities={communities}
        primaryCommunity={primaryCommunity}
        pseudonymId={pseudonymId}
        isOwnPost={isOwnPost}
        isMod={isMod}
        onPrimaryCommunityPress={onPrimaryCommunityPress}
        goToPseudoProfile={goToPseudoProfile}
        handleMoreMenu={handleMoreMenu}
        onModActionComplete={onModActionComplete}
      />

      {/* CW (content warning) ベール
          ※ コミュニティ表示は header 内 (anonMetaRow / officialMeta) に inline 化済み — 旧 chip row は削除 */}
      {isCwHidden && (
        <PressableScale
          onPress={revealCw}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={`${cwCategory === 'spoiler' ? 'ネタバレ' : cwCategory === 'nsfw' ? 'センシティブな内容' : cwCategory === 'violence' ? '暴力的描写' : '注意'} — タップして表示`}
          style={STYLES.cwBox}
        >
          <Text style={STYLES.cwEmoji}>
            {cwCategory === 'spoiler' ? '🤐' : cwCategory === 'nsfw' ? '🔞' : cwCategory === 'violence' ? '⚠️' : '🛡️'}
          </Text>
          <Text style={cwLabelStyle}>
            {cwCategory === 'spoiler' ? t('ネタバレ') : cwCategory === 'nsfw' ? t('センシティブな内容') : cwCategory === 'violence' ? t('暴力的描写') : t('注意')}
          </Text>
          {post.content_warning && (
            <Text style={cwWarningStyle}>
              {post.content_warning}
            </Text>
          )}
          <Text style={cwTapStyle}>{t('タップして表示')}</Text>
        </PressableScale>
      )}

      {/* ★ BBS 統合 (migration 0075) — title あれば content の上に大きく表示。
          スレ形式 post (旧 BBS thread) は title が main contentで、 content は ''。
          tap で post detail へ遷移 (本文 PressableScale と同じ behavior)。 */}
      {post.title && !isCwHidden ? (
        <View style={bbsTitleWrapStyle}>
          <PressableScale onPress={handleOpenDetail} haptic="tap" scaleValue={1}>
            <Text style={bbsTitleStyle} numberOfLines={3}>
              {post.title}
            </Text>
          </PressableScale>
        </View>
      ) : null}

      {/* 本文 — 外側カードの paddingHorizontal を流用 (double-padding 回避)
          ★ Reddit iOS 風 press feedback:
            - scaleValue=0.94 (default 0.96 より dramatic に「凹む」)
            - onPressIn で pressLift 0 → 1 (Animated.View の shadow が拡張)
            - onPressOut で spring で戻す
          tap → 即詳細遷移なので、scale + shadow expand の 1 瞬で「カードが lift up」体感。 */}
      {post.content && !isCwHidden ? (
        <View>
          <PressableScale
            onPress={handleOpenDetail}
            haptic="tap"
            scaleValue={1}
            onPressIn={handleBodyPressIn}
            onPressOut={handleBodyPressOut}
          >
            <View style={STYLES.bodyInner}>
              {useMarkdown ? (
                <MarkdownText
                  text={displayContent}
                  style={bodyTextStyle}
                  numberOfLines={hasMedia ? 3 : 8}
                />
              ) : (
                <Text style={bodyTextStyle} numberOfLines={hasMedia ? 3 : 8}>
                  {displayContent}
                </Text>
              )}
            </View>
          </PressableScale>
        </View>
      ) : null}

      {/* メディア — 文章の下に表示 (文章 → 写真/動画 の順)。
          自然なアスペクト比で表示 (square crop しない)
          縦長は 4:5 (MEDIA_MIN_ASPECT) を上限にクロップ表示しフィードを占有させない
          (画像全体はタップ→ライトボックスで確認可)。横長はそのまま全体表示
          複数枚は縦に積む (各画像が自身のアスペクト比を保持)
          外側カードの paddingHorizontal に揃え、premium feel の rounded corners

          NSFW / spoiler / violence は MediaWithCWGuard が per-item で
          blurhash + 「タップして表示」CTA で gate する。 sensitive は
          MediaWithCWGuard 側で素通し (ラベルのみ) なのでここでは特別扱い無し。
          body 側の cwBox とは独立: body は cwBox で、 media は per-item で
          reveal される。 */}
      {hasMedia && (
        <DoubleTapHeart onDoubleTap={onLike}>
          <View style={STYLES.mediaWrap}>
            {/* 複数画像 = X/IG/Reddit 流のグリッド (cover でセンタークロップ)。
                縦積みは縦長で「コンパクトでない」ため 2〜4 枚をグリッド化。 */}
            {mediaUrls.length >= 2 ? (
              <MediaWithCWGuard cwCategory={cwCategory} blurhash={mediaBlurhashes[0]}>
                <FeedMediaGrid
                  items={mediaGridItems}
                  onPress={onMediaGridPress}
                />
              </MediaWithCWGuard>
            ) : (
              /* single-tap でライトボックス。DoubleTapHeart(numberOfTaps 2) は通過。
                 SingleMediaItem は memo 化済み — url / aspect が変わる時のみ再 render。
                 ロード中は 4:3 (1.333) で仮置き → 解決後に真のアスペクト比へ差し替え。 */
              mediaUrls.map((url, i) => (
                <SingleMediaItem
                  key={url}
                  url={url}
                  blurhash={mediaBlurhashes[i]}
                  aspect={imgAspects[url] ?? 1.333}
                  mediaW={mediaW}
                  mediaMaxH={mediaMaxH}
                  cwCategory={cwCategory}
                  mediaItemBaseStyle={STYLES.mediaItemBase}
                  onOpenLightbox={openLightbox}
                />
              ))
            )}
            {/* 動画 (1 件まで前提だが、配列をループして将来複数対応) */}
            {videoUrls.map((vurl, i) => (
              <View
                key={`v-${vurl}`}
                style={[STYLES.mediaItemBase, mediaItemAspect(16 / 9, mediaW, mediaMaxH)]}
              >
                <MediaWithCWGuard cwCategory={cwCategory}>
                  <VideoPlayer uri={vurl} poster={videoPosters[i]} />
                </MediaWithCWGuard>
              </View>
            ))}
          </View>
        </DoubleTapHeart>
      )}

      {/* リンクプレビュー — source_url か本文中の URL を OG カード化。
          flag ON: LinkPreviewCard (サーバーが取得した og:title/description/image)。
          flag OFF: 従来の出典バー。 */}
      {previewUrl && (
        useOgPreview ? (
          <LinkPreviewCard url={previewUrl} />
        ) : (
          <PressableScale onPress={openSource} haptic="tap" style={STYLES.sourceBtn}>
            <Text style={STYLES.sourceEmoji}>🔗</Text>
            <Text style={[T.caption, STYLES.sourceText]} numberOfLines={1}>
              出典: {shortHost(previewUrl)}
            </Text>
          </PressableScale>
        )
      )}

      {/* 投票 */}
      {poll && !isCwHidden && <PollCard poll={poll} />}

      {/* 引用投稿プレビュー — quote_post_id がある場合のみ表示
          marginTop/Bottom SP['2']=8px でコンテンツとの間隔を統一 */}
      {!!post.quote_post_id && (
        <View style={quoteMiniWrapStyle}>
          <QuotePostMiniLoader postId={post.quote_post_id} onPress={handleOpenQuoteDetail} />
        </View>
      )}

      {/* タグ群は feed カードでは非表示
          - ハッシュタグは見せない方針 (UI 雑音 + 押し付け感を排除)
          - 「+ タグ追加」UI も削除 (周りの人が他人投稿に tag を付与できないようにする)
          - DB の tag_names / added_tags は検索 index 用に残る */}

      {/* アクション行 — PostCardActions に委譲 (like/comment/quote/reaction/share/save) */}
      <PostCardActions
        liked={liked}
        saved={saved}
        displayLikesCount={displayLikesCount}
        commentsCount={commentsCount}
        reactionsList={reactionsList}
        myReactionsForPost={myReactionsForPost}
        hasMyReaction={hasMyReaction}
        onQuote={onQuote}
        obsidianNote={obsidianNote}
        onLike={onLike}
        onSave={onSave}
        onComment={handleOpenDetail}
        onShare={handleShare}
        onReact={onReact}
      />

      {/* リアクション表示行 */}
      {reactionsList.length > 0 && (
        <View style={STYLES.reactionsRow}>
          {reactionsList.slice(0, 5).map((r) => (
            <ReactionPill
              key={r.meme}
              meme={r.meme}
              count={r.count}
              mine={r.mine}
              onReact={onReact}
            />
          ))}
          {reactionsList.length > 5 && (
            <PressableScale
              onPress={openReactionsDetail}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="押された全スタンプを見る"
              style={STYLES.reactionOverflowPill}
            >
              <Text style={STYLES.reactionOverflowText}>…</Text>
            </PressableScale>
          )}
        </View>
      )}

      {/* 「…」から開く: 押された全スタンプの一覧 (閲覧 + タップでトグル) */}
      <ReactionListSheet
        visible={reactionsDetailOpen}
        onClose={closeReactionsDetail}
        reactions={reactionsList}
        onReact={onReact}
      />

      {/* 画像ライトボックス — tap 時に開く全画面ビューア。
          Modal は visible=false の間 lazy-render なので feed の全 card に
          1 つ持たせてもコストは無い。 */}
      <ImageLightbox
        visible={!!lightboxUri}
        uri={lightboxUri}
        onClose={closeLightbox}
      />
    </Animated.View>
  );
}

export const AnonPostCard = memo(AnonPostCardInner, (prev, next) => {
  // Re-render only when something this card actually cares about changed.
  if (prev.post !== next.post) return false;
  if (prev.liked !== next.liked) return false;
  if (prev.concerned !== next.concerned) return false;
  if (prev.saved !== next.saved) return false;
  if (prev.reactions !== next.reactions) return false;
  if (prev.addedTags !== next.addedTags) return false;
  if (prev.poll !== next.poll) return false;
  if (prev.reason !== next.reason) return false;
  if (prev.communities !== next.communities) return false;
  // Handler refs are kept stable by the parent (handlersByPostId memoization).
  if (prev.onLike !== next.onLike) return false;
  if (prev.onConcern !== next.onConcern) return false;
  if (prev.onComment !== next.onComment) return false;
  if (prev.onSave !== next.onSave) return false;
  if (prev.onShare !== next.onShare) return false;
  if (prev.onQuote !== next.onQuote) return false;
  if (prev.onTagPress !== next.onTagPress) return false;
  if (prev.onMore !== next.onMore) return false;
  if (prev.onReact !== next.onReact) return false;
  if (prev.onAddTag !== next.onAddTag) return false;
  if (prev.onCommunityPress !== next.onCommunityPress) return false;
  if (prev.viewContext !== next.viewContext) return false;
  return true; // skip re-render
});
