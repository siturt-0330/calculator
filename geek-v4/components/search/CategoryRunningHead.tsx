// =============================================================================
// CategoryRunningHead — EDITORIAL「特集」検索のカテゴリ切替ランニングヘッド
// -----------------------------------------------------------------------------
// 役割: すべて / 投稿 / コミュニティ のカテゴリ切替。
// デザイン方針:
//   - 塗りタブ(ピル)を廃止。エディトリアルな「ランニングヘッド」表現に。
//   - ラベルは中黒「・」(C.text4)区切りで横並び。active=C.text / inactive=C.text3。
//   - 件数は塗らず T.captionM / C.text3 で小さく添える。
//   - アクティブラベル直下を「滑る accent 下線」(高さ2 / C.accent)が追従。
//   - 各ラベルは onLayout で {x,width} を計測し、category 変化で withSpring 追従。
//     計測前(width 0)は下線を出さない。Reduced Motion 時は withTiming 即移動。
//   - タップ領域は paddingVertical で 44pt を確保(hit area)。
// =============================================================================

import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Text, type LayoutChangeEvent } from 'react-native';

import { C, SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { SPRING_TIGHT, TIMING_FAST } from '../../design/motion';
import { PressableScale } from '../ui/PressableScale';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';

export type SearchCategory = 'all' | 'posts' | 'communities';

type CategoryTab = {
  key: SearchCategory;
  label: string;
  count: number;
};

type CategoryRunningHeadProps = {
  tabs: CategoryTab[];
  category: SearchCategory;
  onChange: (k: SearchCategory) => void;
};

type Measurement = {
  x: number;
  width: number;
};

export function CategoryRunningHead({ tabs, category, onChange }: CategoryRunningHeadProps) {
  const reducedMotion = useReducedMotion();

  // 各ラベルの実寸 {x,width}。index 揃えで保持。
  const [layouts, setLayouts] = useState<Record<string, Measurement>>({});

  const underlineX = useSharedValue(0);
  const underlineW = useSharedValue(0);

  const handleLayout = useCallback(
    (key: SearchCategory) => (e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      setLayouts((prev) => {
        const prevEntry = prev[key];
        // 同値再計測は state 更新を避ける(無駄な再レンダー抑止)。
        if (prevEntry && prevEntry.x === x && prevEntry.width === width) {
          return prev;
        }
        return { ...prev, [key]: { x, width } };
      });
    },
    [],
  );

  // アクティブカテゴリ or 計測結果が変わったら下線を追従。
  useEffect(() => {
    const target = layouts[category];
    if (!target || target.width <= 0) {
      // 未計測 → 下線は出さない(width 0 のまま)。
      return;
    }
    if (reducedMotion) {
      underlineX.value = withTiming(target.x, TIMING_FAST);
      underlineW.value = withTiming(target.width, TIMING_FAST);
    } else {
      underlineX.value = withSpring(target.x, SPRING_TIGHT);
      underlineW.value = withSpring(target.width, SPRING_TIGHT);
    }
  }, [category, layouts, reducedMotion, underlineX, underlineW]);

  const underlineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: underlineX.value }],
    width: underlineW.value,
    // 計測前(width 0)は完全非表示。
    opacity: underlineW.value > 0 ? 1 : 0,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {tabs.map((tab, index) => {
          const isActive = tab.key === category;
          const isLast = index === tabs.length - 1;
          return (
            <React.Fragment key={tab.key}>
              <PressableScale
                haptic="select"
                onPress={() => onChange(tab.key)}
                onLayout={handleLayout(tab.key)}
                accessibilityRole="tab"
                accessibilityLabel={`${tab.label} ${tab.count}`}
                accessibilityState={{ selected: isActive }}
                style={styles.tab}
              >
                <View style={styles.tabInner}>
                  <Text style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}>
                    {tab.label}
                  </Text>
                  <Text style={styles.count}>{tab.count}</Text>
                </View>
              </PressableScale>
              {!isLast ? <Text style={styles.separator}>・</Text> : null}
            </React.Fragment>
          );
        })}

        {/* 滑る accent 下線 */}
        <Animated.View pointerEvents="none" style={[styles.underline, underlineStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SP[5],
    height: SIZE.touch,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: SIZE.touch,
    // 下線を行の left=0 基準で absolute 配置するため relative コンテキスト化。
    position: 'relative',
  },
  tab: {
    height: SIZE.touch,
    justifyContent: 'center',
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    // 44pt hit area を縦パディングで確保。
    paddingVertical: SP[3],
    paddingHorizontal: SP[2],
  },
  label: {
    ...T.smallM,
  },
  labelActive: {
    color: C.text,
  },
  labelInactive: {
    color: C.text3,
  },
  count: {
    ...T.captionM,
    color: C.text3,
    marginLeft: SP[1],
  },
  separator: {
    ...T.smallM,
    color: C.text4,
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2,
    backgroundColor: C.accent,
    borderRadius: 1,
  },
});
