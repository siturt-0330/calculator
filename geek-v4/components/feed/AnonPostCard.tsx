import { memo, useEffect, useState } from 'react';
import { View, Text, Linking, Platform, ActivityIndicator, Image as RNImage } from 'react-native';
import { Icon } from '../../constants/icons';
import type { Post } from '../../types/models';
import { useLanguageStore } from '../../stores/languageStore';
import { translateDynamic } from '../../lib/i18n';
import { MemeReactionPicker } from './MemeReactionPicker';
import type { ReactionAgg } from '../../lib/api/reactions';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { ProgressiveImage } from '../ui/ProgressiveImage';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { DoubleTapHeart } from '../ui/DoubleTapHeart';
import { TagPill } from '../tag/TagPill';
import { AddTagInline } from '../tag/AddTagInline';
import { MarkdownText } from '../ui/MarkdownText';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PollCard } from './PollCard';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import type { Poll } from '../../lib/api/polls';
import { Avatar } from '../ui/Avatar';
import { PostKindBadge } from './PostKindBadge';
import { TrustBadge } from '../ui/TrustBadge';
import { formatRelative } from '../../lib/utils/date';
import { SHADOW } from '../../design/shadows';
import { sanitizeUrl } from '../../lib/sanitize';
import { ObsidianSaveButton } from '../ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';
import type { PostCommunityRef } from '../../lib/api/posts';

function shortHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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

  // 翻訳
  const { lang, autoTranslate } = useLanguageStore();
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const canTranslate = lang !== 'ja' && post.content;

  const doTranslate = async () => {
    if (!post.content || translating) return;
    setTranslating(true);
    const result = await translateDynamic(post.content, lang);
    setTranslated(result);
    setTranslating(false);
  };

  // 自動翻訳 (auto-translate ON 時) — render 中に setState を起こさないよう
  // useEffect 内で発火させる。以前はトップレベルで doTranslate() を呼んでいて
  // setTranslating(true) が render 中に走り、毎回フィードスクロール時に多重 render を誘発していた。
  useEffect(() => {
    if (autoTranslate && canTranslate && !translated && !translating) {
      void doTranslate();
    }
    // doTranslate は新規 closure なので意図的に省く。translated/translating の遷移だけで再評価する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, canTranslate, translated, translating]);
  const displayContent = (autoTranslate && translated && !showOriginal) ? translated : post.content;
  const isShowingTranslation = autoTranslate && translated && !showOriginal;
  // データ欠落でクラッシュしないよう全フィールドを安全化
  const mediaUrls = post.media_urls ?? [];
  const mediaBlurhashes = post.media_blurhashes ?? [];
  const tagNames = Array.from(new Set(post.tag_names ?? []));

  // 画像の自然なアスペクト比を解決 — Image.getSize は web/native 両対応
  // tall portrait や wide landscape を square に潰さないよう、各 URI ごとに記録
  // 0.5 (極端な縦長) 〜 2.0 (極端な横長) でクランプして UI 暴走を防ぐ
  //
  // 重要: getSize はオリジナル URL を渡すと**フル画像をダウンロードして**寸法を測る。
  // フィードでは数 MB の画像を 4 枚並べると合計 10MB 超 → モバイル/3G で
  // 「画像が出るまで真っ暗 (= 親 View の C.bg しか見えない)」現象が起きる。
  // → thumbedUrl 経由の 720px サムネで getSize を呼ぶ。アスペクト比は同じ。
  const [imgAspects, setImgAspects] = useState<Record<string, number>>({});
  useEffect(() => {
    if (mediaUrls.length === 0) return;
    let alive = true;
    for (const url of mediaUrls) {
      if (!url) continue;
      // 既に解決済みのものは再取得しない (state を closure 経由で参照)
      setImgAspects((prev) => {
        if (prev[url] !== undefined) return prev;
        // サムネ URL で getSize を呼ぶ — フル画像のダウンロード回避
        const measureUri = thumbedUrl(url, 720);
        RNImage.getSize(
          measureUri,
          (w, h) => {
            if (!alive || h <= 0 || w <= 0) return;
            const ratio = Math.max(0.5, Math.min(2.0, w / h));
            setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: ratio }));
          },
          () => {
            if (!alive) return;
            // 失敗時は 1:1 で fallback
            setImgAspects((p) => (p[url] !== undefined ? p : { ...p, [url]: 1 }));
          },
        );
        return prev;
      });
    }
    return () => {
      alive = false;
    };
    // mediaUrls は post から派生する配列 ref なので毎 render 新規 — join して安定化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrls.join('|')]);
  const likesCount = post.likes_count ?? 0;
  const commentsCount = post.comments_count ?? 0;
  const concernCount = post.concern_count ?? 0;
  const hasMedia = mediaUrls.length > 0;
  const lowTrust = likesCount > 0 && concernCount > likesCount;

  const openSource = () => {
    if (!post.source_url) return;
    // sanitizeUrl は http/https 以外を null にする — javascript:/data:/vbscript: XSS 防止
    const safe = sanitizeUrl(post.source_url);
    if (!safe) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(safe, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(safe).catch(() => {});
    }
  };

  // Twitter/Threads-style full-width row: no outer rounded card, just a
  // hairline divider between posts. Looks more "premium feed" than a
  // floating-card grid on tall screens.
  return (
    <View style={{
      backgroundColor: C.bg,
      borderBottomWidth: 1,
      borderBottomColor: lowTrust ? C.amber + '44' : C.divider,
      paddingHorizontal: SP['4'],
      paddingTop: SP['3'],
      paddingBottom: SP['3'],
      maxWidth: 720,
      alignSelf: 'center',
      width: '100%',
    }}>
      {/* 低信頼バナー */}
      {lowTrust && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: SP['2'],
          paddingHorizontal: SP['3'], paddingVertical: SP['2'],
          backgroundColor: C.amberBg,
          borderRadius: R.md,
          borderWidth: 1, borderColor: C.amber + '44',
          marginBottom: SP['2'],
        }}>
          <Warn size={14} color={C.amber} strokeWidth={2.2} />
          <Text style={[T.caption, { color: C.amber, flex: 1 }]}>
            この投稿に「気になる」が多く付いています ({concernCount})
          </Text>
        </View>
      )}

      {/* ヘッダー: アバター / 匿 · 時刻 / ⋯ */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
      }}>
        <Avatar size={36} anonymous />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
          <Text style={[T.smallM, { color: C.text }]}>匿</Text>
          <TrustBadge score={post.trust_score_at_post} />
          <Text style={[T.small, { color: C.text3 }]}>· {formatRelative(post.created_at)}</Text>
          <PostKindBadge kind={post.kind ?? 'opinion'} size="sm" />
        </View>
        <PressableScale onPress={onMore} hitSlop={8} style={{ padding: 2 }}>
          <More size={20} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* コミュニティピル — レコメンド理由 chip は UI 雑味の元なので非表示
          (ランキングロジックは裏で動き続ける、表示するのが分かりづらいだけ) */}
      {communities.length > 0 && (
        <View style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
          marginTop: SP['2'],
        }}>
          {communities.map((c) => (
            <PressableScale
              key={c.community_id}
              onPress={() => onCommunityPress?.(c.community_id)}
              haptic="tap"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                height: 22,
                borderRadius: R.full,
                backgroundColor: C.bg3,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={{ fontSize: 11, color: C.text2, fontWeight: '600' }}>
                {`\u{1F3E0} ${c.icon_emoji} ${c.name}`}
              </Text>
            </PressableScale>
          ))}
        </View>
      )}

      {/* CW (content warning) ベール */}
      {isCwHidden && (
        <PressableScale
          onPress={() => setCwRevealed(true)}
          haptic="tap"
          style={{
            marginTop: SP['2'],
            paddingHorizontal: SP['4'],
            paddingVertical: SP['4'],
            backgroundColor: C.bg3,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.amber,
            alignItems: 'center',
            gap: SP['1'],
          }}
        >
          <Text style={{ fontSize: 32 }}>
            {cwCategory === 'spoiler' ? '🤐' : cwCategory === 'nsfw' ? '🔞' : cwCategory === 'violence' ? '⚠️' : '🛡️'}
          </Text>
          <Text style={[T.smallM, { color: C.amber, fontWeight: '700' }]}>
            {cwCategory === 'spoiler' ? 'ネタバレ' : cwCategory === 'nsfw' ? 'センシティブな内容' : cwCategory === 'violence' ? '暴力的描写' : '注意'}
          </Text>
          {post.content_warning && (
            <Text style={[T.caption, { color: C.text2, textAlign: 'center' }]}>
              {post.content_warning}
            </Text>
          )}
          <Text style={[T.caption, { color: C.accent, marginTop: 4 }]}>タップして表示</Text>
        </PressableScale>
      )}

      {/* メディア — 自然なアスペクト比で表示 (square crop しない)
          tall portrait (5:6 等) や wide landscape も切れず全体が見える
          複数枚は縦に積む (各画像が自身のアスペクト比を保持)
          外側カードの paddingHorizontal に揃え、premium feel の rounded corners */}
      {hasMedia && !isCwHidden && (
        <DoubleTapHeart onDoubleTap={onLike}>
          <View style={{ gap: SP['2'], marginTop: SP['2'] }}>
            {mediaUrls.map((url, i) => {
              // ロード中は 4:3 (1.333) で仮置き → 解決後に真のアスペクト比へ差し替え
              // (1:1 だとレイアウトが大きく跳ねるので 4:3 が無難)
              const aspect = imgAspects[url] ?? 1.333;
              const blurhash = mediaBlurhashes[i];
              return (
                <View
                  key={url}
                  style={{
                    width: '100%',
                    aspectRatio: aspect,
                    backgroundColor: C.bg2,
                    borderRadius: R.md,
                    overflow: 'hidden',
                  }}
                >
                  <ProgressiveImage
                    uri={url}
                    blurhash={blurhash}
                    width="100%"
                    height="100%"
                    radius={R.md}
                    lazy
                  />
                </View>
              );
            })}
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
            <View style={{ paddingTop: SP['2'], paddingBottom: SP['1'] }}>
              {useMarkdown ? (
                <MarkdownText
                  text={displayContent}
                  style={[T.body, { color: C.text, lineHeight: 22 }]}
                  numberOfLines={hasMedia ? 3 : 8}
                />
              ) : (
                <Text style={[T.body, { color: C.text, lineHeight: 22 }]} numberOfLines={hasMedia ? 3 : 8}>
                  {displayContent}
                </Text>
              )}
              {isShowingTranslation && (
                <View style={{
                  marginTop: SP['1'],
                  paddingHorizontal: 6, paddingVertical: 2,
                  backgroundColor: 'rgba(124,177,255,0.13)',
                  borderRadius: 4,
                  alignSelf: 'flex-start',
                  borderWidth: 1, borderColor: 'rgba(124,177,255,0.4)',
                }}>
                  <Text style={{ fontSize: 9, color: '#7CB1FF', fontWeight: '700' }}>
                    🌏 AI translated · tap to see original
                  </Text>
                </View>
              )}
            </View>
          </PressableScale>
          {/* 翻訳ボタン (lang ≠ ja) */}
          {canTranslate && (
            <View style={{ flexDirection: 'row', gap: SP['2'], paddingBottom: SP['1'] }}>
              {translated ? (
                <PressableScale
                  onPress={() => setShowOriginal((v) => !v)}
                  haptic="tap"
                  style={{
                    paddingHorizontal: SP['2'], paddingVertical: 4,
                    backgroundColor: 'rgba(124,177,255,0.13)',
                    borderRadius: 999,
                    borderWidth: 1, borderColor: 'rgba(124,177,255,0.4)',
                    flexDirection: 'row', alignItems: 'center', gap: 3,
                  }}
                >
                  <Text style={{ fontSize: 10 }}>🌏</Text>
                  <Text style={{ fontSize: 10, color: '#7CB1FF', fontWeight: '700' }}>
                    {showOriginal ? 'Show translation' : 'Show original'}
                  </Text>
                </PressableScale>
              ) : (
                <PressableScale
                  onPress={doTranslate}
                  haptic="tap"
                  disabled={translating}
                  style={{
                    paddingHorizontal: SP['2'], paddingVertical: 4,
                    backgroundColor: 'rgba(124,177,255,0.13)',
                    borderRadius: 999,
                    borderWidth: 1, borderColor: 'rgba(124,177,255,0.4)',
                    flexDirection: 'row', alignItems: 'center', gap: 3,
                  }}
                >
                  {translating ? (
                    <ActivityIndicator size="small" color="#7CB1FF" />
                  ) : (
                    <Text style={{ fontSize: 10 }}>🌏</Text>
                  )}
                  <Text style={{ fontSize: 10, color: '#7CB1FF', fontWeight: '700' }}>
                    {translating ? 'Translating...' : `Translate to ${lang.toUpperCase()}`}
                  </Text>
                </PressableScale>
              )}
            </View>
          )}
        </View>
      ) : null}

      {/* 出典 — OG preview flag が ON なら LinkPreviewCard、OFF なら従来 */}
      {post.source_url && (
        useOgPreview ? (
          <LinkPreviewCard url={post.source_url} />
        ) : (
          <PressableScale onPress={openSource} haptic="tap" style={{
            marginTop: SP['2'],
            paddingHorizontal: SP['3'], paddingVertical: SP['2'],
            backgroundColor: C.bg3, borderRadius: R.md,
            borderWidth: 1, borderColor: C.border,
            flexDirection: 'row', alignItems: 'center', gap: SP['2'],
          }}>
            <Text style={{ fontSize: 14 }}>🔗</Text>
            <Text style={[T.caption, { color: C.text2, flex: 1 }]} numberOfLines={1}>
              出典: {shortHost(post.source_url)}
            </Text>
          </PressableScale>
        )
      )}

      {/* 投票 */}
      {poll && !isCwHidden && <PollCard poll={poll} />}

      {/* タグ群（2つ目以降 + 他人が追加したタグ + 追加ボタン） */}
      <View style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingTop: SP['2'],
        gap: SP['2'],
        alignItems: 'center',
      }}>
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

      {/* アクション行 — hitSlop で 44pt 以上の tap target を確保 (icon 自体は 20-22 だが
          押下範囲を上下左右 +10 まで広げて誤タップ/反応しない問題を解消) */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: SP['2'],
        paddingBottom: 0,
        gap: SP['4'],
      }}>
        <PressableScale
          onPress={onLike}
          haptic="pop"
          hitSlop={10}
          accessibilityLabel={liked ? 'いいね済み' : 'いいね'}
          style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}
        >
          <Heart size={22} color={liked ? C.pink : C.text2} fill={liked ? C.pink : 'transparent'} strokeWidth={2.2} />
          {likesCount > 0 && (
            <Text style={[T.smallM, { color: liked ? C.pink : C.text2 }]}>{likesCount}</Text>
          )}
        </PressableScale>
        <PressableScale
          onPress={onComment}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="コメントを開く"
          style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}
        >
          <Comment size={22} color={C.text2} strokeWidth={2.2} />
          {commentsCount > 0 && (
            <Text style={[T.smallM, { color: C.text2 }]}>{commentsCount}</Text>
          )}
        </PressableScale>
        <PressableScale
          onPress={onConcern}
          haptic="warn"
          hitSlop={10}
          accessibilityLabel={concerned ? '気になる済み' : '気になる'}
          style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}
        >
          <Warn size={20} color={concerned ? C.amber : C.text3} fill={concerned ? C.amber + '44' : 'transparent'} strokeWidth={2.2} />
          {concernCount > 0 && (
            <Text style={[T.smallM, { color: concerned ? C.amber : C.text3 }]}>{concernCount}</Text>
          )}
        </PressableScale>
        <PressableScale
          onPress={() => setMemePickerOpen(true)}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="リアクションを選ぶ"
          style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}
        >
          <Text style={{ fontSize: 18 }}>🪶</Text>
          {reactionsList.length > 0 && (
            <Text style={[T.smallM, { color: myReactionsForPost.length > 0 ? C.accent : C.text3 }]}>
              {reactionsList.reduce((a, r) => a + r.count, 0)}
            </Text>
          )}
        </PressableScale>
        <View style={{ flex: 1 }} />
        <ObsidianSaveButton note={postToObsidianNote(post)} />
        <PressableScale
          onPress={onShare}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel="共有"
          style={{ padding: 2 }}
        >
          <Share size={20} color={C.text2} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale
          onPress={onSave}
          haptic="tap"
          hitSlop={10}
          accessibilityLabel={saved ? '保存済み' : '保存'}
          style={{ padding: 2 }}
        >
          <Save size={20} color={saved ? C.amber : C.text2} fill={saved ? C.amber : 'transparent'} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* リアクション表示行 */}
      {reactionsList.length > 0 && (
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap', gap: 4,
          paddingTop: SP['2'],
        }}>
          {reactionsList.slice(0, 8).map((r) => (
            <PressableScale
              key={r.meme}
              onPress={() => onReact(r.meme)}
              haptic="tap"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: SP['2'], paddingVertical: 4,
                backgroundColor: r.mine ? C.accentBg : C.bg3,
                borderRadius: R.full,
                borderWidth: 1, borderColor: r.mine ? C.accent : C.border,
              }}
            >
              <Text style={{ fontSize: 11, color: r.mine ? C.accentLight : C.text2, fontWeight: '700' }}>
                {r.meme}
              </Text>
              <Text style={{ fontSize: 10, color: r.mine ? C.accentLight : C.text3, fontWeight: '700' }}>
                {r.count}
              </Text>
            </PressableScale>
          ))}
          {reactionsList.length > 8 && (
            <PressableScale
              onPress={() => setMemePickerOpen(true)}
              haptic="tap"
              style={{
                paddingHorizontal: SP['2'], paddingVertical: 4,
                backgroundColor: C.bg3,
                borderRadius: R.full,
                borderWidth: 1, borderColor: C.border,
              }}
            >
              <Text style={{ fontSize: 11, color: C.text3, fontWeight: '700' }}>
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
