// ============================================================
// SheetSwipeDown — 既存の手組み Modal シートに「下スワイプ dismiss」を後付けする wrapper
// ============================================================
// 2026-06-12 P0-2 対応:
//   監査で判明: TagPickerSheet / VisibilitySheet / ContentWarningSheet / ReportSheet 等
//   10 箇所が "grabber 36×4 を描画しているが、Pan gesture が実装されていない" 状態。
//   ユーザーは「引っ張れる」と認識して指を下げるが、何も起こらない (backdrop tap でしか閉じない)。
//   Apple HIG「Sheets」: grabber を表示する sheet は **下スワイプで滑落できる** ことが暗黙契約。
//
//   完全な @gorhom/bottom-sheet 移行は大規模書き換えが必要 (各シート 200+ 行) なため、
//   既存の Modal + Reanimated SlideInDown 構造を温存しつつ、
//   この薄い wrapper で Pan gesture と translateY 追従だけを足す。
//
// 使い方:
//   <Modal transparent visible={visible} ...>
//     <Animated.View entering={FadeIn} style={scrim}>
//       <Pressable style={absFill} onPress={onClose} />  {/* backdrop */}
//       <SheetSwipeDown onClose={onClose}>
//         <Animated.View entering={SlideInDown} exiting={SlideOutDown} style={panel}>
//           {/* grabber + header + content */}
//         </Animated.View>
//       </SheetSwipeDown>
//     </Animated.View>
//   </Modal>
//
// 設計判断:
//   - DISMISS_THRESHOLD=100px or VELOCITY_THRESHOLD=800px/s で onClose を呼ぶ (iOS 流の慣性閾値)
//   - 下方向のみ追従 (上方向は 0 にクランプ — sheet は上限にもう貼り付いている)
//   - release 時にスナップバック (spring SPRING_LIQUID_FAST = duration 0.18, dampingRatio 0.85)
//   - reduceMotion 時は spring → withTiming(120ms) に倒す
//   - 入れ子の ScrollView/TextInput の縦 pan を奪わないよう `Gesture.Pan().activeOffsetY([-5, 5])`
//     で「明確に下スワイプ」した時だけ activate
// ============================================================
import React from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const DISMISS_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 800;

type Props = {
  children: React.ReactNode;
  onClose: () => void;
  /** swipe を無効化したい場合 (例: keyboard 表示中) */
  enabled?: boolean;
};

export function SheetSwipeDown({ children, onClose, enabled = true }: Props) {
  const reduceMotion = useReducedMotion();
  const translateY = useSharedValue(0);

  const panGesture = Gesture.Pan()
    // 上下 5px 動かない限り activate しない → ScrollView の縦 scroll を奪わない
    .activeOffsetY([-5, 15])
    .enabled(enabled)
    .onChange((e) => {
      // 下方向のみ追従、上方向は 0 にクランプ
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const shouldDismiss =
        e.translationY > DISMISS_THRESHOLD || e.velocityY > VELOCITY_THRESHOLD;

      if (shouldDismiss) {
        runOnJS(onClose)();
        // 次回 open 時に最上部から sliding できるよう即座に reset
        translateY.value = 0;
      } else if (reduceMotion) {
        translateY.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) });
      } else {
        // Apple .snappy 相当。reanimated の duration は ms 単位
        // (初版は 0.2 と書いて 0.2ms=即時スナップになっていた — motion 監査で発見)
        translateY.value = withSpring(0, { duration: 200, dampingRatio: 0.85 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}
