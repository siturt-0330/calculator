import { memo, useEffect, useMemo, useState } from 'react';
import { View, Text, Platform, Image as RNImage, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { safeOpenUrl } from '../../lib/openUrl';
import { Icon } from '../../constants/icons';
import type { Post } from '../../types/models';
import { useLanguageStore } from '../../stores/languageStore';
import { useAuthStore } from '../../stores/authStore';
import { translateDynamic, useT } from '../../lib/i18n';
import { MemeReactionPicker } from './MemeReactionPicker';
import type { ReactionAgg } from '../../lib/api/reactions';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { ProgressiveImage } from '../ui/ProgressiveImage';
import { VideoPlayer } from '../ui/VideoPlayer';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { DoubleTapHeart } from '../ui/DoubleTapHeart';
import { TagPill } from '../tag/TagPill';
import { AddTagInline } from '../tag/AddTagInline';
import { MarkdownText } from '../ui/MarkdownText';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PollCard } from './PollCard';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useIsCommunityMod } from '../../hooks/useIsCommunityMod';
import type { Poll } from '../../lib/api/polls';
import { Avatar } from '../ui/Avatar';
import { formatRelative } from '../../lib/utils/date';
import { SHADOW } from '../../design/shadows';
import { sanitizeUrl } from '../../lib/sanitize';
import { ObsidianSaveButton } from '../ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';
import type { PostCommunityRef } from '../../lib/api/posts';
import { OfficialBadge } from '../community/OfficialBadge';
import { ModActionMenu } from '../community/ModActionMenu';
import { MediaWithCWGuard } from '../post/MediaWithCWGuard';
import { getDisplayLikes } from '../../lib/utils/voteFuzz';

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
        const ratio = h > 0 && w > 0 ? Math.max(0.5, Math.min(2.0, w / h)) : 1;
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
  };
  if (_pending.size < _MAX_CONCURRENT) start();
  else _queue.push(start);
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
// Module-level StyleSheet — 静的な inline style を一度だけ作って共有する。
// メモ: React Native の StyleSheet.create は数値 ID へ凍結するので、
//   子コンポーネントに渡したときに `===` で参照同値判定されやすくなり、
//   各カードの re-render 時の reconciliation コストが大幅に下がる。
// 動的な (props/state に依存する) style は useMemo か per-item ファクトリで処理する。
// ────────────────────────────────────────────────────────────────────
const STYLES = StyleSheet.create({
  // 低信頼バナー
  lowTrustBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
    paddingHorizontal: SP['3'],
    paddingVertical: SP['2'],
    backgroundColor: C.amberBg,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.amber + '44',
    marginBottom: SP['2'],
  },
  lowTrustText: { color: C.amber, flex: 1 },

  // ヘッダー — gap を増やして nickname と avatar を分離、 type も明確に
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['3'],
  },
  officialAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accentBg,
    borderWidth: 1.5,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officialMeta: { flex: 1, minWidth: 0 },
  officialNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  // 公式管理者の名前は少し太く. fontSize は smallM の 13 を引き継ぐ
  officialName: { color: C.text, fontWeight: '700', letterSpacing: 0.2 },
  officialSub: { color: C.text3 },
  anonRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  // 「匿」をやや強めに、relative time は subtle に — Twitter/Threads と同じ階層感
  anonLabel: { color: C.text, fontWeight: '700', letterSpacing: 0.2 },
  anonRelative: { color: C.text3, fontSize: 11, lineHeight: 14 },
  morePress: { padding: 4 },

  // コミュニティピル
  communityWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: SP['2'],
  },
  communityChipBase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    height: 22,
    borderRadius: R.full,
    backgroundColor: C.bg3,
    borderWidth: 1,
  },
  communityChipText: { fontSize: 11, color: C.text2, fontWeight: '600' },

  // CW
  cwBox: {
    marginTop: SP['2'],
    paddingHorizontal: SP['4'],
    paddingVertical: SP['4'],
    backgroundColor: C.bg3,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.amber,
    alignItems: 'center',
    gap: SP['1'],
  },
  cwEmoji: { fontSize: 32 },
  cwLabel: { color: C.amber, fontWeight: '700' },
  cwWarning: { color: C.text2, textAlign: 'center' },
  cwTap: { color: C.accent, marginTop: 4 },

  // メディア
  mediaWrap: { gap: SP['2'], marginTop: SP['2'] },
  mediaItemBase: {
    width: '100%',
    backgroundColor: C.bg2,
    borderRadius: R.md,
    overflow: 'hidden',
  },

  // 本文 — 行間/サイズを引き上げて読みやすさを優先 (15→16 / 22→24)
  bodyInner: { paddingTop: SP['3'], paddingBottom: SP['1'] },
  bodyText: { color: C.text, fontSize: 15, lineHeight: 24 },
  // 出典
  sourceBtn: {
    marginTop: SP['2'],
    paddingHorizontal: SP['3'],
    paddingVertical: SP['2'],
    backgroundColor: C.bg3,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
  },
  sourceEmoji: { fontSize: 14 },
  sourceText: { color: C.text2, flex: 1 },

  // タグ群 — 上 padding を SP['3'] に上げて本文との視覚分離を強める
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: SP['3'],
    gap: SP['2'],
    alignItems: 'center',
  },

  // アクション行 — gap を揃え、左 4 アクション + spacer + 右 3 アクション の整列に
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: SP['3'],
    paddingBottom: 0,
    gap: SP['5'],
  },
  // 各 action は icon + count を gap:6 で詰める. tap target は hitSlop で確保 (44pt)
  actionPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 28,
  },
  commentCount: { color: C.text2, fontSize: 13, fontWeight: '600' },
  reactionEmoji: { fontSize: 20 },
  spacer: { flex: 1 },
  iconBtn: { padding: 4 },

  // リアクション表示行
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingTop: SP['2'],
  },
  reactionPillBase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SP['3'],
    // iOS の最小タップ領域 (44pt) に届くよう padding を確保。
    // 旧版 (vertical:4) は実効高さ ~24px → hitSlop:8 を足しても 40px で不足し、
    // スマホで「押しても反応しない」と感じるバグの主因だった。
    paddingVertical: 6,
    borderRadius: R.full,
    borderWidth: 1,
  },
  reactionOverflowPill: {
    paddingHorizontal: SP['3'],
    paddingVertical: 6,
    backgroundColor: C.bg3,
    borderRadius: R.full,
    borderWidth: 1,
    borderColor: C.border,
  },
  reactionOverflowText: { fontSize: 12, color: C.text3, fontWeight: '700' },
});

// ────────────────────────────────────────────────────────────────────
// Per-item / 動的 style ファクトリ — map 内で呼ばれるので useMemo は使わず、
// あらかじめ static base に差分だけ重ねた小オブジェクトを返す。
// この差分オブジェクト自体は毎 render 新規になるが、
//   - スタイル合成は配列 [base, diff] で行うので diff のキーだけが reconcile される
//   - base 側 (StyleSheet ID) は安定なので reconciliation コストは差分分のみ
// ────────────────────────────────────────────────────────────────────

function communityChipBorder(isOfficial: boolean): { borderColor: string } {
  return { borderColor: isOfficial ? C.accent + '66' : C.border };
}

function mediaItemAspect(aspect: number): { aspectRatio: number } {
  return { aspectRatio: aspect };
}

function reactionPillColors(mine: boolean): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: mine ? C.accentBg : C.bg3,
    borderColor: mine ? C.accent : C.border,
  };
}

function reactionPillLabel(mine: boolean): { fontSize: number; color: string; fontWeight: '700' } {
  return { fontSize: 11, color: mine ? C.accentLight : C.text2, fontWeight: '700' };
}

function reactionPillCount(mine: boolean): { fontSize: number; color: string; fontWeight: '700' } {
  return { fontSize: 10, color: mine ? C.accentLight : C.text3, fontWeight: '700' };
}

type AnonPostCardProps = {
  post: Post;
  liked?: boolean;
  concerned?: boolean;
  saved?: boolean;
  reactions?: ReactionAgg[];
  addedTags?: string[];
  poll?: Poll;
  reason?: { text: string; kind: string };
  communities?: PostCommunityRef[];
  onLike: () => void;
  onConcern: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
  onTagPress: (name: string) => void;
  onMore: () => void;
  onReact: (meme: string) => void;
  onAddTag?: (tag: string) => Promise<void> | void;
  onCommunityPress?: (id: string) => void;
};

function AnonPostCardInner({
  post,
  liked = false,
  concerned = false,
  saved = false,
  reactions = [],
  addedTags = [],
  poll,
  reason,
  communities = [],
  onLike,
  onConcern,
  onComment,
  onSave,
  onShare,
  onTagPress,
  onMore,
  onReact,
  onAddTag,
  onCommunityPress,
}: AnonPostCardProps) {
  const Heart = Icon.heart;
  const Comment = Icon.comment;
  const Save = Icon.save;
  const Share = Icon.share;
  const More = Icon.more;
  const Warn = Icon.warn;
  const t = useT();
  const qc = useQueryClient();

  // ★ ModActionMenu 配線 (mod だけに見える 3-dot)
  // post.community_id は型に無いが post_communities junction で 1 件以上紐付く。
  // 先頭の community を「主担当 community」と見做し、その mod 権限で判定。
  // (共通的に 1 post = 1 primary community なので衝突は実質起きない)
  const primaryCommunityId = communities[0]?.community_id;
  const isMod = useIsCommunityMod(primaryCommunityId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isOwnPost = !!post.author_id && post.author_id === currentUserId;

  // ミームリアクション (props 経由で DB から取得済み)
  const [memePickerOpen, setMemePickerOpen] = useState(false);
  const reactionsList = reactions;
  const myReactionsForPost = reactions.filter((r) => r.mine).map((r) => r.meme);

  // CW (content warning) 開示状態
  const cwCategory = post.cw_category ?? null;
  const [cwRevealed, setCwRevealed] = useState(false);
  const isCwHidden = !!cwCategory && !cwRevealed;

  // Feature flags
  const useMarkdown = useFeatureFlag('markdown_render');
  const useOgPreview = useFeatureFlag('og_preview');
  const useQuickReaction = useFeatureFlag('quick_reaction');

  // 翻訳 (自動翻訳のみ — UI ボタン/バッジは表示しない)
  // selector: AnonPostCard は feed の全 post で大量にマウントされるので
  // languageStore の他フィールド変更で全 card が再 render されないように selector 化
  const lang = useLanguageStore((s) => s.lang);
  const autoTranslate = useLanguageStore((s) => s.autoTranslate);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const canTranslate = lang !== 'ja' && post.content;

  const doTranslate = async () => {
    if (!post.content || translating) return;
    setTranslating(true);
    const result = await translateDynamic(post.content, lang);
    setTranslated(result);
    setTranslating(false);
  };

  useEffect(() => {
    if (autoTranslate && canTranslate && !translated && !translating) {
      void doTranslate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, canTranslate, translated, translating]);
  const displayContent = (autoTranslate && translated) ? translated : post.content;
  // データ欠落でクラッシュしないよう全フィールドを安全化
  const mediaUrls = post.media_urls ?? [];
  const mediaBlurhashes = post.media_blurhashes ?? [];
  // 動画 (migration 0043 後の投稿のみ存在)。古い投稿は undefined → 空配列で安全
  const videoUrls = post.video_urls ?? [];
  const videoPosters = post.video_posters ?? [];
  const tagNames = Array.from(new Set(post.tag_names ?? []));

  // 画像の自然なアスペクト比を解決 — Image.getSize は web/native 両対応
  // tall portrait や wide landscape を square に潰さないよう、各 URI ごとに記録
  // 0.5 (極端な縦長) 〜 2.0 (極端な横長) でクランプして UI 暴走を防ぐ
  //
  // 重要: getSize はオリジナル URL を渡すと**フル画像をダウンロードして**寸法を測る。
  // フィードでは数 MB の画像を 4 枚並べると合計 10MB 超 → モバイル/3G で
  // 「画像が出るまで真っ暗 (= 親 View の C.bg しか見えない)」現象が起きる。
  // → thumbedUrl 経由の 720px サムネで getSize を呼ぶ。アスペクト比は同じ。
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
      const measureUri = thumbedUrl(url, 720);
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
  const displayLikesCount = getDisplayLikes(post.id, likesCount);
  const commentsCount = post.comments_count ?? 0;
  const concernCount = post.concern_count ?? 0;
  const hasMedia = mediaUrls.length > 0 || videoUrls.length > 0;
  const lowTrust = likesCount > 0 && concernCount > likesCount;

  const openSource = () => {
    if (!post.source_url) return;
    // sanitizeUrl は http/https 以外を null にする — javascript:/data:/vbscript: XSS 防止
    const safe = sanitizeUrl(post.source_url);
    if (!safe) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(safe, '_blank', 'noopener,noreferrer');
    } else {
      // 旧: silent fail。新: safeOpenUrl で失敗時 toast を表示
      void safeOpenUrl(safe);
    }
  };

  // ── 動的 style: props/state に依存するもののみ useMemo 化 ──
  // ルート Container — modern glass card 風. 1 投稿 = 1 浮遊カード として扱う。
  //   - 背景: bg2 (elevated)
  //   - 角: R.xl
  //   - 細い 1px border (lowTrust 時は amber 強調)
  //   - subtle shadow (SHADOW.sm)
  //   - 横 padding は feed.tsx 側 (FlashList contentContainer) で吸収するため
  //     card 自体には marginHorizontal を持たせない。
  //   - card 間 gap は marginBottom で確保。
  const containerStyle = useMemo(
    () => ({
      backgroundColor: C.bg2,
      borderWidth: 1,
      borderColor: lowTrust ? C.amber + '44' : 'rgba(255,255,255,0.06)',
      borderRadius: R.xl,
      paddingHorizontal: SP['4'],
      paddingTop: SP['4'],
      paddingBottom: SP['3'],
      marginBottom: SP['3'],
      maxWidth: 720,
      alignSelf: 'center' as const,
      width: '100%' as const,
      ...SHADOW.sm,
    }),
    [lowTrust],
  );

  // 本文 Text/Markdown 用 — T.body と body color を結合
  const bodyTextStyle = useMemo(() => [T.body, STYLES.bodyText], []);

  // Like ラベル/カウント色
  const likeCountTextStyle = useMemo(() => ({ color: liked ? C.pink : C.text2 }), [liked]);

  // Concern ラベル/カウント色
  const concernCountTextStyle = useMemo(
    () => ({ color: concerned ? C.amber : C.text3 }),
    [concerned],
  );

  // Reaction カウント色 — 自分のリアクション有無で変わる
  const hasMyReaction = myReactionsForPost.length > 0;
  const reactionCountTextStyle = useMemo(
    () => ({ color: hasMyReaction ? C.accent : C.text3 }),
    [hasMyReaction],
  );

  // Twitter/Threads-style full-width row: no outer rounded card, just a
  // hairline divider between posts. Looks more "premium feed" than a
  // floating-card grid on tall screens.
  return (
    <View style={containerStyle}>
      {/* 低信頼バナー */}
      {lowTrust && (
        <View style={STYLES.lowTrustBanner}>
          <Warn size={14} color={C.amber} strokeWidth={2.2} />
          <Text style={[T.caption, STYLES.lowTrustText]}>
            この投稿に「気になる」が多く付いています ({concernCount})
          </Text>
        </View>
      )}

      {/* ヘッダー: アバター / 匿 · 時刻 / ⋯
          公式コミュ管理者の投稿は de-anonymize して 実名 · 所属 を表示 */}
      <View style={STYLES.headerRow}>
        {post.official_author ? (
          // 公式管理者: ✓ shield アクセント色のアバター
          <View
            style={STYLES.officialAvatar}
            accessibilityLabel="公式管理者"
          >
            <Icon.shield size={20} color={C.accent} strokeWidth={2.4} />
          </View>
        ) : (
          <Avatar size={40} anonymous />
        )}
        {post.official_author ? (
          <View style={STYLES.officialMeta}>
            <View style={STYLES.officialNameRow}>
              <Text style={[T.smallM, STYLES.officialName]} numberOfLines={1}>
                {post.official_author.name || t('公式管理者')}
              </Text>
            </View>
            <Text style={[T.caption, STYLES.officialSub]} numberOfLines={1}>
              {post.official_author.organization
                ? `${post.official_author.organization} · ${formatRelative(post.created_at)}`
                : formatRelative(post.created_at)}
            </Text>
          </View>
        ) : (
          // anon: 「匿」を 1 行目、relative time を 2 行目に分けて typography 階層を作る
          <View style={STYLES.anonRow}>
            <Text style={[T.smallM, STYLES.anonLabel]} numberOfLines={1}>
              {t('匿')}
            </Text>
            <Text style={STYLES.anonRelative} numberOfLines={1}>
              {formatRelative(post.created_at)}
            </Text>
          </View>
        )}
        <PressableScale onPress={onMore} hitSlop={10} style={STYLES.morePress}>
          <More size={20} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
        {/* mod 専用 3-dot menu — mod でない / 自分の投稿のときは null render */}
        {primaryCommunityId && post.author_id && (
          <ModActionMenu
            target={{
              kind: 'post',
              postId: post.id,
              authorId: post.author_id,
            }}
            communityId={primaryCommunityId}
            isMod={isMod}
            isOwn={isOwnPost}
            onActionComplete={() => {
              // 削除 / kick / ban のいずれも feed を再 fetch (RPC 経路) させる
              qc.invalidateQueries({ queryKey: ['feed-page'] });
              qc.invalidateQueries({ queryKey: ['feed'] });
              qc.invalidateQueries({ queryKey: ['community-feed'] });
            }}
          />
        )}
      </View>

      {/* コミュニティピル — レコメンド理由 chip は UI 雑味の元なので非表示
          (ランキングロジックは裏で動き続ける、表示するのが分かりづらいだけ) */}
      {communities.length > 0 && (
        <View style={STYLES.communityWrap}>
          {communities.map((c) => (
            <PressableScale
              key={c.community_id}
              onPress={() => onCommunityPress?.(c.community_id)}
              haptic="tap"
              style={[STYLES.communityChipBase, communityChipBorder(!!c.is_official)]}
            >
              <Text style={STYLES.communityChipText}>
                {`\u{1F3E0} ${c.icon_emoji} ${c.name}`}
              </Text>
              {c.is_official && <OfficialBadge size="sm" iconOnly />}
            </PressableScale>
          ))}
        </View>
      )}

      {/* CW (content warning) ベール */}
      {isCwHidden && (
        <PressableScale
          onPress={() => setCwRevealed(true)}
          haptic="tap"
          style={STYLES.cwBox}
        >
          <Text style={STYLES.cwEmoji}>
            {cwCategory === 'spoiler' ? '🤐' : cwCategory === 'nsfw' ? '🔞' : cwCategory === 'violence' ? '⚠️' : '🛡️'}
          </Text>
          <Text style={[T.smallM, STYLES.cwLabel]}>
            {cwCategory === 'spoiler' ? t('ネタバレ') : cwCategory === 'nsfw' ? t('センシティブな内容') : cwCategory === 'violence' ? t('暴力的描写') : t('注意')}
          </Text>
          {post.content_warning && (
            <Text style={[T.caption, STYLES.cwWarning]}>
              {post.content_warning}
            </Text>
          )}
          <Text style={[T.caption, STYLES.cwTap]}>{t('タップして表示')}</Text>
        </PressableScale>
      )}

      {/* メディア — 自然なアスペクト比で表示 (square crop しない)
          tall portrait (5:6 等) や wide landscape も切れず全体が見える
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
            {mediaUrls.map((url, i) => {
              // ロード中は 4:3 (1.333) で仮置き → 解決後に真のアスペクト比へ差し替え
              // (1:1 だとレイアウトが大きく跳ねるので 4:3 が無難)
              const aspect = imgAspects[url] ?? 1.333;
              const blurhash = mediaBlurhashes[i];
              return (
                <View
                  key={url}
                  style={[STYLES.mediaItemBase, mediaItemAspect(aspect)]}
                >
                  <MediaWithCWGuard cwCategory={cwCategory} blurhash={blurhash}>
                    <ProgressiveImage
                      uri={url}
                      blurhash={blurhash}
                      width="100%"
                      height="100%"
                      radius={R.md}
                      lazy
                    />
                  </MediaWithCWGuard>
                </View>
              );
            })}
            {/* 動画 (1 件まで前提だが、配列をループして将来複数対応) */}
            {videoUrls.map((vurl, i) => (
              <View
                key={`v-${vurl}`}
                style={[STYLES.mediaItemBase, mediaItemAspect(16 / 9)]}
              >
                <MediaWithCWGuard cwCategory={cwCategory}>
                  <VideoPlayer uri={vurl} poster={videoPosters[i]} />
                </MediaWithCWGuard>
              </View>
            ))}
          </View>
        </DoubleTapHeart>
      )}

      {/* 本文 — 外側カードの paddingHorizontal を流用 (double-padding 回避) */}
      {post.content && !isCwHidden ? (
        <View>
          <PressableScale
            onPress={onComment}
            onLongPress={useQuickReaction ? () => setMemePickerOpen(true) : undefined}
            haptic="tap"
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

      {/* 出典 — OG preview flag が ON なら LinkPreviewCard、OFF なら従来 */}
      {post.source_url && (
        useOgPreview ? (
          <LinkPreviewCard url={post.source_url} />
        ) : (
          <PressableScale onPress={openSource} haptic="tap" style={STYLES.sourceBtn}>
            <Text style={STYLES.sourceEmoji}>🔗</Text>
            <Text style={[T.caption, STYLES.sourceText]} numberOfLines={1}>
              出典: {shortHost(post.source_url)}
            </Text>
          </PressableScale>
        )
      )}

      {/* 投票 */}
      {poll && !isCwHidden && <PollCard poll={poll} />}

      {/* タグ群（2つ目以降 + 他人が追加したタグ + 追加ボタン） */}
      <View style={STYLES.tagsRow}>
        {tagNames.slice(1).map((tag) => (
          <TagPill key={tag} name={tag} state="normal" onPress={() => onTagPress(tag)} />
        ))}
        {addedTags.filter((t) => !tagNames.includes(t)).map((tag) => (
          <TagPill key={`added-${tag}`} name={tag} state="added" onPress={() => onTagPress(tag)} />
        ))}
        {onAddTag && (
          <AddTagInline onSubmit={async (tag) => { await onAddTag(tag); }} />
        )}
      </View>

      {/* アクション行 — icon を 20px に統一. hitSlop:10 で 44pt 以上の tap target を確保
          (icon 自体は 20 だが押下範囲を上下左右 +10 で誤タップ防止)。
          gap は SP['5'] で各アクションを規則的に配置 — 「♥ 15 / 💬 9 / ⚠ / 🪶 15」 が
          視覚的にリズミカルに並ぶ。 */}
      <View style={STYLES.actionsRow}>
        <PressableScale
          onPress={onLike}
          haptic="pop"
          hitSlop={10}
          accessibilityLabel={liked ? 'いいね済み' : 'いいね'}
          style={STYLES.actionPress}
        >
          <Heart size={20} color={liked ? C.pink : C.text2} fill={liked ? C.pink : 'transparent'} strokeWidth={2.2} />
          {displayLikesCount > 0 && (
            <Text style={[T.smallM, likeCountTextStyle]}>{displayLikesCount}</Text>
          )}
        </PressableScale>
        <PressableScale
          onPress={onComment}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="コメントを開く"
          style={STYLES.actionPress}
        >
          <Comment size={20} color={C.text2} strokeWidth={2.2} />
          {commentsCount > 0 && (
            <Text style={[T.smallM, STYLES.commentCount]}>{commentsCount}</Text>
          )}
        </PressableScale>
        <PressableScale
          onPress={onConcern}
          haptic="warn"
          hitSlop={10}
          accessibilityLabel={concerned ? '気になる済み' : '気になる'}
          style={STYLES.actionPress}
        >
          <Warn size={20} color={concerned ? C.amber : C.text3} fill={concerned ? C.amber + '44' : 'transparent'} strokeWidth={2.2} />
          {concernCount > 0 && (
            <Text style={[T.smallM, concernCountTextStyle]}>{concernCount}</Text>
          )}
        </PressableScale>
        <PressableScale
          onPress={() => setMemePickerOpen(true)}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="リアクションを選ぶ"
          style={STYLES.actionPress}
        >
          <Text style={STYLES.reactionEmoji}>🪶</Text>
          {reactionsList.length > 0 && (
            <Text style={[T.smallM, reactionCountTextStyle]}>
              {reactionsList.reduce((a, r) => a + r.count, 0)}
            </Text>
          )}
        </PressableScale>
        <View style={STYLES.spacer} />
        <ObsidianSaveButton note={postToObsidianNote(post)} />
        <PressableScale
          onPress={onShare}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="共有"
          style={STYLES.iconBtn}
        >
          <Share size={18} color={C.text2} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale
          onPress={onSave}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel={saved ? '保存済み' : '保存'}
          style={STYLES.iconBtn}
        >
          <Save size={18} color={saved ? C.amber : C.text2} fill={saved ? C.amber : 'transparent'} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* リアクション表示行 */}
      {reactionsList.length > 0 && (
        <View style={STYLES.reactionsRow}>
          {reactionsList.slice(0, 8).map((r) => (
            <PressableScale
              key={r.meme}
              onPress={() => onReact(r.meme)}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel={`${r.meme} ${r.count} 件 ${r.mine ? '(押下済み)' : ''}`}
              style={[STYLES.reactionPillBase, reactionPillColors(r.mine)]}
            >
              <Text style={reactionPillLabel(r.mine)}>
                {r.meme}
              </Text>
              <Text style={reactionPillCount(r.mine)}>
                {r.count}
              </Text>
            </PressableScale>
          ))}
          {reactionsList.length > 8 && (
            <PressableScale
              onPress={() => setMemePickerOpen(true)}
              haptic="tap"
              hitSlop={10}
              accessibilityLabel="他のリアクションを見る"
              style={STYLES.reactionOverflowPill}
            >
              <Text style={STYLES.reactionOverflowText}>
                +{reactionsList.length - 8}
              </Text>
            </PressableScale>
          )}
        </View>
      )}

      {/* ミームピッカーモーダル */}
      <MemeReactionPicker
        visible={memePickerOpen}
        onClose={() => setMemePickerOpen(false)}
        onPick={(meme) => onReact(meme)}
        picked={myReactionsForPost}
      />
    </View>
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
  if (prev.onTagPress !== next.onTagPress) return false;
  if (prev.onMore !== next.onMore) return false;
  if (prev.onReact !== next.onReact) return false;
  if (prev.onAddTag !== next.onAddTag) return false;
  if (prev.onCommunityPress !== next.onCommunityPress) return false;
  return true; // skip re-render
});
