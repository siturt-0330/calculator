// =============================================================================
// EditorialFormHeader — EDITORIAL「特集」言語の誌面マストヘッド
// -----------------------------------------------------------------------------
// 画面最上部に置く表紙的ヘッダー。左に小さな戻る(PressableScale + chevronL)、
// その下に英題(Syne 大文字級)+ 和題(灰・字間広め)、最下辺に 1px hairline。
//  - 黒地 C.bg + 1px 罫線 C.divider + 大型タイポの「特集」語彙を踏襲。
//  - 塗り/濃い影なし。accent は使わず静かな誌面の入口に徹する。
//  - presentational: state/fetch/router/store を持たず、表示と戻る導線のみ。
//    例外はマウント時の entering と reduce-motion 分岐のみ(視覚アニメ)。
//  - paddingHorizontal は自前で SP[5] を持つ(親レイアウトと独立して成立)。
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { C, SP } from '../../design/tokens';
import { T, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';

type EditorialFormHeaderProps = {
  /** 英題(欧文・Syne 大文字級の主役見出し) 例: 'NEW COMMUNITY' */
  titleEn: string;
  /** 和題(灰・小さめ・字間広めの添え) 例: 'コミュニティを作る' */
  titleJa: string;
  /** 戻る押下 */
  onBack: () => void;
};

export function EditorialFormHeader({ titleEn, titleJa, onBack }: EditorialFormHeaderProps) {
  const reduce = useReducedMotion();

  return (
    <Animated.View
      entering={reduce ? undefined : FadeInDown.duration(220)}
      style={styles.root}
    >
      {/* 戻る(小さく左上) */}
      <PressableScale
        onPress={onBack}
        haptic="tap"
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="戻る"
        style={styles.back}
      >
        <Icon.chevronL size={24} color={C.text} />
      </PressableScale>

      {/* 英題(主役) */}
      <Text style={styles.titleEn} numberOfLines={1}>
        {titleEn}
      </Text>

      {/* 和題(添え) */}
      <Text style={styles.titleJa} numberOfLines={1}>
        {titleJa}
      </Text>

      {/* 最下辺 hairline=『ここから目録カードの束』 */}
      <View style={styles.hairline} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: SP[5],
  },
  back: {
    width: 44,
    height: 44,
    marginLeft: -10, // chevron の光学位置を版面左端に寄せる
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  titleEn: {
    // Apple SF 系のスマートな見出し — system font(iOS=実物の SF Pro Display /
    // web=-apple-system stack)に、Apple Display 流のタイトな negative tracking。
    fontFamily: LOGO_FONT,
    fontWeight: LOGO_FONT_WEIGHT,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.8,
    color: C.text,
    marginTop: SP[1],
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
    marginTop: SP[3],
  },
});
