// ============================================================
// MyEntryRow — マイページの 投稿 / コメント / 保存 カード
// ------------------------------------------------------------
// メディア(画像/動画)は常時インライン表示。画像はフィード/詳細と同じ
// 【横スクロール・カルーセル】(FeedMediaGrid) で「写真全体」を見せ、タップで
// 全画面 (onOpenImage→ImageLightbox)。動画は VideoPlayer (ミュート自動再生 +
// タップで全画面)。これで X/IG/Threads 流のコンパクト表示にアプリ全体で統一する。
//
// レイアウト(縦組み): [コミュニティchip?] → [タイトル?] → [本文] → [メディア] → [メタ]
// ============================================================

import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Heart, MessageCircle } from 'lucide-react-native';

import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { VideoPlayer } from '../ui/VideoPlayer';
import { FeedMediaGrid } from '../feed/FeedMediaGrid';

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
  /** 投稿の所属コミュニティ chip(post/saved の先頭に「どこに投稿したか」を表示)。 */
  communityNode?: ReactNode;
  /** カードタップ(→ 投稿詳細)。 */
  onPress: () => void;
  /** 画像タップ(→ 全画面 ImageLightbox)。未指定なら onPress にフォールバック。 */
  onOpenImage?: (url: string) => void;
  /** 右上「…」メニュー(自分の投稿/コメントの削除など)。未指定なら非表示。 */
  onMore?: () => void;
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

// ------------------------------------------------------------
// MediaBlock — 画像は横カルーセル / 動画は VideoPlayer (フィード/詳細と統一)
// ------------------------------------------------------------
function MediaBlock({
  media,
  onOpenImage,
  onPressVideo,
}: {
  media: MyMediaItem[];
  onOpenImage?: (url: string) => void;
  onPressVideo: () => void;
}) {
  if (media.length === 0) return null;
  const images = media.filter((m) => m.type === 'image');
  const videos = media.filter((m) => m.type === 'video');
  return (
    <View style={{ marginTop: SP['3'], gap: SP['2'] }}>
      {images.length > 0 ? (
        <FeedMediaGrid
          // aspect は MyMediaItem に無いので FeedMediaGrid 側で自前計測 (横並び・全体表示)。
          items={images.map((m) => ({ uri: m.url, blurhash: m.blurhash }))}
          onPress={(idx) => {
            const u = images[idx]?.url;
            if (!u) return;
            if (onOpenImage) onOpenImage(u);
            else onPressVideo();
          }}
        />
      ) : null}
      {videos.map((v, i) => (
        <VideoPlayer key={`v-${v.url}-${i}`} uri={v.url} poster={v.poster ?? undefined} />
      ))}
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
  communityNode,
  onPress,
  onOpenImage,
  onMore,
  accessibilityLabel,
}: MyEntryRowProps) {
  const isComment = variant === 'comment';
  const hasTitle = !isComment && !!title && title.trim().length > 0;
  const hasMore = !!onMore;
  const body = snippet.trim();

  const inner = (
    <>
      {/* 所属コミュニティ chip(post/saved の先頭) — 「どこに投稿したか」 */}
      {!isComment && communityNode ? communityNode : null}
      {/* ★ 2026-06-13 コメント刷新: 出典 (返信先) を本文の【上】に置く (X の
            "Replying to" 流)。読み手は先に文脈を掴んでから本文を読める。
            旧: 本文の下に hairline 区切り + ↖ + chevron — 罫線が多く「表組み」
            のように汚く見えていた (ユーザー指摘)。 */}
      {isComment ? quoteNode ?? null : null}
      {hasTitle ? (
        <Text
          style={[T.bodyB, { color: C.text, letterSpacing: -0.2, paddingRight: hasMore ? 28 : 0 }]}
          numberOfLines={2}
        >
          {title}
        </Text>
      ) : null}
      {body ? (
        <Text
          style={[
            T.body,
            {
              color: C.text,
              marginTop: hasTitle || isComment ? 4 : 0,
              // 本文が最上段(タイトル無し投稿)のときだけ「…」分の右余白を確保。
              // (コメントは出典行が最上段になったので出典行側で確保する)
              paddingRight: hasMore && !isComment && !hasTitle ? 28 : 0,
            },
          ]}
          numberOfLines={isComment ? 4 : 6}
        >
          {body}
        </Text>
      ) : null}
      {media.length > 0 ? (
        <MediaBlock media={media} onOpenImage={onOpenImage} onPressVideo={onPress} />
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
    </>
  );

  return (
    <View style={{ position: 'relative' }}>
      <PressableScale
        onPress={onPress}
        haptic="tap"
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={{
          // ★ カード(箱)をやめ、全幅 + 下端 hairline 区切りの X/Twitter 風に。
          paddingHorizontal: SP['4'],
          paddingVertical: SP['4'],
          backgroundColor: C.bg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: C.divider,
        }}
      >
        {/* ★ 2026-06-13: コメントの accent 縦罫 (blockquote 風) を撤去。
              全行に走る紫の縦線が「線だらけ」の主因だった (ユーザー指摘)。
              出典→本文の縦組みだけで構造は十分伝わる。 */}
        {inner}
      </PressableScale>

      {/* 右上「…」メニュー。カード PressableScale の「兄弟」として上に重ねる。 */}
      {onMore ? (
        <Pressable
          onPress={onMore}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="その他の操作"
          style={{
            position: 'absolute',
            top: SP['3'],
            right: SP['3'],
            width: 28,
            height: 28,
            borderRadius: R.full,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.more size={18} color={C.text3} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

// MetaNum で渡すアイコンの再 export。
export { Heart as MetaHeartIcon, MessageCircle as MetaCommentIcon };
// 出典行で使う矢印/シェブロンは constants/icons.ts 経由(Icon.arrowUL / Icon.chevronR)。
export { Icon as MyEntryIcons };
