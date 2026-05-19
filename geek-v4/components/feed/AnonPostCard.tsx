import { useState } from 'react';
import { View, Text, useWindowDimensions, Linking, Platform, ActivityIndicator } from 'react-native';
import { Icon } from '@/constants/icons';
import type { Post } from '@/types/models';
import { useLanguageStore } from '@/stores/languageStore';
import { translateDynamic } from '@/lib/i18n';
import { MemeReactionPicker } from './MemeReactionPicker';
import type { ReactionAgg } from '@/lib/api/reactions';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { PressableScale } from '@/components/ui/PressableScale';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { DoubleTapHeart } from '@/components/ui/DoubleTapHeart';
import { TagPill } from '@/components/tag/TagPill';
import { AddTagInline } from '@/components/tag/AddTagInline';
import { MarkdownText } from '@/components/ui/MarkdownText';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PollCard } from './PollCard';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import type { Poll } from '@/lib/api/polls';
import { Avatar } from '@/components/ui/Avatar';
import { PostKindBadge } from './PostKindBadge';
import { TrustBadge } from '@/components/ui/TrustBadge';
import { formatRelative } from '@/lib/utils/date';
import { SHADOW } from '@/design/shadows';
import { sanitizeUrl } from '@/lib/sanitize';
import { ObsidianSaveButton } from '@/components/ui/ObsidianSaveButton';
import { postToObsidianNote } from '@/hooks/useObsidian';

function shortHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function AnonPostCard({
  post,
  liked = false,
  concerned = false,
  saved = false,
  reactions = [],
  addedTags = [],
  poll,
  onLike,
  onConcern,
  onComment,
  onSave,
  onShare,
  onTagPress,
  onMore,
  onReact,
  onAddTag,
}: {
  post: Post;
  liked?: boolean;
  concerned?: boolean;
  saved?: boolean;
  reactions?: ReactionAgg[];
  addedTags?: string[];
  poll?: Poll;
  onLike: () => void;
  onConcern: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
  onTagPress: (name: string) => void;
  onMore: () => void;
  onReact: (meme: string) => void;
  onAddTag?: (tag: string) => Promise<void> | void;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width, 720);
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

  // 自動翻訳 (auto-translate ON 時)
  if (autoTranslate && canTranslate && !translated && !translating) {
    void doTranslate();
  }
  const displayContent = (autoTranslate && translated && !showOriginal) ? translated : post.content;
  const isShowingTranslation = autoTranslate && translated && !showOriginal;
  // データ欠落でクラッシュしないよう全フィールドを安全化
  const mediaUrls = post.media_urls ?? [];
  const tagNames = post.tag_names ?? [];
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

  return (
    <View style={{
      backgroundColor: C.bg2,
      marginHorizontal: SP['3'],
      marginBottom: SP['4'],
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: lowTrust ? C.amber + '88' : C.border,
      overflow: 'hidden',
      maxWidth: 720,
      alignSelf: 'center',
      width: '100%',
      ...SHADOW.press,
    }}>
      {/* 低信頼バナー */}
      {lowTrust && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: SP['2'],
          paddingHorizontal: SP['3'], paddingVertical: SP['2'],
          backgroundColor: C.amberBg, borderBottomWidth: 1, borderBottomColor: C.amber + '44',
        }}>
          <Warn size={14} color={C.amber} strokeWidth={2.2} />
          <Text style={[T.caption, { color: C.amber, flex: 1 }]}>
            この投稿に「気になる」が多く付いています ({concernCount})
          </Text>
        </View>
      )}

      {/* ヘッダー */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SP['4'],
        paddingTop: SP['3'],
        paddingBottom: SP['2'],
        gap: SP['2'],
      }}>
        <Avatar size={24} anonymous />
        <TrustBadge score={post.trust_score_at_post} />
        <PressableScale onPress={() => tagNames[0] && onTagPress(tagNames[0])} haptic="tap">
          <Text style={[T.smallM, { color: C.accent }]}>
            {tagNames[0] ? `#${tagNames[0]}` : '#雑談'}
          </Text>
        </PressableScale>
        <PostKindBadge kind={post.kind ?? 'opinion'} size="sm" />
        <Text style={[T.caption, { color: C.text3 }]}>· {formatRelative(post.created_at)}</Text>
        <View style={{ flex: 1 }} />
        <PressableScale onPress={onMore} style={{ padding: SP['1'] }}>
          <More size={18} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* CW (content warning) ベール */}
      {isCwHidden && (
        <PressableScale
          onPress={() => setCwRevealed(true)}
          haptic="tap"
          style={{
            marginHorizontal: SP['4'],
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

      {/* メディア */}
      {hasMedia && !isCwHidden && (
        <DoubleTapHeart onDoubleTap={onLike}>
          <ProgressiveImage
            uri={mediaUrls[0] ?? ''}
            width={cardWidth - 2}
            height={cardWidth - 2}
            radius={0}
            lazy
          />
        </DoubleTapHeart>
      )}

      {/* 本文 */}
      {post.content && !isCwHidden ? (
        <View>
          <PressableScale
            onPress={onComment}
            onLongPress={useQuickReaction ? () => setMemePickerOpen(true) : undefined}
            haptic="tap"
          >
            <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['1'] }}>
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
            <View style={{ flexDirection: 'row', paddingHorizontal: SP['4'], gap: SP['2'], paddingBottom: SP['1'] }}>
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
            marginHorizontal: SP['4'], marginTop: SP['2'],
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
        paddingHorizontal: SP['4'],
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

      {/* アクション行 */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SP['4'],
        paddingTop: SP['3'],
        paddingBottom: SP['3'],
        gap: SP['4'],
      }}>
        <PressableScale onPress={onLike} haptic="pop" style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
          <Heart size={22} color={liked ? C.pink : C.text2} fill={liked ? C.pink : 'transparent'} strokeWidth={2.2} />
          {likesCount > 0 && (
            <Text style={[T.smallM, { color: liked ? C.pink : C.text2 }]}>{likesCount}</Text>
          )}
        </PressableScale>
        <PressableScale onPress={onComment} haptic="tap" style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
          <Comment size={22} color={C.text2} strokeWidth={2.2} />
          {commentsCount > 0 && (
            <Text style={[T.smallM, { color: C.text2 }]}>{commentsCount}</Text>
          )}
        </PressableScale>
        <PressableScale onPress={onConcern} haptic="warn" style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
          <Warn size={20} color={concerned ? C.amber : C.text3} fill={concerned ? C.amber + '44' : 'transparent'} strokeWidth={2.2} />
          {concernCount > 0 && (
            <Text style={[T.smallM, { color: concerned ? C.amber : C.text3 }]}>{concernCount}</Text>
          )}
        </PressableScale>
        <PressableScale
          onPress={() => setMemePickerOpen(true)}
          haptic="tap"
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
        <PressableScale onPress={onShare} haptic="tap" style={{ padding: 2 }}>
          <Share size={20} color={C.text2} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale onPress={onSave} haptic="tap" style={{ padding: 2 }}>
          <Save size={20} color={saved ? C.amber : C.text2} fill={saved ? C.amber : 'transparent'} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* リアクション表示行 */}
      {reactionsList.length > 0 && (
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap', gap: 4,
          paddingHorizontal: SP['4'], paddingBottom: SP['3'],
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
