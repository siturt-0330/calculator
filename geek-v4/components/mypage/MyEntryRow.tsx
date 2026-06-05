// ============================================================
// MyEntryRow — マイページの 投稿 / コメント / 保存 カード
// ------------------------------------------------------------
// X(Twitter) 風: メディア(画像/動画)は「タップで開く」ではなく
// 常時インラインで写真のように見せる。1〜4枚は X と同じグリッド配置、
// 5枚以上は 4枚目に「+N」。画像タップで全画面(onOpenImage→ImageLightbox)、
// 動画ポスターはタップで投稿詳細へ(そこで再生)。
//
// レイアウト(縦組み): [タイトル?] → [本文] → [メディアグリッド] → [メタ]
//   - 箱は bg2 + 1px divider の極薄カード(影なし・同心角丸)。
//   - comment は左に accent 引用罫 + 本文 + メディア + 出典行。
// ============================================================

import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Heart, MessageCircle, Play } from 'lucide-react-native';

import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { VideoPlayer } from '../ui/VideoPlayer';

export type MyEntryVariant = 'post' | 'comment' | 'saved';

// 投稿/コメントのメディア 1 件。video は poster(無ければ url)を静止画として表示。
export type MyMediaItem = {
  type: 'image' | 'video';
  url: string;
  poster?: string | null;
  blurhash?: string | null;
};

export interface MyEntryRowProps {
  variant: MyEntryVariant;
  /** 見出し(post/saved)。comment では無視。 */
  title?: string | null;
  /** 本文 snippet(post/saved) または コメント本文(comment)。 */
  snippet: string;
  /** メディア(画像/動画)。常時インライン表示。 */
  media?: MyMediaItem[];
  /** メタ行(MetaNum 群 + 時刻 等)。post/saved で親が組む。 */
  metaNode?: ReactNode;
  /** メタ行末バッジ(post の「非公開」amber ピル等)。 */
  badgeNode?: ReactNode;
  /** comment の出典行(どの投稿への返信か)。variant='comment' でのみ描画。 */
  quoteNode?: ReactNode;
  /** カードタップ(→ 投稿詳細)。 */
  onPress: () => void;
  /** 画像タップ(→ 全画面 ImageLightbox)。未指定なら onPress にフォールバック。 */
  onOpenImage?: (url: string) => void;
  accessibilityLabel?: string;
}

// ------------------------------------------------------------
// MetaNum — Heart / MessageCircle + 数値(Inter=T.num・無彩 C.text3)。
// ------------------------------------------------------------
export function MetaNum({ Icon: I, value }: { Icon: typeof Heart; value: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <I size={13} color={C.text3} strokeWidth={2} />
      <Text style={[T.num, { fontSize: 12, lineHeight: 16, color: C.text3 }]}>
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

// 動画/+N オーバーレイの静的スタイル (毎 render のオブジェクト生成を避け、
// スクロール中の style 差分=再描画圧を減らす。色は literal でテーマ非依存)。
const mediaStyles = StyleSheet.create({
  fillCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ------------------------------------------------------------
// MediaCell — グリッドの 1 マス。画像 or 動画ポスター + (動画は ▶)。
// ------------------------------------------------------------
function MediaCell({
  item,
  flex,
  aspectRatio,
  height,
  extra,
  onOpenImage,
  onPressVideo,
}: {
  item: MyMediaItem;
  flex?: number;
  aspectRatio?: number;
  height?: number;
  extra?: number;
  onOpenImage?: (url: string) => void;
  onPressVideo: () => void;
}) {
  const isVideo = item.type === 'video';
  const src = isVideo ? item.poster ?? item.url : item.url;
  return (
    <Pressable
      onPress={() => (isVideo ? onPressVideo() : onOpenImage ? onOpenImage(item.url) : onPressVideo())}
      accessibilityRole="imagebutton"
      accessibilityLabel={isVideo ? '動画を再生' : '画像を拡大'}
      style={{
        flex,
        aspectRatio,
        height,
        backgroundColor: C.bg3,
        overflow: 'hidden',
      }}
    >
      <ExpoImage
        source={{ uri: thumbedUrl(src, 720) }}
        placeholder={item.blurhash ? { blurhash: item.blurhash } : undefined}
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
        transition={160}
        cachePolicy="memory-disk"
        recyclingKey={src}
      />
      {isVideo ? (
        <View pointerEvents="none" style={mediaStyles.fillCenter}>
          <View style={mediaStyles.playCircle}>
            <Play size={22} color="#fff" fill="#fff" strokeWidth={0} />
          </View>
        </View>
      ) : null}
      {extra && extra > 0 ? (
        <View pointerEvents="none" style={mediaStyles.scrim}>
          <Text style={[T.h3, { color: '#fff', fontWeight: '800' }]}>{`+${extra}`}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ------------------------------------------------------------
// MediaGrid — X 風 1〜4(+N) グリッド。常時インライン。
// ------------------------------------------------------------
const GAP = 3;

function MediaGrid({
  media,
  onOpenImage,
  onPressVideo,
}: {
  media: MyMediaItem[];
  onOpenImage?: (url: string) => void;
  onPressVideo: () => void;
}) {
  if (media.length === 0) return null;
  const items = media.slice(0, 4);
  const extra = media.length - 4;
  const wrap = {
    marginTop: SP['3'],
    borderRadius: R.lg,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg3,
  };
  const cellProps = { onOpenImage, onPressVideo };

  if (items.length === 1 && items[0]) {
    const single = items[0];
    if (single.type === 'video') {
      // 動画は VideoPlayer で「フレーム常時表示 + ビューポート内で muted 自動再生」
      // (X/Instagram 風)。poster が無くても <video preload=metadata> が先頭フレームを出す。
      // タップで全画面 VideoLightbox。16:9・角丸・#000 は VideoPlayer 内蔵。
      return (
        <View style={{ marginTop: SP['3'] }}>
          <VideoPlayer uri={single.url} poster={single.poster ?? undefined} />
        </View>
      );
    }
    // 1枚画像: 全幅やや背高 4:3 で「写真らしさ」。
    return (
      <View style={[wrap, { aspectRatio: 4 / 3 }]}>
        <MediaCell item={single} flex={1} {...cellProps} />
      </View>
    );
  }

  if (items.length === 2) {
    return (
      <View style={[wrap, { flexDirection: 'row', aspectRatio: 16 / 9, gap: GAP }]}>
        {items.map((it, i) => (
          <MediaCell key={i} item={it} flex={1} {...cellProps} />
        ))}
      </View>
    );
  }

  if (items.length === 3) {
    const [a, b, c] = items;
    return (
      <View style={[wrap, { flexDirection: 'row', aspectRatio: 16 / 9, gap: GAP }]}>
        {a ? <MediaCell item={a} flex={1} {...cellProps} /> : null}
        <View style={{ flex: 1, gap: GAP }}>
          {b ? <MediaCell item={b} flex={1} {...cellProps} /> : null}
          {c ? <MediaCell item={c} flex={1} {...cellProps} /> : null}
        </View>
      </View>
    );
  }

  // 4枚以上: 2x2。最後のマスに +N。
  return (
    <View style={[wrap, { aspectRatio: 1, gap: GAP }]}>
      <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
        {items[0] ? <MediaCell item={items[0]} flex={1} {...cellProps} /> : null}
        {items[1] ? <MediaCell item={items[1]} flex={1} {...cellProps} /> : null}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
        {items[2] ? <MediaCell item={items[2]} flex={1} {...cellProps} /> : null}
        {items[3] ? (
          <MediaCell item={items[3]} flex={1} extra={extra > 0 ? extra : undefined} {...cellProps} />
        ) : null}
      </View>
    </View>
  );
}

// ============================================================
// MyEntryRow
// ============================================================
export function MyEntryRow({
  variant,
  title,
  snippet,
  media = [],
  metaNode,
  badgeNode,
  quoteNode,
  onPress,
  onOpenImage,
  accessibilityLabel,
}: MyEntryRowProps) {
  const isComment = variant === 'comment';
  const hasTitle = !isComment && !!title && title.trim().length > 0;
  const body = snippet.trim();

  const inner = (
    <>
      {hasTitle ? (
        <Text style={[T.bodyB, { color: C.text, letterSpacing: -0.2 }]} numberOfLines={2}>
          {title}
        </Text>
      ) : null}
      {body ? (
        <Text
          style={[
            isComment ? T.body : T.body,
            { color: C.text, marginTop: hasTitle ? 4 : 0 },
          ]}
          numberOfLines={isComment ? 4 : 6}
        >
          {body}
        </Text>
      ) : null}
      {media.length > 0 ? (
        <MediaGrid media={media} onOpenImage={onOpenImage} onPressVideo={onPress} />
      ) : null}
      {!isComment && metaNode ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['4'],
            marginTop: SP['3'],
          }}
        >
          {metaNode}
          {badgeNode ?? null}
        </View>
      ) : null}
      {isComment ? quoteNode ?? null : null}
    </>
  );

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        // ★ カード(箱)をやめ、全幅 + 下端 hairline 区切りの X/Twitter 風に。
        //   投稿ごとの「枠」を無くし、地続きのタイムラインにする。
        paddingHorizontal: SP['4'],
        paddingVertical: SP['4'],
        backgroundColor: C.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: C.divider,
      }}
    >
      {isComment ? (
        <View style={{ flexDirection: 'row', gap: SP['3'] }}>
          {/* accent 引用縦罫 = あなたの声(blockquote) */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ width: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: C.accent, opacity: 0.9 }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>{inner}</View>
        </View>
      ) : (
        inner
      )}
    </PressableScale>
  );
}

// MetaNum で渡すアイコンの再 export。
export { Heart as MetaHeartIcon, MessageCircle as MetaCommentIcon };
// 出典行で使う矢印/シェブロンは constants/icons.ts 経由(Icon.arrowUL / Icon.chevronR)。
export { Icon as MyEntryIcons };
