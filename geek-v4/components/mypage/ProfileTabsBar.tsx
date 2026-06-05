// =============================================================================
// ProfileTabsBar — 3 タブ (投稿 / コメント / 保存済み) の章インデックス切替バー
// -----------------------------------------------------------------------------
// Reddit 風の下線が滑るアニメ。タブ高さ 48、underline 3px の accent。
// 親が active key と onChange を渡す制御コンポーネント。
// Atelier改: 'shared'(共有アルバム) を撤去し 'comments'(残したコメント) を新設。
// 件数はここでは出さない(誌面の SectionPillar 側で見せる)= タブ⇔柱の役割分担。
// 親 mypage が active state を単一管理し、実体バーと擬似sticky 複製バーの2インスタンスで共有する。
// =============================================================================

import { useEffect, useState } from 'react';
import { View, Text, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';

import { PressableScale } from '../ui/PressableScale';
import { C } from '../../design/tokens';
import { T } from '../../design/typography';
import { SPRING_TIGHT, TIMING_FAST } from '../../design/motion';

export type ProfileTabKey = 'posts' | 'comments' | 'saved';

const TABS: { key: ProfileTabKey; label: string }[] = [
  { key: 'posts', label: '投稿' },
  { key: 'comments', label: 'コメント' },
  { key: 'saved', label: '保存済み' },
];

export function ProfileTabsBar({
  active,
  onChange,
}: {
  active: ProfileTabKey;
  onChange: (k: ProfileTabKey) => void;
}) {
  const reduce = useReducedMotion();
  // タブ全体の幅を測る (親が flex で広がるため動的)。
  const [containerW, setContainerW] = useState(0);
  const tabW = containerW > 0 ? containerW / TABS.length : 0;

  // active タブの index → underline 移動
  const idx = Math.max(0, TABS.findIndex((t) => t.key === active));
  const xP = useSharedValue(idx);
  useEffect(() => {
    if (reduce) xP.value = withTiming(idx, TIMING_FAST);
    else xP.value = withSpring(idx, SPRING_TIGHT);
  }, [idx, reduce, xP]);

  const underlineStyle = useAnimatedStyle(() => ({
    width: tabW * 0.55,
    transform: [
      {
        translateX: xP.value * tabW + tabW * 0.225, // 中央寄せ (0.225 = (1-0.55)/2)
      },
    ],
  }));

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setContainerW(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        height: 48,
        borderBottomWidth: 1,
        borderBottomColor: C.divider,
        position: 'relative',
        backgroundColor: C.bg,
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <PressableScale
            key={t.key}
            onPress={() => onChange(t.key)}
            haptic="select"
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={t.label}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={[
                T.bodyB,
                {
                  fontSize: 15,
                  color: isActive ? C.text : C.text3,
                },
              ]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
          </PressableScale>
        );
      })}

      {/* 滑る accent 下線 (高さ 3px・角丸) */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: 3,
            borderRadius: 2,
            backgroundColor: C.accent,
          },
          underlineStyle,
        ]}
      />
    </View>
  );
}
