// =============================================================================
// EditorialSection — EDITORIAL「特集」検索タブ 共通ラッパー
// -----------------------------------------------------------------------------
// 役割:
//   Discovery 各セクションに「誌面見出し(英題 Syne + 和題 NotoSansJP)+ 罫線」を
//   付与し、既存 wrapper(HotPostsRow / ForYouShelf 等の横スク)を props 不変で内包
//   するための薄い共通ラッパー。children 側が自前で横スク/左右 padding を持つ前提
//   なので、本コンポーネントは children に左右 padding を足さない(見出し行のみ付与)。
//
//   併せて巻頭特集バリアント <EditorialLeadStory /> も同ファイルで提供する。
//   背景に薄字の大型ランク番号(Syne)、前面に日本語トピック(NotoSansJP_700Bold)、
//   巻頭マーカー(accent 下線)、投稿数を配置し PressableScale でタップ可能にする。
//
// フォント規約(重要):
//   Syne(FONT.display)は欧文専用で CJK は描画されない。よって日本語の大型見出しは
//   { ...T.h1, fontFamily: FONT.jpB } で NotoSansJP_700Bold を使用する。英字ラベル
//   (セクション英題・数字)のみ Syne を使う。
//
// 制約: BlurView 不使用(フラット = Web 同一品質)/ iOS・Android・Web 全対応 /
//        重いアニメ無し(見出しに任意の FadeInDown のみ)。
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { C, SP } from '../../design/tokens';
import { T, FONT } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';

// -----------------------------------------------------------------------------
// EditorialSection — 見出し + 罫線 + children(横スク wrapper をそのまま内包)
// -----------------------------------------------------------------------------
interface EditorialSectionProps {
  /** 英題(Syne で描画する欧文。例: "TRENDING NOW") */
  titleEn: string;
  /** 和題(NotoSansJP。英題の補足として下に小さく出す。例: "注目の話題") */
  titleJa: string;
  /** 既存の横スク wrapper 等。自前で左右 padding / 横スクを持つ前提で素通し描画する。 */
  children: React.ReactNode;
}

export function EditorialSection({ titleEn, titleJa, children }: EditorialSectionProps) {
  return (
    <View style={styles.section}>
      {/* 見出し行(左右 padding はここだけ。children には足さない) */}
      <Animated.View entering={FadeInDown.duration(300)} style={styles.header}>
        <Text style={styles.titleEn} numberOfLines={1}>
          {titleEn}
        </Text>
        <Text style={styles.titleJa} numberOfLines={1}>
          {titleJa}
        </Text>
      </Animated.View>

      {/* 誌面罫線(hairline) */}
      <View style={styles.hairline} />

      {/* children はそのまま素通し(横スク/padding は children 側の責務) */}
      {children}
    </View>
  );
}

// -----------------------------------------------------------------------------
// EditorialLeadStory — 巻頭特集バリアント
//   背景薄字の大型ランク番号 + 前面の日本語トピック + 巻頭マーカー + 投稿数。
// -----------------------------------------------------------------------------
interface EditorialLeadStoryProps {
  /** ランク(あれば「01」等の 2 桁ゼロ詰めで背景に薄く描画) */
  rank?: number;
  /** 特集トピック(日本語 = NotoSansJP_700Bold で大きく) */
  topic: string;
  /** 投稿数(あれば「+N」で表示) */
  postCount?: number;
  onPress: () => void;
}

export function EditorialLeadStory({ rank, topic, postCount, onPress }: EditorialLeadStoryProps) {
  // 2 桁ゼロ詰め(rank=1 -> "01")。10 以上はそのまま String 化される。
  const rankLabel = rank !== undefined ? String(rank).padStart(2, '0') : undefined;

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={styles.lead}
      accessibilityRole="button"
      accessibilityLabel={`巻頭特集 ${topic}`}
    >
      {/* 上 hairline */}
      <View style={styles.leadHairline} />

      <View style={styles.leadBody}>
        {/* 背景の大型ランク番号(absolute 右上・薄字) */}
        {rankLabel !== undefined ? (
          <Text style={styles.leadRank} numberOfLines={1}>
            {rankLabel}
          </Text>
        ) : null}

        {/* 前面: 日本語トピック(NotoSansJP_700Bold) */}
        <Text style={styles.leadTopic} numberOfLines={3}>
          {topic}
        </Text>

        {/* 巻頭マーカー(accent 下線) */}
        <View style={styles.leadMarker} />

        {/* 投稿数 */}
        {postCount !== undefined ? (
          <Text style={styles.leadCount}>{`+${postCount}`}</Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  // --- EditorialSection ---
  section: {
    marginTop: SP[8],
  },
  header: {
    paddingHorizontal: SP[5],
  },
  titleEn: {
    ...T.h2,
    fontFamily: FONT.display, // Syne(欧文専用)
    letterSpacing: 0.5,
    color: C.text,
  },
  titleJa: {
    ...T.smallM,
    color: C.text3,
    letterSpacing: 1,
    marginTop: SP[1],
  },
  hairline: {
    height: 1,
    backgroundColor: C.divider,
    marginTop: SP[2],
    marginHorizontal: SP[5],
  },

  // --- EditorialLeadStory ---
  lead: {
    paddingHorizontal: SP[5],
    paddingVertical: SP[5],
  },
  leadHairline: {
    height: 1,
    backgroundColor: C.divider,
    marginBottom: SP[5],
  },
  leadBody: {
    position: 'relative',
  },
  leadRank: {
    ...T.hero,
    fontFamily: FONT.display, // Syne(数字 = 欧文として描画 OK)
    fontSize: 64,
    color: C.text4,
    opacity: 0.5,
    position: 'absolute',
    top: -SP[2],
    right: 0,
  },
  leadTopic: {
    ...T.h1,
    fontFamily: FONT.jpB, // 日本語大型見出しは NotoSansJP_700Bold
    color: C.text,
  },
  leadMarker: {
    width: 28,
    height: 2,
    backgroundColor: C.accent,
    marginTop: SP[3],
  },
  leadCount: {
    ...T.captionM,
    color: C.text3,
    marginTop: SP[2],
  },
});
