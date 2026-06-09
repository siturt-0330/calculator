import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform,
  useWindowDimensions, ActivityIndicator, RefreshControl, ScrollView,
  Pressable, StyleSheet, NativeSyntheticEvent, TextInputKeyPressEventData,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { deleteOwnPost } from '../../lib/api/posts';
import { invalidateFeedPage } from '../../lib/cacheUpdates/feedPagePatcher';
import { MemeReactionPicker } from '../../components/feed/MemeReactionPicker';
import { ReactionListSheet } from '../../components/feed/ReactionListSheet';
import { LinkPreviewCard } from '../../components/feed/LinkPreviewCard';
import { FeedMediaGrid } from '../../components/feed/FeedMediaGrid';
import { mediaItemAspect, mediaContainerWidth } from '../../components/feed/feedMediaLayout';
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
import { Icon } from '../../constants/icons';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';
import { CommentThreadItem } from '../../components/post/CommentThreadItem';
import { ReportSheet } from '../../components/post/ReportSheet';
import { PostAuthorSheet } from '../../components/post/PostAuthorSheet';
import { MoreHorizontal, Film, Send } from 'lucide-react-native';
import { CollapsedComment } from '../../components/post/CollapsedComment';
import {
  shouldCollapseComment,
  groupConsecutiveCollapsed,
} from '../../lib/utils/commentCollapse';
import { isValidUuid } from '../../lib/validation';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useToastStore } from '../../stores/toastStore';
import { hap } from '../../design/haptics';
import { ComposerMediaGrid } from '../../components/post/composer/ComposerMediaGrid';
import { pseudonymFor } from '../../lib/utils/pseudonym';
import { usePostDetail } from '../../hooks/usePostDetail';
import { useCommentComposer } from '../../hooks/useCommentComposer';

// ----------------------------------------------------------------
// 定数
// ----------------------------------------------------------------
const MAX_W = 720;
const DEFAULT_ASPECT = 4 / 3; // ≈ 1.333 (アスペクト比解決前の仮値)
// クイック絵文字 (コメント欄でタップ挿入・YouTube 風)
const QUICK_EMOJIS = ['❤️', '😂', '🎉', '😢', '😮', '😅', '😊'] as const;

// ----------------------------------------------------------------
// 型
// ----------------------------------------------------------------

export default function PostDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  // route param を UUID validation して cache DoS を防ぐ
  const id = isValidUuid(rawId) ? rawId : null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const BackIcon = Icon.arrowL;
  const C = useColors();

  // ============================================================
  // Entering animation — Reddit iOS 風 "lift up & expand" 演出
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
      return { opacity: enterProgress.value };
    }
    return {
      opacity: enterProgress.value,
      // 0.94 → 1.0 (= 0.94 + progress * 0.06)
      transform: [{ scale: 0.94 + enterProgress.value * 0.06 }],
    };
  });

  // ============================================================
  // データ取得・副作用・派生状態 (usePostDetail に集約)
  // ============================================================
  const {
    post,
    postLoading,
    postError,
    isRefetching,
    refetch,
    fullPost,
    editedAt,
    pseudo,
    officialAuthor,
    reactions,
    myMemes,
    toggleReact,
    postCommunities,
    similarPosts,
    replies,
    repliesLoading,
    commentTree,
    commentReactions,
    toggleCommentReact,
    unreadIds,
    scrollRef,
    imgAspects,
  } = usePostDetail(id);

  // ============================================================
  // コンポーザー (useCommentComposer に集約)
  // ============================================================
  const { composerState, handlers, composerRef } = useCommentComposer(
    id ?? '',
    scrollRef as React.RefObject<{ scrollToEnd: (opts?: { animated?: boolean }) => void }>,
  );
  const {
    replyTarget,
    commentText,
    images,
    video,
    posting,
    pickingImage,
    composerActive,
    canPost,
  } = composerState;
  const {
    handleReply,
    setReplyTarget,
    setCommentText,
    setComposerActive,
    setImages,
    setVideo,
    pickImage,
    pickVideo,
    submitComment,
  } = handlers;

  // ============================================================
  // UI-only state (コンポーザー以外のオーバーレイ)
  // ============================================================
  const show = useToastStore((s) => s.show);
  const [memePickerOpen, setMemePickerOpen] = useState(false);
  const [reactionsDetailOpen, setReactionsDetailOpen] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [authorSheetOpen, setAuthorSheetOpen] = useState(false);

  // Spinner timing
  const showPostSpinner = useDelayedLoading(postLoading, 200);
  const showRepliesSpinner = useDelayedLoading(repliesLoading, 200);

  // ============================================================
  // メディア計算 (レンダリング用)
  // ============================================================
  const mediaUrls = post?.media_urls ?? [];
  const mediaBlurhashes = post?.media_blurhashes ?? [];
  const videoUrls = post?.video_urls ?? [];
  const videoPosters = post?.video_posters ?? [];
  const hasMedia = mediaUrls.length > 0 || videoUrls.length > 0;
  const useOgPreview = useFeatureFlag('og_preview');
  const { width: winW, height: winH } = useWindowDimensions();
  const mediaW = mediaContainerWidth(winW);
  const mediaMaxH = Math.round(winH * 0.7);
  const previewUrl = useMemo(
    () => post?.source_url || extractFirstUrl(post?.content),
    [post?.source_url, post?.content],
  );

  // ============================================================
  // コメントツリー描画 (IIFE → useMemo でレンダー毎再評価を抑制)
  // ============================================================
  const commentNodes = useMemo(() => {
    if (!post || commentTree.length === 0) return null;
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
      return (
        <CollapsedComment
          key={`grp-${gIdx}-${item.comments[0]?.id ?? ''}`}
          count={item.count}
        >
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
  }, [
    commentTree,
    unreadIds,
    post,
    postCommunities,
    handleReply,
    commentReactions,
    toggleCommentReact,
  ]);

  // ============================================================
  // 早期 return (route 無効 / ローディング / エラー)
  // ============================================================
  if (!id) {
    return (
      <Animated.View
        style={[
          styles.centerFill,
          { backgroundColor: C.bg, padding: SP['6'] },
          enterStyle,
        ]}
      >
        <Text style={[T.body, { color: C.text2 }]}>無効な URL です</Text>
      </Animated.View>
    );
  }

  if (postLoading) {
    return (
      <Animated.View style={[styles.centerFill, { backgroundColor: C.bg }, enterStyle]}>
        {showPostSpinner ? <Spinner /> : null}
      </Animated.View>
    );
  }

  if (postError || !post) {
    return (
      <Animated.View
        style={[
          styles.centerFill,
          { backgroundColor: C.bg, padding: SP['6'], gap: SP['3'] },
          enterStyle,
        ]}
      >
        <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
          投稿を取得できませんでした
        </Text>
        <Text style={[T.small, { color: C.text3, textAlign: 'center' }]}>
          通信エラーまたは削除された投稿の可能性があります
        </Text>
        <PressableScale
          onPress={() => router.back()}
          haptic="tap"
          hitSlop={10}
          style={{
            marginTop: SP['2'],
            paddingHorizontal: SP['5'],
            paddingVertical: SP['3'],
            backgroundColor: C.bg3,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>戻る</Text>
        </PressableScale>
      </Animated.View>
    );
  }

  // ============================================================
  // renderListHeader — 投稿本体カード + コメント件数バッジ
  // ------------------------------------------------------------
  // render 内で定義した関数を <ListHeader/> で要素化すると親の re-render 毎に
  // React が「新しいコンポーネント型」とみなしヘッダー全体を unmount/remount する。
  // `{renderListHeader()}` と関数呼び出しでインライン展開し、コンポーネント境界を作らない。
  // ============================================================
  const renderListHeader = () => (
    <View style={styles.alignCenter}>
      <View style={styles.maxW}>
        {/* ---- ナビゲーションバー ---- */}
        <View
          style={[
            styles.navBar,
            { paddingTop: insets.top + SP['2'] },
          ]}
        >
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
          <View style={styles.flex1} />
          <PressableScale
            onPress={() =>
              fullPost?.is_own ? setAuthorSheetOpen(true) : setReportOpen(true)
            }
            haptic="tap"
            hitSlop={12}
            accessibilityLabel={fullPost?.is_own ? 'この投稿の操作' : 'この投稿を通報'}
            style={{ padding: SP['2'] }}
          >
            <MoreHorizontal size={20} color={C.text2} strokeWidth={2.2} />
          </PressableScale>
        </View>

        {/* ---- 投稿本体カード ---- */}
        <View
          style={[
            styles.postCard,
            { borderBottomColor: C.divider },
          ]}
        >
          <View style={{ gap: SP['3'] }}>
            {/* 投稿先コミュニティ ピル */}
            {postCommunities.length > 0 && (
              <View style={styles.communityRow}>
                <Text style={[T.caption, { color: C.text3 }]}>投稿先:</Text>
                {postCommunities.map((c) => (
                  <PressableScale
                    key={c.community_id}
                    onPress={() =>
                      router.push(`/community/${c.community_id}` as never)
                    }
                    haptic="tap"
                    hitSlop={6}
                    accessibilityLabel={`${c.name} コミュニティへ移動`}
                    style={[
                      styles.communityPill,
                      {
                        backgroundColor: c.is_official ? C.accentBg : C.bg3,
                        borderColor: c.is_official ? C.accent : C.border,
                      },
                    ]}
                  >
                    {c.icon_url ? null : (
                      <Text style={{ fontSize: 11 }}>{c.icon_emoji}</Text>
                    )}
                    <Text
                      style={[
                        T.caption,
                        {
                          color: c.is_official ? C.accent : C.text2,
                          fontWeight: '700',
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {c.name}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            )}

            {/* 投稿者エリア */}
            <View style={styles.authorRow}>
              {officialAuthor ? (
                <View
                  style={[styles.officialAvatar, { backgroundColor: C.accentBg }]}
                >
                  <Icon.shield size={16} color={C.accent} strokeWidth={2.4} />
                </View>
              ) : (
                <Avatar
                  size={36}
                  uri={fullPost?.avatar_url}
                  emoji={fullPost?.avatar_url ? undefined : fullPost?.avatar_emoji}
                  color={pseudo.color}
                  name={pseudo.initial}
                />
              )}
              <View style={styles.flex1}>
                {officialAuthor ? (
                  <Text
                    style={[T.captionM, { color: C.text, fontWeight: '700' }]}
                    numberOfLines={1}
                  >
                    {officialAuthor.name || '公式管理者'}
                  </Text>
                ) : (
                  <Text
                    style={[T.captionM, { color: pseudo.color, fontWeight: '700' }]}
                    numberOfLines={1}
                  >
                    {pseudo.handle}
                  </Text>
                )}
                <Text style={[T.caption, { color: C.text3 }]}>
                  {formatRelative(post.created_at)}
                </Text>
                {editedAt ? (
                  <Text style={[T.caption, { color: C.text3 }]}> ・編集済み</Text>
                ) : null}
              </View>
              <ObsidianSaveButton note={postToObsidianNote(post)} size={18} />
            </View>

            {/* タイトル */}
            {post.title && (
              <Text
                style={[T.h2, { color: C.text, fontWeight: '800', marginBottom: SP['2'] }]}
                numberOfLines={4}
              >
                {post.title}
              </Text>
            )}

            {/* 本文 */}
            <Text style={[T.body, { color: C.text, lineHeight: 24 }]}>
              {stripPreviewUrl(
                post.content,
                previewUrl && useOgPreview ? previewUrl : null,
              )}
            </Text>

            {/* メディア (写真 / 動画) */}
            {hasMedia && (
              <View style={{ gap: SP['2'] }}>
                {mediaUrls.length >= 2 ? (
                  <MediaWithCWGuard
                    cwCategory={post.cw_category}
                    blurhash={mediaBlurhashes[0]}
                  >
                    <FeedMediaGrid
                      items={mediaUrls.map((u, i) => ({
                        uri: u,
                        blurhash: mediaBlurhashes[i],
                        aspect: imgAspects[u],
                      }))}
                      onPress={(idx) =>
                        setLightboxUri(thumbedUrl(mediaUrls[idx]!, 1280))
                      }
                    />
                  </MediaWithCWGuard>
                ) : (
                  mediaUrls.map((url, i) => {
                    const aspect = imgAspects[url] ?? DEFAULT_ASPECT;
                    const blurhash = mediaBlurhashes[i];
                    return (
                      <View
                        key={url}
                        style={[
                          {
                            borderRadius: R.md,
                            overflow: 'hidden',
                            backgroundColor: C.bg3,
                            alignSelf: 'center',
                          },
                          mediaItemAspect(aspect, mediaW, mediaMaxH),
                        ]}
                      >
                        <MediaWithCWGuard
                          cwCategory={post.cw_category}
                          blurhash={blurhash}
                        >
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
                              contentFit="contain"
                              thumbWidth={720}
                            />
                          </Pressable>
                        </MediaWithCWGuard>
                      </View>
                    );
                  })
                )}
                {videoUrls.map((vurl, i) => (
                  <View key={`v-${vurl}`} style={styles.videoWrapper}>
                    <MediaWithCWGuard cwCategory={post.cw_category}>
                      <VideoPlayer uri={vurl} poster={videoPosters[i]} />
                    </MediaWithCWGuard>
                  </View>
                ))}
              </View>
            )}

            {/* リンクプレビュー */}
            {previewUrl && useOgPreview && <LinkPreviewCard url={previewUrl} />}

            {/* リアクション (テキストスタンプ) */}
            <View style={styles.reactionsWrap}>
              {reactions.slice(0, 5).map((r) => {
                const mine = r.mine;
                return (
                  <PressableScale
                    key={r.meme}
                    onPress={() => toggleReact(id, r.meme)}
                    haptic="tap"
                    hitSlop={10}
                    accessibilityLabel={`${r.meme} ${r.count} 件 ${mine ? '(押下済み)' : ''}`}
                    style={[
                      styles.reactionPill,
                      {
                        backgroundColor: mine ? C.accent : C.bg3,
                        borderColor: mine ? C.accent : C.border,
                      },
                    ]}
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
                  style={[
                    styles.reactionOverflowPill,
                    { backgroundColor: C.bg3, borderColor: C.border },
                  ]}
                >
                  <Text style={{ fontSize: 12, color: C.text2, fontWeight: '700' }}>
                    …
                  </Text>
                </PressableScale>
              )}
              <PressableScale
                onPress={() => setMemePickerOpen(true)}
                haptic="tap"
                hitSlop={10}
                accessibilityLabel="テキストスタンプを追加"
                style={[
                  styles.addStampButton,
                  { backgroundColor: C.bg3, borderColor: C.border },
                ]}
              >
                <Icon.plus size={12} color={C.accent} strokeWidth={2.6} />
                <Text style={{ fontSize: 11, color: C.accent, fontWeight: '700' }}>
                  {reactions.length === 0 ? 'テキストスタンプを送る' : 'スタンプ'}
                </Text>
              </PressableScale>
            </View>
          </View>
        </View>

        {/* コメント件数バッジ */}
        {replies.length > 0 && (
          <View style={styles.commentCountRow}>
            <Icon.comment size={15} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]}>
              {replies.length}件のコメント
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  // ============================================================
  // メイン return
  // ============================================================
  return (
    <Animated.View style={[{ flex: 1, backgroundColor: C.bg }, enterStyle]}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: C.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* ---- コメントツリー ScrollView ---- */}
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: SP['8'] }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={C.accent}
            />
          }
        >
          {renderListHeader()}

          {repliesLoading ? (
            showRepliesSpinner ? (
              <View style={[styles.centerPad, { padding: SP['6'] }]}>
                <ActivityIndicator color={C.accent} />
              </View>
            ) : null
          ) : commentTree.length === 0 ? (
            <View style={[styles.centerPad, { padding: SP['6'] }]}>
              <Text style={[T.small, { color: C.text3 }]}>
                コメントはまだありません
              </Text>
            </View>
          ) : (
            <View style={styles.alignCenter}>
              <View style={[styles.maxW, styles.commentPad]}>
                {commentNodes}
              </View>
            </View>
          )}

          {/* 似たような投稿 — コメントの下 (最大3件) */}
          {similarPosts.length > 0 && (
            <View style={styles.alignCenter}>
              <View style={[styles.maxW, styles.similarSection]}>
                <View style={styles.similarHeader}>
                  <Text
                    style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}
                  >
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
                        style={[
                          styles.similarCard,
                          { backgroundColor: C.bg3, borderColor: C.border },
                        ]}
                      >
                        {thumb && (
                          <View
                            style={[styles.similarThumb, { backgroundColor: C.bg2 }]}
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
                        <View style={[styles.flex1, { gap: 4 }]}>
                          <Text
                            style={[T.small, { color: C.text, lineHeight: 18 }]}
                            numberOfLines={2}
                          >
                            {p.content}
                          </Text>
                          <View style={styles.similarMeta}>
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

        {/* ============================================================
            インライン コメント / 返信 コンポーザー
            ============================================================ */}
        <View
          style={[
            styles.composerBar,
            { borderTopColor: C.border, backgroundColor: C.bg2 },
          ]}
        >
          <View
            style={[
              styles.composerInner,
              { paddingBottom: insets.bottom + SP['2'] },
            ]}
          >
            {/* 返信先ラベル */}
            {replyTarget && (
              <View style={styles.replyChip}>
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
                  style={styles.replyDismiss}
                >
                  <Icon.close size={15} color={C.text3} strokeWidth={2.4} />
                </PressableScale>
              </View>
            )}

            {/* 添付メディアプレビュー */}
            {(images.length > 0 || video) && (
              <ComposerMediaGrid
                images={images}
                video={
                  video
                    ? { uri: video.uri, sizeMb: video.size / 1024 / 1024 }
                    : null
                }
                onRemoveImage={(index) =>
                  setImages(images.filter((_, i) => i !== index))
                }
                onRemoveVideo={() => setVideo(null)}
                containerPaddingH={0}
              />
            )}

            {/* クイック絵文字 (フォーカス中・YouTube 風) */}
            {composerActive && (
              <View style={styles.quickEmojiRow}>
                {QUICK_EMOJIS.map((e) => (
                  <PressableScale
                    key={e}
                    onPress={() => {
                      setCommentText(commentText + e);
                      composerRef.current?.focus();
                    }}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={`絵文字 ${e} を挿入`}
                    style={styles.emojiBtn}
                  >
                    <Text style={{ fontSize: 22 }}>{e}</Text>
                  </PressableScale>
                ))}
              </View>
            )}

            {/* 入力行: 画像 / 動画 / テキスト / 送信 */}
            <View style={styles.inputRow}>
              <PressableScale
                onPress={
                  images.length >= 4 || pickingImage || posting ? undefined : pickImage
                }
                disabled={images.length >= 4 || pickingImage || posting}
                haptic="select"
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="画像を追加"
                style={[
                  styles.mediaBtn,
                  {
                    opacity:
                      images.length >= 4 || pickingImage || posting ? 0.4 : 1,
                  },
                ]}
              >
                <Icon.image size={22} color={C.text2} strokeWidth={2} />
              </PressableScale>
              <PressableScale
                onPress={
                  !!video || composerState.pickingVideo || posting
                    ? undefined
                    : pickVideo
                }
                disabled={!!video || composerState.pickingVideo || posting}
                haptic="select"
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="動画を追加"
                style={[
                  styles.mediaBtn,
                  { opacity: video || posting ? 0.4 : 1 },
                ]}
              >
                <Film size={22} color={C.text2} strokeWidth={2} />
              </PressableScale>
              <View
                style={[
                  styles.textInputWrap,
                  { backgroundColor: C.bg3, borderColor: C.border },
                ]}
              >
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
                      ? (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
                          // Web/Desktop: Enter で送信、Shift+Enter で改行
                          const ne = e.nativeEvent as TextInputKeyPressEventData & {
                            shiftKey?: boolean;
                          };
                          if (ne.key === 'Enter' && !ne.shiftKey) {
                            // Web SyntheticEvent には preventDefault があるが RN 型には無い
                            (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                            if (canPost) void submitComment();
                          }
                        }
                      : undefined
                  }
                  style={[
                    styles.textInput,
                    {
                      color: C.text,
                      paddingTop: Platform.OS === 'ios' ? 10 : 6,
                      paddingBottom: Platform.OS === 'ios' ? 10 : 6,
                    },
                  ]}
                />
              </View>
              <PressableScale
                onPress={
                  canPost
                    ? () => void submitComment()
                    : () => {
                        if (
                          !posting &&
                          commentText.trim().length === 0 &&
                          images.length === 0 &&
                          !video
                        ) {
                          show('コメントを入力してください。', 'warn');
                        }
                      }
                }
                haptic="tap"
                accessibilityRole="button"
                accessibilityLabel={replyTarget ? '返信を送信' : 'コメントを送信'}
                accessibilityState={{ disabled: !canPost }}
                style={[
                  styles.sendBtn,
                  {
                    backgroundColor: canPost ? C.accent : C.bg3,
                    opacity: canPost ? 1 : 0.6,
                  },
                ]}
              >
                {posting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Send
                    size={18}
                    color={canPost ? '#fff' : C.text3}
                    strokeWidth={2.2}
                  />
                )}
              </PressableScale>
            </View>
          </View>
        </View>

        {/* ---- オーバーレイシート ---- */}
        <MemeReactionPicker
          visible={memePickerOpen}
          onClose={() => setMemePickerOpen(false)}
          onPick={(meme) => toggleReact(id, meme)}
          picked={myMemes}
          reactions={reactions}
        />
        <ReactionListSheet
          visible={reactionsDetailOpen}
          onClose={() => setReactionsDetailOpen(false)}
          reactions={reactions}
          onReact={(meme) => toggleReact(id, meme)}
        />
        <ImageLightbox
          visible={!!lightboxUri}
          uri={lightboxUri}
          onClose={() => setLightboxUri(null)}
        />
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

// ============================================================
// StyleSheet — 静的スタイルを一元管理 (インライン object 割り当て削減)
// ============================================================
const styles = StyleSheet.create({
  flex1: { flex: 1 },
  alignCenter: { alignItems: 'center' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerPad: { alignItems: 'center' },
  maxW: { width: '100%', maxWidth: MAX_W },

  // nav bar
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP['3'],
    paddingBottom: SP['2'],
  },

  // post card
  postCard: {
    paddingHorizontal: SP['4'],
    paddingTop: SP['2'],
    paddingBottom: SP['4'],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  // community pills
  communityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  communityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SP['2'],
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: R.full,
  },

  // author row
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
  },
  officialAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // video
  videoWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: R.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },

  // reactions
  reactionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    marginTop: 2,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: SP['3'],
    paddingVertical: 5,
    borderRadius: R.full,
    borderWidth: 1.5,
  },
  reactionOverflowPill: {
    paddingHorizontal: SP['3'],
    paddingVertical: 5,
    borderRadius: R.full,
    borderWidth: 1.5,
  },
  addStampButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SP['3'],
    paddingVertical: 5,
    borderRadius: R.full,
    borderWidth: 1,
    borderStyle: 'dashed',
  },

  // comment count row
  commentCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SP['4'],
    paddingTop: SP['3'],
    paddingBottom: SP['1'],
  },

  // comment tree padding
  commentPad: { paddingHorizontal: SP['4'] },

  // similar posts
  similarSection: {
    paddingHorizontal: SP['4'],
    paddingBottom: SP['3'],
    paddingTop: SP['4'],
    gap: SP['2'],
  },
  similarHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  similarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['3'],
    padding: SP['3'],
    borderRadius: R.md,
    borderWidth: 1,
  },
  similarThumb: {
    width: 64,
    height: 64,
    borderRadius: R.sm,
    overflow: 'hidden',
    flexShrink: 0,
  },
  similarMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['2'],
    flexWrap: 'wrap',
  },

  // composer bar
  composerBar: {
    width: '100%',
    alignItems: 'center',
    borderTopWidth: 1,
  },
  composerInner: {
    width: '100%',
    maxWidth: MAX_W,
    paddingHorizontal: SP['3'],
    paddingTop: SP['2'],
    gap: SP['2'],
  },

  // reply chip
  replyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SP['1'],
  },
  replyDismiss: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // quick emoji
  quickEmojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['1'],
    paddingVertical: 2,
  },
  emojiBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // input row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SP['2'],
  },
  mediaBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInputWrap: {
    flex: 1,
    borderRadius: R.lg,
    borderWidth: 1,
    paddingHorizontal: SP['3'],
    minHeight: 40,
    justifyContent: 'center',
  },
  textInput: {
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
