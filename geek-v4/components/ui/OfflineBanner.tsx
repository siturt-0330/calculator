// ============================================================
// OfflineBanner — 圏外・圏内復帰の最上部 banner
// ============================================================
// 仕様 (Geek UI 統一):
//   - 圏外時:
//       background: C.amber + '22' (薄 amber)
//       border-bottom: C.amber + '44' 1px
//       左 icon: AlertTriangle / WifiOff 16px (color: C.amber)
//       text (T.smallM, color: C.text): "オフラインです — 一部機能が制限されます"
//       右 chip (queue 件数 > 0 のとき): "N 件送信待ち"
//   - 圏内復帰時: 5 秒間 "オンラインに復帰しました" (green tint) を出して fade out
//   - padding: SP['2'] SP['3']
//   - 動作: Reanimated で slide-down enter / slide-up exit (300ms)
//   - shadow: SHADOW.sm
//   - radius: R.lg (角丸 = chip)
//
// a11y:
//   - accessibilityRole="alert", accessibilityLiveRegion="polite"
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { WifiOff, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { C, SP, R, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';

const ENTER_MS = 300;
const RESTORE_HOLD_MS = 5000;

export function OfflineBanner() {
  const { online, pending } = useOfflineQueue();

  // 「直近に offline だった」フラグ — online→true 遷移時に 5 秒の復帰 toast を出す
  const wasOfflineRef = useRef(false);
  const [showRestore, setShowRestore] = useState(false);

  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      setShowRestore(false);
      return;
    }
    // online === true
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setShowRestore(true);
      const t = setTimeout(() => setShowRestore(false), RESTORE_HOLD_MS);
      return () => clearTimeout(t);
    }
    return;
  }, [online]);

  const visible = !online || showRestore;

  // slide-down / slide-up — translateY を -56 → 0 で animate
  const translateY = useSharedValue(visible ? 0 : -56);
  const opacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    translateY.value = withTiming(visible ? 0 : -56, {
      duration: ENTER_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: ENTER_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // unmount するための gate (slide-up 完了後)
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    // 退場アニメ完了を待ってから unmount
    const t = setTimeout(() => setMounted(false), ENTER_MS + 20);
    return () => clearTimeout(t);
  }, [visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));
  // runOnJS は使わないが (re-render は state ベース)、import 抑制
  void runOnJS;

  if (!mounted) return null;

  const isRestore = online && showRestore;
  const labelText = isRestore
    ? 'オンラインに復帰しました'
    : 'オフラインです — 一部機能が制限されます';
  const a11yLabel = isRestore
    ? 'オンラインに復帰しました。保留中のアクションを送信します。'
    : 'オフラインです。キャッシュを表示中。投稿は復帰時に同期されます。';

  // 色: 圏外 = amber 系、復帰 = green 系
  const bg = isRestore ? C.green + '22' : C.amber + '22';
  const borderColor = isRestore ? C.green + '44' : C.amber + '44';
  const iconColor = isRestore ? C.green : C.amber;
  const IconCmp = isRestore ? CheckCircle2 : WifiOff;

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={a11yLabel}
      style={[
        {
          paddingVertical: SP['2'],
          paddingHorizontal: SP['3'],
          backgroundColor: bg,
          borderBottomWidth: 1,
          borderBottomColor: borderColor,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          // Web では fixed top にしたいが、既存 layout の都合上「Stack の上に
          // 普通に置く」運用なので、ここでは relative + shadow のみ。
          ...(Platform.OS === 'web' ? { width: '100%' as const } : {}),
        },
        SHADOW.sm,
        animatedStyle,
      ]}
    >
      <IconCmp size={16} color={iconColor} accessibilityElementsHidden />
      <Text style={[T.smallM, { color: C.text, flex: 1 }]} numberOfLines={1}>
        {labelText}
      </Text>
      {!isRestore && pending > 0 ? (
        <View
          style={{
            paddingHorizontal: SP['2'],
            paddingVertical: 2,
            borderRadius: R.lg,
            backgroundColor: C.amber + '33',
            borderWidth: 1,
            borderColor: C.amber + '55',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <AlertTriangle size={12} color={C.amber} accessibilityElementsHidden />
          <Text style={[T.caption, { color: C.text2 }]}>
            {pending} 件送信待ち
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
