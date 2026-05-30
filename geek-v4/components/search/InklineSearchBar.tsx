// =============================================================================
// InklineSearchBar — EDITORIAL「特集」検索バー
// -----------------------------------------------------------------------------
// 役割: 枠なし・下線一本の検索バー。状態を「線」で語る。
//   - 角丸0 / 背景塗りなし。横並び: [search icon] [TextInput] [clear]
//   - 下辺の Animated.View(高さ1)が focus で太く(scaleY 1→1.5)・色 divider→accent
//   - isTyping 中だけ、下線内を幅60の小バーが左→右→左に1往復ループ(往復ハイライト)
//   - resultCount があれば下線右肩に「{n}件」を表示
//   - useReducedMotion() の時は往復ハイライトを出さない(下線色変化のみ)
//   - transform / opacity のみアニメ。BlurView 不使用(フラット=Web同一品質)。
// =============================================================================

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, type LayoutChangeEvent } from 'react-native';

import { C, SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { EASE_OUT } from '../../design/motion';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  interpolate,
  interpolateColor,
  Extrapolation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------
const BAR_HEIGHT = 52;
const SWEEP_WIDTH = 60; // 往復ハイライトの小バー幅
const SWEEP_DURATION = 380;
const PLACEHOLDER = '作品・コミュニティ・タグを検索';

// -----------------------------------------------------------------------------
// props
// -----------------------------------------------------------------------------
export interface InklineSearchBarProps {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClear: () => void;
  focusProgress: SharedValue<number>;
  resultCount?: number | null;
  isTyping?: boolean;
  // useRef<TextInput>(null) / useRef<TextInput | null>(null) 双方を受けられるよう Ref で緩める
  inputRef?: React.Ref<TextInput>;
}

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------
export function InklineSearchBar(props: InklineSearchBarProps) {
  const {
    value,
    onChangeText,
    onSubmit,
    onFocus,
    onBlur,
    onClear,
    focusProgress,
    resultCount,
    isTyping = false,
    inputRef,
  } = props;

  const reduceMotion = useReducedMotion();

  // 往復ハイライトの進捗 (0→1 で左→右、withRepeat reverse で 右→左)
  const sweep = useSharedValue(0);
  // 下線コンテナの実測幅(measure 前は 0 → スイープ描画しない)
  const [trackWidth, setTrackWidth] = useState(0);

  const hasValue = value.length > 0;
  // Icon は Animated 非対応なので static 判定で色付け
  const iconColor = isTyping || hasValue ? C.accentLight : C.text3;
  // 件数は「入力あり/typing 中 かつ 件数確定時」のみ。待機中に 0件 が貼り付くのを防ぐ。
  const showCount =
    (isTyping || hasValue) && typeof resultCount === 'number' && resultCount >= 0;
  const canSweep = isTyping && !reduceMotion && trackWidth > 0;
  // スイープの不透明度は SharedValue でフェード(boolean 即時切替の瞬断を避ける)
  const sweepOpacity = useSharedValue(0);

  // isTyping の立ち上がり/立ち下がりでスイープ開始・停止
  useEffect(() => {
    if (canSweep) {
      sweep.value = 0;
      sweep.value = withRepeat(
        withTiming(1, { duration: SWEEP_DURATION, easing: EASE_OUT }),
        -1,
        true,
      );
      sweepOpacity.value = withTiming(0.9, { duration: 160, easing: EASE_OUT });
    } else {
      // 停止して左端へ戻す + フェードアウト(残光しない)
      sweep.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) });
      sweepOpacity.value = withTiming(0, { duration: 160, easing: EASE_OUT });
    }
  }, [canSweep, sweep, sweepOpacity]);

  // 下辺の太さ・色アニメ (focus で 1px→2px, 色 divider→accent)
  // 強調太さは system 全体の罫線階調(通常1px / 強調2px)に揃える。
  const underlineStyle = useAnimatedStyle(() => {
    const scaleY = interpolate(
      focusProgress.value,
      [0, 1],
      [1, 2],
      Extrapolation.CLAMP,
    );
    const backgroundColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [C.divider, C.accent],
    );
    return {
      backgroundColor,
      transform: [{ scaleY }],
    };
  });

  // 往復ハイライトの小バー
  const sweepStyle = useAnimatedStyle(() => {
    // 左端(0)→右端(trackWidth - SWEEP_WIDTH)
    const maxX = Math.max(0, trackWidth - SWEEP_WIDTH);
    const translateX = interpolate(sweep.value, [0, 1], [0, maxX], Extrapolation.CLAMP);
    return {
      opacity: sweepOpacity.value,
      transform: [{ translateX }],
    };
  });

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== trackWidth) setTrackWidth(w);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Icon.search size={SIZE.iconMd} color={iconColor} />

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onFocus={onFocus}
          onBlur={onBlur}
          style={[T.body, styles.input]}
          placeholder={PLACEHOLDER}
          placeholderTextColor={C.text3}
          selectionColor={C.accent}
          cursorColor={C.accent}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={200}
          accessibilityLabel="検索"
        />

        {hasValue ? (
          <PressableScale
            onPress={onClear}
            haptic="tap"
            hitSlop={10}
            style={styles.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="クリア"
          >
            <Icon.close size={16} color={C.text2} />
          </PressableScale>
        ) : null}
      </View>

      {/* 下線トラック: 実測幅でスイープ範囲を決める */}
      <View style={styles.track} onLayout={onTrackLayout}>
        {/* 静的な下線(focus で太く・accent 化) */}
        <Animated.View style={[styles.underline, underlineStyle]} />
        {/* 往復ハイライト(typing 中のみ) */}
        <Animated.View style={[styles.sweep, sweepStyle]} pointerEvents="none" />
      </View>

      {showCount ? (
        <Text style={[T.captionM, styles.count]} numberOfLines={1}>
          {resultCount}件
        </Text>
      ) : null}
    </View>
  );
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: SP['5'],
    // 件数を下線下に inline 配置するための余白(absolute 浮遊で直下へ食い込むのを防ぐ)
    paddingBottom: SP['4'],
  },
  row: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['3'],
  },
  input: {
    flex: 1,
    color: C.text,
    paddingVertical: 0,
  },
  clearBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  // 下線トラック(高さ確保 + スイープのクリップ領域)
  track: {
    height: 2,
    width: '100%',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  underline: {
    height: 1,
    width: '100%',
    backgroundColor: C.divider,
  },
  sweep: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: SWEEP_WIDTH,
    height: 1,
    backgroundColor: C.accentLight,
  },
  count: {
    position: 'absolute',
    right: SP['5'],
    bottom: 0,
    color: C.text3,
  },
});
