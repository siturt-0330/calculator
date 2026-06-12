import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useEffect } from 'react';
import { PressableScale } from './PressableScale';
import { C } from '../../design/tokens';
import { SPRING_TIGHT } from '../../design/motion';

// __DEV__ での accessibilityLabel 未指定警告を 1 回だけにする module フラグ
// (毎 render / 全 instance で連発させない)
let warnedMissingLabel = false;

/**
 * Toggle — スイッチ型のオン/オフ切り替え。
 *
 * a11y 方針 (App Store Connect の VoiceOver evaluation criteria 準拠):
 * - `accessibilityLabel` には **何を切り替えるかだけ** を書く (例: 「写真を非表示にする」)。
 *   「スイッチ」「ボタン」等の control type 語や「オン」「オフ」等の state 語は **含めない** —
 *   type は `accessibilityRole="switch"`、state は `accessibilityState.checked` が
 *   VoiceOver / TalkBack に自動で読み上げさせるため、含めると二重読みになる。
 * - label 未指定だと VoiceOver は「スイッチ」としか読まない → __DEV__ で警告を出す。
 */
export function Toggle({
  value,
  onChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** スクリーンリーダー向けラベル。「スイッチ」「オン」等の type/state 語は含めない (上記 JSDoc 参照) */
  accessibilityLabel?: string;
}) {
  const x = useSharedValue(value ? 22 : 2);
  useEffect(() => {
    x.value = withSpring(value ? 22 : 2, SPRING_TIGHT);
  }, [value, x]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  // dev 限定: label 未指定の検出 (アプリ全体で 1 回だけ warn)
  useEffect(() => {
    if (__DEV__ && !accessibilityLabel && !warnedMissingLabel) {
      warnedMissingLabel = true;
      console.warn(
        '[Toggle] accessibilityLabel がありません — VoiceOver で「スイッチ」としか読まれません',
      );
    }
  }, [accessibilityLabel]);

  return (
    <PressableScale
      onPress={() => onChange(!value)}
      disabled={disabled}
      haptic="select"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      style={{
        width: 48,
        height: 28,
        borderRadius: 14,
        padding: 2,
        backgroundColor: value ? C.accent : C.bg4,
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' }, a]}
      />
    </PressableScale>
  );
}
