// ============================================================
// ImageLightbox — タップで開く全画面イメージビューア
// ============================================================
//
// 投稿カードの画像を tap したときに開く Modal。Apple Photos /
// Instagram のフルスクリーンビューアに寄せた挙動:
//
//   - 暗背景 (rgba(0,0,0,0.95)) で画像を中央配置 (contentFit: contain)
//   - ピンチで 1.0 〜 4.0 倍にズーム (clamp)
//   - ズーム中はパンで画像位置を動かせる
//   - ダブルタップで 1x ⇔ 2x をトグル
//   - 背景 single-tap で閉じる
//   - 下方向 swipe で閉じる (translateY > 100 or velocity > 800)
//   - 右上に閉じる × ボタン (SafeArea 対応)
//   - ReduceMotion 設定時は spring を使わず timing 150ms
//
// Performance:
//   - Modal は `visible=false` のとき React Native 側で lazy-render される
//     ので feed 内に多数置いても cheap
//   - feed の各 AnonPostCard 末尾に 1 つだけ常駐させる前提
//
// Web 注意:
//   - Web では Modal は内部で position:fixed の overlay として描画される
//   - GestureDetector + Pinch は web で機能しない (touch 不安定) ため、
//     web では tap-to-close と close button のみを残す簡略版
// ============================================================

import { memo, useCallback, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../constants/icons';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING_SNAPPY, EASE_OUT } from '../../design/motion';

type Props = {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
  alt?: string;
};

// ズーム上下限 — Apple Photos と同等
const MIN_SCALE = 1.0;
const MAX_SCALE = 4.0;
const DOUBLE_TAP_SCALE = 2.0;
// swipe-down dismiss しきい値
const DISMISS_TRANSLATE_Y = 100;
const DISMISS_VELOCITY = 800;
// ReduceMotion 時の timing
const REDUCE_MOTION_MS = 150;

function ImageLightboxInner({ visible, uri, onClose, alt }: Props) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { width: screenW, height: screenH } = useWindowDimensions();

  // shared values — gesture worklets 共有
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // swipe-down dismiss 用 — translateY とは別に持つ
  // (ズーム中の pan と混ざらないように "ズーム=1 のときだけ" 適用)
  const dismissY = useSharedValue(0);

  // close 後に reset するための helper (JS thread)
  const resetTransforms = useCallback(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    dismissY.value = 0;
  }, [
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
    dismissY,
  ]);

  // visible が false に切り替わったら transform を初期化
  // (次回開いたときに前回のズーム状態が残らないように)
  useEffect(() => {
    if (!visible) {
      resetTransforms();
    }
  }, [visible, resetTransforms]);

  // ========= Gestures =========
  // Pinch — 2 指でズーム (clamp: 1.0 〜 4.0)
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((e) => {
          const next = savedScale.value * e.scale;
          scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
        })
        .onEnd(() => {
          savedScale.value = scale.value;
          // ズーム解除時 (scale=1) は位置も中央に戻す
          if (scale.value <= MIN_SCALE + 0.01) {
            if (reduceMotion) {
              translateX.value = 0;
              translateY.value = 0;
            } else {
              translateX.value = withSpring(0, SPRING_SNAPPY);
              translateY.value = withSpring(0, SPRING_SNAPPY);
            }
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
          }
        }),
    [scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY, reduceMotion],
  );

  // Pan — ズーム中は画像移動 / 等倍時は swipe-down で閉じる
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(8)
        .onUpdate((e) => {
          if (scale.value > MIN_SCALE + 0.01) {
            // ズーム中: 画像位置を移動
            translateX.value = savedTranslateX.value + e.translationX;
            translateY.value = savedTranslateY.value + e.translationY;
          } else {
            // 等倍時: 下方向 swipe で dismiss 用 translateY (= 背景透過 + 画像追従)
            // 横スワイプや上スワイプは無視 (写真切替えはこの PR では実装しない)
            dismissY.value = Math.max(0, e.translationY);
          }
        })
        .onEnd((e) => {
          if (scale.value > MIN_SCALE + 0.01) {
            // ズーム中: 位置を確定
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
          } else {
            // 等倍時: しきい値を超えたら閉じる、超えなければ戻す
            const shouldDismiss =
              dismissY.value > DISMISS_TRANSLATE_Y || e.velocityY > DISMISS_VELOCITY;
            if (shouldDismiss) {
              if (reduceMotion) {
                dismissY.value = withTiming(
                  screenH,
                  { duration: REDUCE_MOTION_MS, easing: EASE_OUT },
                  () => runOnJS(onClose)(),
                );
              } else {
                dismissY.value = withTiming(
                  screenH,
                  { duration: 220, easing: EASE_OUT },
                  () => runOnJS(onClose)(),
                );
              }
            } else {
              if (reduceMotion) {
                dismissY.value = 0;
              } else {
                dismissY.value = withSpring(0, SPRING_SNAPPY);
              }
            }
          }
        }),
    [
      scale,
      translateX,
      translateY,
      savedTranslateX,
      savedTranslateY,
      dismissY,
      onClose,
      reduceMotion,
      screenH,
    ],
  );

  // Double tap — 1x ⇔ 2x トグル
  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(280)
        .onEnd(() => {
          const willZoom = scale.value <= MIN_SCALE + 0.01;
          const next = willZoom ? DOUBLE_TAP_SCALE : MIN_SCALE;
          if (reduceMotion) {
            scale.value = next;
            translateX.value = 0;
            translateY.value = 0;
          } else {
            scale.value = withTiming(next, { duration: 220, easing: Easing.out(Easing.cubic) });
            translateX.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
            translateY.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
          }
          savedScale.value = next;
          savedTranslateX.value = 0;
          savedTranslateY.value = 0;
        }),
    [
      scale,
      savedScale,
      translateX,
      translateY,
      savedTranslateX,
      savedTranslateY,
      reduceMotion,
    ],
  );

  // Single tap on backdrop — 閉じる (double tap と排他)
  const singleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDelay(250)
        .requireExternalGestureToFail(doubleTapGesture)
        .onEnd(() => {
          // ズーム中は閉じない (ズーム操作の最中に閉じてしまうのを防ぐ)
          if (scale.value > MIN_SCALE + 0.01) return;
          runOnJS(onClose)();
        }),
    [doubleTapGesture, scale, onClose],
  );

  // 全 gesture 合成
  // - pinch / pan は同時 (Simultaneous)
  // - tap 系は Exclusive (single は double が fail したら作動)
  const composedGesture = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Simultaneous(pinchGesture, panGesture),
        doubleTapGesture,
        singleTapGesture,
      ),
    [pinchGesture, panGesture, doubleTapGesture, singleTapGesture],
  );

  // ========= Animated styles =========
  // 画像本体: scale + translate (gesture 操作分)
  const imgAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value + dismissY.value },
      { scale: scale.value },
    ],
  }));

  // 背景の opacity: dismissY が増えるほど薄くなる (0..1 → 1..0)
  const backdropAnimStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, dismissY.value / 200);
    return { opacity: 1 - progress * 0.7 };
  });

  // ========= Render =========
  if (!visible || !uri) {
    // visible=false 時は Modal を完全に手放す (lazy render)
    return (
      <Modal visible={false} transparent animationType="none">
        <View />
      </Modal>
    );
  }

  // Web では gesture detector を使わず簡略 UI を出す
  // (RN Web の gesture-handler は touch / pointer event の整合性が不安定で、
  //  pinch zoom がブラウザ標準と競合する。Web はピンチ無し + tap-to-close 動作)
  const isWeb = Platform.OS === 'web';

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'fade' : 'fade'}
      onRequestClose={onClose}
      // Android の status bar は透過させて全画面感を出す
      statusBarTranslucent
    >
      {/* 暗背景 — pointerEvents は box-none で内部 gesture 通す */}
      <Animated.View style={[styles.backdrop, backdropAnimStyle]} pointerEvents="box-none">
        <View style={styles.solidBg} pointerEvents="none" />
        {isWeb ? (
          // Web 簡易版: 背景タップ閉じ、画像は contain で表示
          <Pressable
            style={styles.webPress}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="閉じる"
          >
            <View style={styles.webImgWrap} pointerEvents="none">
              <Image
                source={{ uri }}
                contentFit="contain"
                style={{ width: screenW, height: screenH }}
                accessibilityLabel={alt ?? '画像'}
              />
            </View>
          </Pressable>
        ) : (
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={styles.gestureRoot}>
              <Animated.View style={[styles.imgWrap, imgAnimStyle]}>
                <Image
                  source={{ uri }}
                  contentFit="contain"
                  style={{ width: screenW, height: screenH }}
                  // 重い元画像でも fade transition で sharp 切替
                  transition={reduceMotion ? 0 : 180}
                  accessibilityLabel={alt ?? '画像'}
                />
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        )}
        {/* 閉じるボタン — SafeArea を上 + 右に確保。tap area 44pt */}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          style={[
            styles.closeBtn,
            { top: insets.top + 8, right: insets.right + 12 },
          ]}
        >
          <Icon.close size={22} color={C.text} strokeWidth={2.4} />
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  solidBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  gestureRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imgWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  webPress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webImgWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
});

export const ImageLightbox = memo(ImageLightboxInner);
