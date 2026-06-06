// ============================================================
// CommunitySortTabs — 滑るアンダーラインのソートタブ
// ------------------------------------------------------------
// 「新しい順 / 人気順 / 古い順」を等幅3タブで並べ、選択中は紫の2pxセグメントが
// スッと滑る(SPRING_TIGHT)。文字は active/inactive の2層 opacity クロスフェード。
// 紫はこの下線セグメント1点のみ(ブリーフ「紫は要所に点で」)。
// 色は useColors() で解決し worklet 内では数値補間のみ(light/dark で紫が割れない)。
// ============================================================
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { PressableScale } from '../ui/PressableScale';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { T } from '../../design/typography';
import { SP } from '../../design/tokens';
import { SPRING_TIGHT } from '../../design/motion';

export type FeedSort = 'new' | 'top' | 'old';

const TABS: { v: FeedSort; label: string }[] = [
  { v: 'new', label: '新しい順' },
  { v: 'top', label: '人気順' },
  { v: 'old', label: '古い順' },
];

const ROW_H = 44;

export function CommunitySortTabs({
  value,
  onChange,
}: {
  value: FeedSort;
  onChange: (v: FeedSort) => void;
}) {
  const C = useColors();
  const reduce = useReducedMotion();
  const idx = Math.max(0, TABS.findIndex((t) => t.v === value));
  const [rowW, setRowW] = useState(0);
  const tabW = rowW > 0 ? rowW / TABS.length : 0;
  const xP = useSharedValue(idx);

  useEffect(() => {
    if (reduce) xP.value = idx;
    else xP.value = withSpring(idx, SPRING_TIGHT);
  }, [idx, reduce, xP]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: xP.value * tabW + tabW * 0.225 }],
  }));

  return (
    <View style={{ paddingHorizontal: SP['4'], paddingVertical: SP['3'] }}>
      <View
        style={{ height: ROW_H, flexDirection: 'row', position: 'relative' }}
        onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
      >
        {TABS.map((t, i) => (
          <PressableScale
            key={t.v}
            onPress={() => onChange(t.v)}
            haptic="tap"
            accessibilityRole="tab"
            accessibilityState={{ selected: t.v === value }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <SortLabel label={t.label} index={i} xP={xP} active={C.text} inactive={C.text3} />
          </PressableScale>
        ))}

        {/* 地平線 hairline(カードの髪線と地続き) */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: C.divider,
          }}
        />
        {/* 滑る紫セグメント(唯一の発色点) */}
        {tabW > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                bottom: 0,
                height: 2,
                borderRadius: 1,
                backgroundColor: C.accent,
                width: tabW * 0.55,
              },
              indicatorStyle,
            ]}
          />
        )}
      </View>
    </View>
  );
}

function SortLabel({
  label,
  index,
  xP,
  active,
  inactive,
}: {
  label: string;
  index: number;
  xP: SharedValue<number>;
  active: string;
  inactive: string;
}) {
  const activeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(xP.value, [index - 1, index, index + 1], [0, 1, 0], Extrapolation.CLAMP),
  }));
  const inactiveStyle = useAnimatedStyle(() => ({
    opacity: interpolate(xP.value, [index - 1, index, index + 1], [1, 0, 1], Extrapolation.CLAMP),
  }));
  return (
    <View style={{ position: 'relative' }}>
      <Animated.Text style={[T.smallM, { color: inactive, letterSpacing: -0.08 }, inactiveStyle]}>
        {label}
      </Animated.Text>
      <Animated.Text
        style={[
          T.smallM,
          { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: active, letterSpacing: -0.08 },
          activeStyle,
        ]}
      >
        {label}
      </Animated.Text>
    </View>
  );
}
