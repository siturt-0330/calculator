// =============================================================
// EditorialMasthead — Discovery 上端の署名マストヘッド
// -------------------------------------------------------------
// 役割: EDITORIAL「特集」検索タブの最上部に置く大型の署名見出し。
//   ・1行目「今日の」(小)/ 2行目「特集」(超大型・NotoSansJP_700Bold)
//   ・右下に発行メタ volText(例「VOL.22 ／ 5月30日」/ 親が生成)
//   ・直下に hairline 区切り
// モーション: 親から focusProgress(0=blur/空, 1=focus)を受け取り、
//   フォーカスに入るほど「特集」ブロックが左上を基点に縮んで畳まれる
//   署名モーション(scale 1→0.42, 上&左へ寄せ)。発行メタ/全体は fade-out。
//   RN は transformOrigin 非対応のため translateX の負値で左基点を近似。
//   useReducedMotion()===true のときは transform を使わず opacity の
//   cross-fade のみ(transform/opacity だけを触りレイアウトは変えない)。
// =============================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import { C, SP } from '../../design/tokens';
import { T, FONT } from '../../design/typography';

// 「特集」が縮み切ったときの倍率(署名サイズ)
const COLLAPSED_SCALE = 0.42;
// 左基点(transformOrigin)を translateX で近似するための固定オフセット
const ORIGIN_SHIFT_X = -60;

type EditorialMastheadProps = {
  /** 0 = blur/空, 1 = focus。親が駆動する SharedValue */
  focusProgress: SharedValue<number>;
  /** 発行メタ文字列(例「VOL.22 ／ 5月30日」)。親が生成して渡す */
  volText: string;
};

export function EditorialMasthead({ focusProgress, volText }: EditorialMastheadProps) {
  const reduced = useReducedMotion();

  // 「特集」ブロック: focus で左上基点に縮んで畳まれる署名モーション
  const titleStyle = useAnimatedStyle(() => {
    const p = focusProgress.value;

    // reduced motion: transform は使わず opacity cross-fade のみ
    if (reduced) {
      return {
        opacity: interpolate(p, [0, 1], [1, 0], Extrapolation.CLAMP),
        transform: [],
      };
    }

    const scale = interpolate(p, [0, 1], [1, COLLAPSED_SCALE], Extrapolation.CLAMP);
    const translateY = interpolate(p, [0, 1], [0, -8], Extrapolation.CLAMP);
    const translateX = interpolate(p, [0, 1], [0, ORIGIN_SHIFT_X], Extrapolation.CLAMP);
    // 「特集」は縮み切る終盤(0.8→1)でだけ消す → scale の畳み込みを見せ切る(署名モーションの核)
    const opacity = interpolate(p, [0, 0.8, 1], [1, 1, 0], Extrapolation.CLAMP);

    return {
      opacity,
      transform: [{ translateX }, { translateY }, { scale }],
    };
  });

  // 発行メタ: focus で「先に」引く(title より早く消える=時間差で署名らしさ)
  const metaStyle = useAnimatedStyle(() => {
    const opacity = interpolate(focusProgress.value, [0, 0.35], [1, 0], Extrapolation.CLAMP);
    return { opacity };
  });

  // 全体ラッパ: 畳みが見えるよう前半は不透明を保ち、縮み切った最終盤(0.85→1)で一掃する。
  // (0→1 の一斉フェードにすると scale 畳みが掻き消されるため終盤だけに限定)
  const wrapStyle = useAnimatedStyle(() => {
    const opacity = interpolate(focusProgress.value, [0, 0.85, 1], [1, 1, 0], Extrapolation.CLAMP);
    return { opacity };
  });

  return (
    <Animated.View style={[styles.wrap, wrapStyle]}>
      <View style={styles.headingRow}>
        <View style={styles.headingCol}>
          <Text style={styles.kicker}>今日の</Text>
          <Animated.Text style={[styles.title, titleStyle]}>特集</Animated.Text>
        </View>

        <Animated.Text style={[styles.meta, metaStyle]} numberOfLines={1}>
          {volText}
        </Animated.Text>
      </View>

      <View style={styles.hairline} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: SP[5],
    paddingTop: SP[2],
    marginBottom: SP[6],
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headingCol: {
    flexShrink: 1,
  },
  kicker: {
    ...T.h2,
    color: C.text3,
  },
  // 日本語の大型見出しは NotoSansJP_700Bold(Syne は CJK 非対応)
  title: {
    ...T.h1,
    fontFamily: FONT.jpB,
    fontSize: 52,
    lineHeight: 54,
    letterSpacing: -1.5,
    color: C.text,
    // 左基点での縮小を自然に見せるため左寄せ
    alignSelf: 'flex-start',
  },
  meta: {
    ...T.captionM,
    color: C.text4,
    letterSpacing: 2,
    marginLeft: SP[3],
    paddingBottom: SP[1],
  },
  hairline: {
    height: 1,
    backgroundColor: C.divider,
    marginTop: SP[4],
  },
});
