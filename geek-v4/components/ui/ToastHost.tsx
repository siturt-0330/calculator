// ============================================================
// ToastHost — Apple 風 spring 出現 / scale-fade 消滅 / stack 表示 / swipe-to-dismiss
// ------------------------------------------------------------
// 設計 (2026-05 polish):
//   - enter:  opacity 0 + translateY 16 → opacity 1 + translateY 0
//             spring(damping 18, stiffness 240) ≒ Apple Notification の落下感
//   - exit:   opacity 1 → opacity 0 + scale 0.96 (200ms ease-in)
//   - stack:  複数 toast は通常の flex column で自然に積まれる
//             (1 つ前の toast が消えると後続が spring で上に詰める — gap で間隔確保)
//   - swipe:  PanGesture で水平方向に振り切ると dismiss
//             (|x| > 80 で確定、それ未満は spring で戻す。途中は opacity を減衰)
//   - variant: success / error / warn / info の 4 種で BG / FG / Icon を切替
//   - reduceMotion: 設定 ON 時は spring 抑制 → opacity フェードのみ
//   - web:    maxWidth 480 + 中央寄せ (タブレット / desktop で横長になり過ぎないように)
// ============================================================

import { useEffect, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../constants/icons';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors, useShadows } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useToastStore, type Toast as ToastType, type ToastVariant } from '../../stores/toastStore';
import { PressableScale } from './PressableScale';

// Apple 風 spring (指示通り damping 18 / stiffness 240)
const TOAST_SPRING = { damping: 18, stiffness: 240, mass: 0.7 } as const;
// swipe dismiss しきい値
const SWIPE_THRESHOLD = 80;

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + SP['2'],
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 9999,
      }}
    >
      {/* maxWidth 480 + 中央寄せ (web で横長にしない) */}
      <View
        pointerEvents="box-none"
        style={{
          width: '100%',
          maxWidth: 480,
          paddingHorizontal: SP['4'],
          gap: SP['2'],
        }}
      >
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
      </View>
    </View>
  );
}

// ============================================================
// variant 別の見た目マップ
// ============================================================
type VariantStyle = {
  bg: string;
  fg: string;
  border: string;
  icon: typeof Icon.info;
};

function useVariantStyles(): Record<ToastVariant, VariantStyle> {
  const C = useColors();
  return useMemo(
    () => ({
      info: {
        bg: C.bg3,
        fg: C.text,
        border: C.border,
        icon: Icon.info,
      },
      success: {
        bg: C.greenBg,
        fg: C.green,
        border: C.green + '55',
        icon: Icon.check,
      },
      warn: {
        bg: C.amberBg,
        fg: C.amber,
        border: C.amber + '55',
        icon: Icon.warn,
      },
      error: {
        bg: C.redBg,
        fg: C.red,
        border: C.red + '55',
        icon: Icon.warn,
      },
    }),
    [C],
  );
}

// ============================================================
// ToastItem (inline) — spring enter / scale-fade exit / swipe dismiss
// ============================================================
function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastType;
  onDismiss: () => void;
}) {
  const C = useColors();
  const SHADOW = useShadows();
  const reduceMotion = useReducedMotion();
  const variantStyles = useVariantStyles();
  const v = variantStyles[toast.variant];
  const IconComp = v.icon;

  // shared values
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reduceMotion ? 0 : 16);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);

  // 入場: マウント時に spring で 0→1
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = withTiming(1, { duration: 160 });
      translateY.value = 0;
    } else {
      opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
      translateY.value = withSpring(0, TOAST_SPRING);
    }
    // cleanup: マウント解除時に in-flight animation を停止
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(translateY);
      cancelAnimation(translateX);
      cancelAnimation(scale);
    };
    // intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 退場 (タップ / undo タップから呼ばれる) — 自動 dismiss は store 側の setTimeout から unmount → 入場側 cleanup
  const animateOutAndDismiss = () => {
    if (reduceMotion) {
      opacity.value = withTiming(0, { duration: 120 }, (fin) => {
        if (fin) runOnJS(onDismiss)();
      });
      return;
    }
    scale.value = withTiming(0.96, { duration: 200, easing: Easing.in(Easing.cubic) });
    opacity.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (fin) => {
      if (fin) runOnJS(onDismiss)();
    });
  };

  // swipe: 横にスワイプで dismiss
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .onUpdate((e) => {
          translateX.value = e.translationX;
          // 端に行くほど opacity を落とす (視覚 feedback)
          const absX = Math.abs(e.translationX);
          opacity.value = Math.max(0.3, 1 - absX / 240);
        })
        .onEnd((e) => {
          const absX = Math.abs(e.translationX);
          if (absX > SWIPE_THRESHOLD) {
            // 振り切った: 飛ばして dismiss
            const dir = e.translationX > 0 ? 1 : -1;
            translateX.value = withTiming(dir * 400, { duration: 180, easing: Easing.in(Easing.cubic) });
            opacity.value = withTiming(0, { duration: 180 }, (fin) => {
              if (fin) runOnJS(onDismiss)();
            });
          } else {
            // しきい値未満: 元に戻す
            translateX.value = withSpring(0, TOAST_SPRING);
            opacity.value = withTiming(1, { duration: 160 });
          }
        }),
    // dismiss は closure capture で OK (再生成は不要)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 入場 translateY + swipe translateX + 退場 scale を 1 つの animated style に合成
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[
          {
            borderRadius: R.full,
            backgroundColor: v.bg,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: SP['4'],
            paddingVertical: SP['3'],
            gap: SP['3'],
            borderWidth: 1,
            borderColor: v.border,
            ...(SHADOW.cardPress as object),
          },
          animatedStyle,
        ]}
      >
        <IconComp size={18} color={v.fg} strokeWidth={2.2} />
        <Pressable
          onPress={animateOutAndDismiss}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}
        >
          <Text style={[T.bodyM, { flex: 1, color: v.fg }]}>{toast.message}</Text>
        </Pressable>
        {toast.undoLabel && toast.onUndo ? (
          <PressableScale
            onPress={() => {
              toast.onUndo?.();
              animateOutAndDismiss();
            }}
            haptic="tap"
          >
            <Text style={[T.smallM, { color: C.accent }]}>{toast.undoLabel}</Text>
          </PressableScale>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}
