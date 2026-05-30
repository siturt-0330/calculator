// =============================================================================
// EditorialVisibilityCards — 閲覧範囲(公開設定)の3択ピッカー
// -----------------------------------------------------------------------------
// EDITORIAL「特集」言語(黒地 C.bg + 1px hairline + 大型タイポ + accent を一点集中)。
// 塗りカードにせず、各行は上 hairline で区切る「誌面リスト」。
//   左 : 小アイコン  open=globe(green) / request=lock(amber) / invite=shield(red)
//   中央: label(T.bodyMd)+desc(T.caption, 2行)
//   右 : ラジオ  選択=accent 塗り+Icon.ok(#fff) / 非選択=borderWidth2 C.text4 の円
// 選択行は「行頭を滑る accent の縦バー」一本だけで誌面的に示す(塗りつぶし背景なし)。
//   → CategoryRunningHead の滑る下線を縦に翻案。単一 Animated.View を translateY で移動。
// presentational に徹する(fetch/router/store なし)。内部 state は縦バー位置の
// sharedValue(idxP)のみ。アイコン色は value による静的切替(Icon は Animated 非対応)。
// =============================================================================

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  FadeIn,
  useReducedMotion,
} from 'react-native-reanimated';

import { C, SP, R, SIZE } from '../../design/tokens';
import { T, FONT, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';
import { SPRING_TIGHT, TIMING_FAST } from '../../design/motion';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';

// -----------------------------------------------------------------------------
// 型 / 定数
// -----------------------------------------------------------------------------

type Visibility = 'open' | 'request' | 'invite';

export interface EditorialVisibilityCardsProps {
  value: Visibility;
  onChange: (v: Visibility) => void;
}

type Choice = {
  key: Visibility;
  icon: keyof typeof Icon;
  iconColor: string;
  label: string;
  desc: string;
};

// open / request / invite の順で縦積み。アイコン色は仕様どおり green/amber/red。
const CHOICES: readonly Choice[] = [
  {
    key: 'open',
    icon: 'globe',
    iconColor: C.green,
    label: 'オープン',
    desc: 'だれでも参加・検索に表示',
  },
  {
    key: 'request',
    icon: 'lock',
    iconColor: C.amber,
    label: 'クローズ・許可制',
    desc: '承認が必要・検索に表示',
  },
  {
    key: 'invite',
    icon: 'shield',
    iconColor: C.red,
    label: 'クローズ・完全招待制',
    desc: '検索に出ない・招待のみ',
  },
] as const;

// 行高は一定(縦バー移動を成立させるため定数化)。説明は2行ぶんを見込む。
const ROW_H = 64;
const ICON_SIZE = 18;
const RADIO_SIZE = 20;

// 選択 index を安全に求める(noUncheckedIndexedAccess 配慮。未一致は 0)。
function indexOf(value: Visibility): number {
  const i = CHOICES.findIndex((c) => c.key === value);
  return i < 0 ? 0 : i;
}

// -----------------------------------------------------------------------------
// 本体
// -----------------------------------------------------------------------------

export function EditorialVisibilityCards({ value, onChange }: EditorialVisibilityCardsProps) {
  const reduce = useReducedMotion();

  // 行頭を滑る単一 accent 縦バーの位置(行 index)。これだけが内部 state。
  const idxP = useSharedValue(indexOf(value));

  useEffect(() => {
    const target = indexOf(value);
    if (reduce) {
      // reduce-motion: 滑りを抑え位置だけ素早く反映。
      idxP.value = withTiming(target, TIMING_FAST);
    } else {
      idxP.value = withSpring(target, SPRING_TIGHT);
    }
  }, [value, reduce, idxP]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: idxP.value * ROW_H }],
  }));

  return (
    <View style={styles.root}>
      {/* 見出し ACCESS(英字ラベルのみ Syne) */}
      <Text style={styles.heading}>ACCESS</Text>

      <View style={styles.rows}>
        {/* 単一の滑る縦バー(行頭・accent)。塗り背景の代わりに進行を一点で可視化。 */}
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, indicatorStyle]}
        />

        {CHOICES.map((c, i) => {
          const selected = c.key === value;
          const isLast = i === CHOICES.length - 1;
          // アイコンは Icon マップから解決してから使う(Icon は name-prop 非対応)。
          const ChoiceIcon = Icon[c.icon];
          return (
            <PressableScale
              key={c.key}
              onPress={() => onChange(c.key)}
              haptic="select"
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={c.label}
              style={[styles.row, !isLast && styles.rowDivider]}
            >
              {/* 左: 状態アイコン(色は仕様固定値・value 非依存で意味を保持) */}
              <View style={styles.iconCell}>
                <ChoiceIcon size={ICON_SIZE} color={c.iconColor} />
              </View>

              {/* 中央: label + 2行 desc */}
              <View style={styles.textCell}>
                <Text style={styles.label} numberOfLines={1}>
                  {c.label}
                </Text>
                <Text style={styles.desc} numberOfLines={2}>
                  {c.desc}
                </Text>
              </View>

              {/* 右: ラジオ(選択=accent 塗り+ok / 非選択=borderWidth2 C.text4 の円) */}
              {selected ? (
                <Animated.View
                  entering={reduce ? undefined : FadeIn.duration(120)}
                  style={[styles.radio, styles.radioOn]}
                >
                  <Icon.ok size={12} color="#fff" />
                </Animated.View>
              ) : (
                <View style={[styles.radio, styles.radioOff]} />
              )}
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: SP[5],
    paddingVertical: SP[4],
  },
  heading: {
    ...T.caption,
    // Apple SF 系の英字ラベル(NEW COMMUNITY マストヘッドと統一)。
    fontFamily: LOGO_FONT,
    fontWeight: LOGO_FONT_WEIGHT,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.6,
    color: C.text3,
    textTransform: 'uppercase',
    marginBottom: SP[3],
  },
  rows: {
    position: 'relative',
  },
  // 行頭を滑る単一 accent 縦バー(幅2px・高さ ROW_H)。
  indicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 2,
    height: ROW_H,
    borderRadius: R.full,
    backgroundColor: C.accent,
  },
  row: {
    minHeight: ROW_H,
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP[3],
    // 行頭の縦バーぶんの余白(選択時に文字が紫柱と被らないよう常時空ける)。
    paddingLeft: SP[3],
  },
  // 行間 hairline(最終行の下は省く=束の終端)。
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.divider,
  },
  iconCell: {
    width: SIZE.iconMd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCell: {
    flex: 1,
  },
  label: {
    ...T.bodyMd,
    fontFamily: FONT.jpM,
    fontSize: 15,
    lineHeight: 22,
    color: C.text,
  },
  desc: {
    ...T.caption,
    fontFamily: FONT.jp,
    fontSize: 11,
    lineHeight: 15,
    color: C.text3,
    marginTop: SP[1],
  },
  radio: {
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    borderRadius: R.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    backgroundColor: C.accent,
  },
  radioOff: {
    borderWidth: 2,
    borderColor: C.text4,
  },
});

export default EditorialVisibilityCards;
