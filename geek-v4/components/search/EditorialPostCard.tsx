// =============================================================================
// EditorialPostCard — EDITORIAL「特集」検索タブ / 結果の投稿カード(記事ブロック)
// -----------------------------------------------------------------------------
// ・枠/影なし・上罫線(hairline)のフラットな記事ブロック。Web と同一品質(Blur不使用)。
// ・post 本体は親が渡す(このカードは fetch しない / hookpoint 完全温存)。
// ・遷移は親の onProp 契約: onPress 内で行う。useRouter はこのカードで使わない。
// ・rank===1(巻頭特集)は番号「01」+ accent 下線、マウント時に1パルスのみ。
// ・noUncheckedIndexedAccess 環境のため配列 index は必ず undefined ガードする。
// =============================================================================

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { C, SP, R } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { TIMING_SLOW } from '../../design/motion';
import { PressableScale } from '../ui/PressableScale';
import { HighlightedText } from '../ui/HighlightedText';
import { Icon } from '../../constants/icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  FadeInDown,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { VideoPlayer } from '../ui/VideoPlayer';

import type { Post } from '../../types/models';
import { formatRelative } from '../../lib/utils/date';
import { thumbedUrl } from '../../lib/utils/imageUrl';

type Props = {
  post: Post;
  rank: number;
  terms: string[];
  onPress: () => void;
  onExplain: () => void;
};

// http(s) で始まる URL のみサムネとして許可(data: 等は弾く)
function isHttpUrl(u: string | undefined): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

// content の先頭行(title フォールバック用)
function firstLine(s: string): string {
  const line = s.split('\n')[0];
  return (line ?? '').trim();
}

// content から title の重複を除いた抜粋(先頭160字)
function buildExcerpt(content: string, title: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  let body = flat;
  const t = title.trim();
  if (t.length > 0 && flat.startsWith(t)) {
    body = flat.slice(t.length).trim();
  }
  return body.slice(0, 160);
}

export function EditorialPostCard({ post, rank, terms, onPress, onExplain }: Props) {
  const isLead = rank === 1;

  // タイトル: post.title が空なら content 1行目
  const title = useMemo(() => {
    const t = (post.title ?? '').trim();
    return t.length > 0 ? t : firstLine(post.content);
  }, [post.title, post.content]);

  const excerpt = useMemo(() => buildExcerpt(post.content, title), [post.content, title]);

  // タグ: 重複除去 → 先頭3件、4件以上は「他N」
  const allTags = useMemo(() => Array.from(new Set(post.tag_names ?? [])), [post.tag_names]);
  const shownTags = allTags.slice(0, 3);
  const extraTagCount = allTags.length - shownTags.length;

  // サムネ: media_urls[0] が http(s) のときのみ(undefined 含めて型ガード)
  // 88px 角に対し full-res は過剰なので thumbedUrl(264 = 88@3x) で軽量化
  const rawThumb = post.media_urls?.[0];
  const thumbUrl: string | null = isHttpUrl(rawThumb) ? thumbedUrl(rawThumb, 264) : null;

  // 動画: video_urls[0] が http(s) のとき、検索結果でも小枠の中でそのまま再生する
  // (画像が無い動画のみ投稿でもサムネ枠を出す)。poster は最初フレーム。
  const rawVideo = post.video_urls?.[0];
  const videoUrl: string | null = isHttpUrl(rawVideo) ? rawVideo : null;
  const rawVideoPoster = post.video_posters?.[0];
  const videoPoster: string | undefined = isHttpUrl(rawVideoPoster)
    ? thumbedUrl(rawVideoPoster, 264)
    : undefined;

  // 巻頭特集の accent 下線: マウント時に opacity 0→1→0.6 を1パルスのみ
  const pulse = useSharedValue(isLead ? 0 : 0.6);
  useEffect(() => {
    if (!isLead) return;
    pulse.value = withSequence(
      withTiming(1, TIMING_SLOW),
      withTiming(0.6, TIMING_SLOW),
    );
  }, [isLead, pulse]);
  const underlineStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const enteringDelay = Math.min(rank, 8) * 40;

  return (
    <Animated.View entering={FadeInDown.delay(enteringDelay).duration(260)}>
      <PressableScale
        onPress={onPress}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel={`投稿を開く: ${title}`}
        style={styles.card}
      >
        <View style={styles.row}>
          {/* 左: 本文 */}
          <View style={styles.body}>
            {/* CW タグ(本文の前) */}
            {post.cw_category ? (
              <View style={styles.cwTag}>
                <View style={styles.cwDot} />
                <Text style={styles.cwText}>{`CW · ${post.cw_category}`}</Text>
              </View>
            ) : null}

            {/* タイトル行(巻頭特集は番号+下線を左に） */}
            <View style={styles.titleRow}>
              {isLead ? (
                <View style={styles.leadNumberWrap}>
                  <Text style={styles.leadNumber}>01</Text>
                  <Animated.View style={[styles.leadUnderline, underlineStyle]} />
                </View>
              ) : null}
              <View style={styles.titleTextWrap}>
                <HighlightedText
                  text={title}
                  terms={terms}
                  style={[T.h3, styles.titleText]}
                  numberOfLines={2}
                />
              </View>
            </View>

            {/* 抜粋 */}
            {excerpt.length > 0 ? (
              <HighlightedText
                text={excerpt}
                terms={terms}
                style={[T.body, styles.excerptText]}
                numberOfLines={2}
              />
            ) : null}

            {/* タグ(チップ箱なし・テキストのみ横並び) */}
            {shownTags.length > 0 ? (
              <View style={styles.tagsRow}>
                {shownTags.map((tag) => (
                  <Text key={tag} style={styles.tagText}>{`#${tag}`}</Text>
                ))}
                {extraTagCount > 0 ? (
                  <Text style={styles.tagText}>{`他${extraTagCount}`}</Text>
                ) : null}
              </View>
            ) : null}

            {/* メタ行 */}
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {`匿名 · ${formatRelative(post.created_at)}`}
              </Text>
              <View style={styles.spacer} />
              <Icon.heart size={14} color={C.text3} />
              <Text style={styles.metaText}>{post.likes_count}</Text>
              <Icon.comment size={14} color={C.text3} />
              <Text style={styles.metaText}>{post.comments_count}</Text>
              <PressableScale
                onPress={onExplain}
                haptic="tap"
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="この結果の理由"
                style={styles.infoBtn}
              >
                <Icon.info size={15} color={C.text4} />
              </PressableScale>
            </View>
          </View>

          {/* 右: 動画があれば小枠でインライン再生(ミュート自動再生)、無ければ画像サムネ。
              タップは親カードの onPress(投稿を開く)に委ねる (expandable=false)。 */}
          {videoUrl !== null ? (
            <View style={styles.thumbVideoWrap}>
              <VideoPlayer uri={videoUrl} poster={videoPoster} expandable={false} style={styles.thumbVideo} />
            </View>
          ) : thumbUrl !== null ? (
            <ExpoImage
              source={{ uri: thumbUrl }}
              style={styles.thumb}
              contentFit="cover"
              transition={120}
              cachePolicy="memory-disk"
              recyclingKey={post.id}
            />
          ) : null}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopWidth: 1,
    borderTopColor: C.divider,
    paddingVertical: SP[5],
  },
  row: {
    flexDirection: 'row',
    gap: SP[3],
  },
  body: {
    flex: 1,
    gap: SP[1] + 2,
  },
  // --- CW タグ ---
  cwTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[1],
    alignSelf: 'flex-start',
    backgroundColor: C.amberBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: R.sm,
  },
  cwDot: {
    width: 6,
    height: 6,
    borderRadius: R.full,
    backgroundColor: C.amber,
  },
  cwText: {
    ...T.captionM,
    color: C.amber,
  },
  // --- タイトル ---
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP[2],
  },
  titleTextWrap: {
    flex: 1,
  },
  titleText: {
    fontFamily: FONT.jpB,
    color: C.text,
  },
  leadNumberWrap: {
    alignItems: 'flex-start',
  },
  leadNumber: {
    ...T.h4,
    fontFamily: FONT.display,
    color: C.text3,
  },
  leadUnderline: {
    width: 24,
    height: 2,
    marginTop: 2,
    backgroundColor: C.accent,
  },
  // --- 抜粋 ---
  excerptText: {
    color: C.text2,
  },
  // --- タグ ---
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SP[2],
  },
  tagText: {
    ...T.captionM,
    color: C.text3,
  },
  // --- メタ行 ---
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[2],
    marginTop: SP[2],
  },
  metaText: {
    ...T.captionM,
    color: C.text3,
  },
  spacer: {
    flex: 1,
  },
  infoBtn: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  // --- サムネ ---
  thumb: {
    width: 88,
    height: 88,
    borderRadius: R.md,
  },
  // --- 動画サムネ枠 (小枠インライン再生) ---
  thumbVideoWrap: {
    width: 88,
    height: 88,
    borderRadius: R.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  thumbVideo: {
    width: '100%',
    height: '100%',
  },
});
