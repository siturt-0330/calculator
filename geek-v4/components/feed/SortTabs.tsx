import { View, LayoutChangeEvent } from 'react-native';
import { useState, useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../ui/PressableScale';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { TIMING_NORM } from '../../design/motion';
import { useColors, useGradients, useShadows } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useT } from '../../lib/i18n';
import type { SortMode } from '../../lib/api/posts';

// label は ja 文字列を直接書いて、表示時に useT で翻訳。DICT 側で en/zh/ko/es/fr 対応済。
// 'rising' は Reddit 風「直近 3h で likes/分 が速い post」— 既存 'hot' (= 累積 like) とは
// 別軸なので並列で出す。視覚的に区別するため 🚀 icon prefix を付与している。
// rising の label key は DICT に無いので useT は as-is で返す (= 多言語でも日本語 + 🚀)。
const ORDER: ReadonlyArray<{ v: SortMode; label: string; icon?: string }> = [
  { v: 'for-you', label: 'あなた向け' },
  { v: 'new', label: '新着' },
  { v: 'rising', label: '急上昇', icon: '🚀' },
  { v: 'hot', label: '急上昇' },
  { v: 'top', label: '人気' },
];

// container 内側 padding. indicator が container の rounded edge をはみ出さないように
// segW を inner width で計算する (SegmentedControl と同じ手法)。
const PAD = 3;
// active 時の underline 高さ。SortTabs では bottom に 2px の accent line を引く
// (gradient pill とは別に、より「タブらしい」表現を加える)。
const UNDERLINE_H = 2;
// Spring config — タブ系の indicator 用 (damping 22, stiffness 280) ※ 指示書準拠
const SORT_TABS_SPRING = { damping: 22, stiffness: 280, mass: 0.7 } as const;

export function SortTabs({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  const t = useT();
  const C = useColors();
  const GRAD = useGradients();
  const SHADOW = useShadows();
  const reduceMotion = useReducedMotion();

  const [w, setW] = useState(0);
  const innerW = Math.max(0, w - PAD * 2);
  const segW = innerW / ORDER.length;
  const idx = Math.max(0, ORDER.findIndex((o) => o.v === value));

  // indicator position (translateX) — segment 切替で spring slide
  const x = useSharedValue(0);

  useEffect(() => {
    if (segW <= 0) return;
    const target = idx * segW;
    if (reduceMotion) {
      x.value = target;
    } else {
      x.value = withSpring(target, SORT_TABS_SPRING);
    }
  }, [idx, segW, x, reduceMotion]);

  // pill (active セグメント背景の gradient) — translateX + 固定 width
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: segW,
  }));

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        // inactive は subtle (灰色背景) — bg3 で柔らかい segmented container 風
        backgroundColor: C.bg3,
        borderRadius: R.full,
        padding: PAD,
        borderWidth: 1,
        borderColor: C.divider,
        position: 'relative',
        // safety net — indicator が万一はみ出ても rounded shape で clip する
        overflow: 'hidden',
      }}
    >
      {/* スライドする active pill — 全タブ共通で 1 つだけ生成 */}
      {segW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: PAD,
              bottom: PAD,
              left: PAD,
              borderRadius: R.full,
              overflow: 'hidden',
              ...SHADOW.glow,
            },
            pillStyle,
          ]}
        >
          <LinearGradient
            colors={GRAD.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          {/* 底部 2px accent underline — gradient pill 内に重ねて「タブらしい」表現を加える */}
          <View
            style={{
              position: 'absolute',
              left: '20%',
              right: '20%',
              bottom: 0,
              height: UNDERLINE_H,
              borderRadius: UNDERLINE_H,
              backgroundColor: '#fff',
              opacity: 0.7,
            }}
          />
        </Animated.View>
      )}

      {ORDER.map((m) => (
        <SortTabItem
          key={m.v}
          mode={m}
          active={value === m.v}
          onPress={() => onChange(m.v)}
          translate={t}
          reduceMotion={reduceMotion}
          // ★ 2026-06-13: active ラベルは常に白 (pill は両テーマ濃色グラデ)。
          //   C.text だと light で黒文字 on チャコール pill = 不可視だった。
          textColor="#ffffff"
          textColorInactive={C.text2}
        />
      ))}
    </View>
  );
}

// ============================================================
// SortTabItem — 個別タブ。active 文字色を withTiming(180ms) でフェード
// ============================================================
function SortTabItem({
  mode,
  active,
  onPress,
  translate,
  reduceMotion,
  textColor,
  textColorInactive,
}: {
  mode: { v: SortMode; label: string; icon?: string };
  active: boolean;
  onPress: () => void;
  translate: (s: string) => string;
  reduceMotion: boolean;
  textColor: string;
  textColorInactive: string;
}) {
  // 文字色の不透明度を補間: active なら 1 (=textColor 白)、inactive なら 0 (= text2 灰)
  // 2 つのテキストを重ねて opacity で切り替えると色補間で worklet 上の interpolateColor が
  // 不要になり実装シンプル + 軽い。
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    const target = active ? 1 : 0;
    if (reduceMotion) {
      progress.value = target;
    } else {
      progress.value = withTiming(target, { duration: 180, easing: TIMING_NORM.easing });
    }
  }, [active, reduceMotion, progress]);

  const activeTextStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const inactiveTextStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={{
        flex: 1,
        paddingVertical: SP['2'],
        paddingHorizontal: SP['2'],
        borderRadius: R.full,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 2 つのテキストを重ねる (active = 白 / inactive = グレー)。
          opacity で fade することで色補間を worklet free にする。
          iOS-native: SF Pro Text の自然な tracking (-0.08 at size 13) を採用。
          旧 letterSpacing 0.3 は派手すぎたので落ち着いた負の値に。 */}
      <View>
        <Animated.Text
          style={[
            T.smallM,
            {
              color: textColor,
              fontWeight: '700',
              letterSpacing: -0.08,
            },
            activeTextStyle,
          ]}
        >
          {mode.icon ? `${mode.icon} ` : ''}
          {translate(mode.label)}
        </Animated.Text>
        <Animated.Text
          style={[
            T.smallM,
            {
              position: 'absolute',
              left: 0,
              right: 0,
              textAlign: 'center',
              color: textColorInactive,
              fontWeight: '600',
              letterSpacing: -0.08,
            },
            inactiveTextStyle,
          ]}
        >
          {mode.icon ? `${mode.icon} ` : ''}
          {translate(mode.label)}
        </Animated.Text>
      </View>
    </PressableScale>
  );
}
