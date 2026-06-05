// ============================================================
// MyEntryRow — マイページ「誌面行カード」(Atelier 改 共通行部品)
// ------------------------------------------------------------
// 投稿 / コメント / 保存 の3タブで寸法を完全に揃えた単一の行カード。
// (旧 UserPostsList:PostCard / SavedPostsList:SavedCard / MetaIcon の
//  DRY 違反をここに統合・刷新する。)
//
// 設計意図 (誌面=静謐・1画面1アクセント):
//   - コンテナは「箱を持たない地組み」ではなく bg2 不透明 + 1px divider の
//     極薄カード。影ゼロ。border 1px で浮かせ「どこを押せるか」を常に明示
//     (usability レンズの指摘=タップ領域のアフォーダンス確保への回答)。
//   - 角丸は同心 (concentric): カード R.lg(14) の内側サムネ・media は必ず
//     1段小さい R.md(10)。1カードで3種以上の角丸を混ぜない。
//   - メディア無しサムネは灰プレースホルダではなく monogram
//     (GRAD.glass 面 + 本文先頭1字を Syne で) =「欠落図版を作品の扉に」。
//   - メタの数字 (like/comment) は必ず Inter (T.num)。日本語フォントの数字は
//     baseline がガタつき安く見えるため。ハート自体は accent にしない=無彩色。
//   - accent (#7C6AF7) は variant='comment' の引用縦罫のみ (所有印)。
//     それ以外で色を足さない (1画面1アクセント厳守)。
//
// 入場は FadeInDown stagger (先頭6枚のみ delay i*40、以降0)。
// useReducedMotion 時は entering を無効化し opacity のみ (transform 殺し)。
// ============================================================

import type { ReactNode } from 'react';
import { View, Text, Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Heart, MessageCircle, Play } from 'lucide-react-native';

import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, GRAD, R, SP } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// コメント添付メディア (migration 0104) の動画判定 — 拡張子ベース。それ以外は画像。
// (components/post/CommentThreadItem.tsx と同一正規表現を踏襲)
const COMMENT_VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)(\?|#|$)/i;

// 入場 stagger: 先頭6枚のみ index*40ms ずらす。以降 0 (スクロール遅延入場の重さ回避)。
const STAGGER_STEP_MS = 40;
const STAGGER_MAX_INDEX = 6;

export type MyEntryVariant = 'post' | 'comment' | 'saved';

export interface MyEntryRowProps {
  /** 行の種別。'comment' のみ左 accent 引用罫 + 出典行 + media 小サムネを出す。 */
  variant: MyEntryVariant;
  /** 左サムネ用 cover URL。null なら monogram fallback。 */
  thumbUri: string | null;
  /** monogram の中央に出す1文字の元ネタ (title?.[0] ?? content[0] 等を呼び出し側で解決して渡す)。 */
  monogramSeed: string;
  /** 見出し行 (post/saved のタイトル)。null/未指定なら本文を主役にする。 */
  title?: string | null;
  /** 本文スニペット (post/saved) または コメント本文 (comment)。 */
  snippet: string;
  /** メタ行 (MetaNum 群 + 時刻 等)。呼び出し側で組んで渡す。comment では未使用想定。 */
  metaNode?: ReactNode;
  /** メタ行末の追加バッジ (post の「非公開」amber ピル等)。 */
  badgeNode?: ReactNode;
  /** comment の出典行 (どの投稿への返信か)。variant='comment' でのみ描画。 */
  quoteNode?: ReactNode;
  /** comment の添付メディア URL (1枚目のみ小サムネ表示)。複数なら +N を出す。 */
  commentMedia?: string[] | null;
  /** タップ時遷移。 */
  onPress: () => void;
  /** 入場 stagger 用の index (リスト内位置)。 */
  index?: number;
  /** a11y ラベル (例: '投稿を開く' / 'コメントした投稿を開く')。 */
  accessibilityLabel?: string;
}

// ------------------------------------------------------------
// MetaNum — Heart / MessageCircle アイコン + 数値。
// 数値は必ず Inter (T.num) で出す (日本語フォントの数字は baseline が
// ガタつき安く見えるため)。色は無彩 C.text3 (ハートを accent にしない)。
// ------------------------------------------------------------
export function MetaNum({
  Icon: I,
  value,
}: {
  Icon: typeof Heart;
  value: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <I size={12} color={C.text3} strokeWidth={2} />
      <Text style={[T.num, { fontSize: 12, lineHeight: 16, color: C.text3 }]}>
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------
// Monogram — メディア無しサムネの「作品の扉」。
// 72x72 R.md に GRAD.glass 面 + C.bg2 の薄下地 (透けすぎ防止) を敷き、
// 中央に本文/タイトル先頭1字を Syne(FONT.display) 32 / C.accentLight で。
// 装飾なので accessibilityElementsHidden (VoiceOver で読ませない)。
// ------------------------------------------------------------
export function Monogram({ seed, size = 72 }: { seed: string; size?: number }) {
  const ch = seed.trim().charAt(0) || '・';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: R.md,
        overflow: 'hidden',
        backgroundColor: C.bg2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* GRAD.glass 面 (紫の極薄グラデ) — 角丸内に敷く。下地 bg2 は親 View 側。 */}
      <LinearGradient
        colors={GRAD.glass}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <Text style={{ fontFamily: FONT.display, fontSize: 32, color: C.accentLight }}>{ch}</Text>
    </View>
  );
}

// ------------------------------------------------------------
// CommentMediaThumb — コメント添付の小サムネ (56x56 R.md)。
// マイページでは VideoPlayer フル搭載はせず、動画は静止サムネ + ▶ オーバーレイ
// で軽量に (再生は遷移先に委ねる)。複数枚なら 1枚目のみ + 右下「+N」。
// ------------------------------------------------------------
function CommentMediaThumb({ urls }: { urls: string[] }) {
  const first = urls[0];
  if (!first) return null;
  const isVideo = COMMENT_VIDEO_EXT_RE.test(first);
  const extra = urls.length - 1;
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: R.md,
        overflow: 'hidden',
        backgroundColor: C.bg3,
        marginTop: SP['2'],
      }}
    >
      <ExpoImage
        source={{ uri: thumbedUrl(first, 144, { height: 144 }) }}
        style={{ width: 56, height: 56 }}
        contentFit="cover"
        transition={140}
        cachePolicy="memory-disk"
        recyclingKey={first}
      />
      {isVideo ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.28)',
          }}
        >
          <Play size={18} color="#fff" fill="#fff" strokeWidth={0} />
        </View>
      ) : null}
      {extra > 0 ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            paddingHorizontal: 5,
            paddingVertical: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            borderTopLeftRadius: R.sm,
          }}
        >
          <Text style={[T.num, { fontSize: 11, lineHeight: 14, color: '#fff' }]}>{`+${extra}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function MyEntryRow({
  variant,
  thumbUri,
  monogramSeed,
  title,
  snippet,
  metaNode,
  badgeNode,
  quoteNode,
  commentMedia,
  onPress,
  index = 0,
  accessibilityLabel,
}: MyEntryRowProps) {
  const reduceMotion = useReducedMotion();
  const isComment = variant === 'comment';
  const hasTitle = !isComment && !!title && title.trim().length > 0;

  // 入場アニメ: reduceMotion 時は無効。
  // ★ Web では FlashList のリサイクルで FadeInDown が再発火し、カードが一瞬
  //   opacity 0 になって「消える/チラつく」(初回も不可視に見える)。react-native-web
  //   の layout animation は不安定なので web では entering を無効化し即時表示にする。
  const entering =
    reduceMotion || Platform.OS === 'web'
      ? undefined
      : FadeInDown.duration(280)
          .springify()
          .damping(18)
          .delay(Math.min(index, STAGGER_MAX_INDEX) * STAGGER_STEP_MS);

  return (
    <Animated.View entering={entering}>
      <PressableScale
        onPress={onPress}
        haptic="tap"
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={{
          flexDirection: 'row',
          gap: SP['3'],
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.divider,
        }}
      >
        {/* variant='comment': 左端 accent 引用縦罫 (= あなたの声 = blockquote の所有印)。
            タブ下線・アバ ring と同じ accent で統一。bar 右に SP3 の溝。 */}
        {isComment ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 2,
              alignSelf: 'stretch',
              borderRadius: 1,
              backgroundColor: C.accent,
              opacity: 0.9,
            }}
          />
        ) : (
          // post/saved: 左サムネ 72x72 R.md (cover あれば ExpoImage、無ければ monogram)。
          // カード R.lg の内側は必ず1段小さい R.md = 同心角丸。
          <>
            {thumbUri ? (
              <ExpoImage
                source={{ uri: thumbedUrl(thumbUri, 144, { height: 144 }) }}
                style={{ width: 72, height: 72, borderRadius: R.md, backgroundColor: C.bg3 }}
                contentFit="cover"
                transition={140}
                cachePolicy="memory-disk"
                recyclingKey={`${variant}:${monogramSeed}:${thumbUri}`}
              />
            ) : (
              <Monogram seed={monogramSeed} />
            )}
          </>
        )}

        {/* 右: タイトル + 本文 + メタ (または comment 本文 + media + 出典行)。
            minWidth:0 で flex 子の text 折り返しを許可 (はみ出し防止)。 */}
        <View style={{ flex: 1, minWidth: 0 }}>
          {isComment ? (
            <>
              {/* 自分のコメント本文 (主役) = C.text。出典より上の階層。 */}
              <Text style={[T.body, { color: C.text }]} numberOfLines={2} ellipsizeMode="tail">
                {snippet || ' '}
              </Text>
              {commentMedia && commentMedia.length > 0 ? (
                <CommentMediaThumb urls={commentMedia} />
              ) : null}
              {quoteNode ?? null}
            </>
          ) : (
            <>
              {hasTitle ? (
                <Text style={[T.bodyB, { color: C.text, letterSpacing: -0.2 }]} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
              <Text
                style={[
                  T.small,
                  { color: hasTitle ? C.text2 : C.text, marginTop: hasTitle ? 2 : 0 },
                ]}
                numberOfLines={hasTitle ? 1 : 2}
              >
                {snippet || ' '}
              </Text>
              {metaNode ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SP['3'],
                    marginTop: SP['2'],
                  }}
                >
                  {metaNode}
                  {badgeNode ?? null}
                </View>
              ) : null}
            </>
          )}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

// MetaNum で渡すアイコンの再 export (呼び出し側が import を1本化できるよう)。
export { Heart as MetaHeartIcon, MessageCircle as MetaCommentIcon };
// 出典行で使う矢印/シェブロンは constants/icons.ts (Icon.arrowUL / Icon.chevronR) を直接使う。
export { Icon as MyEntryIcons };
