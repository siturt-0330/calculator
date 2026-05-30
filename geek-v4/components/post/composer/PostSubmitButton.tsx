// ============================================================
// PostSubmitButton — composer の主役 CTA (X の「ポストする」相当)
// ------------------------------------------------------------
// composer ヘッダー右上に置く、角丸グラデーションの primary ボタン。
// 「premium で tactile」な押し心地を狙い:
//   - LinearGradient (accent → accentDeep) を絶対配置の塗りに
//   - 有効時は SHADOW.accentGlow で紫 glow を纏わせる
//   - press 中は SPRING_SNAPPY で 0.94 に縮む micro-interaction
//   - loading 中は白 ActivityIndicator + loadingLabel を表示
// 純 presentational。状態管理 (loading/disabled) は呼び出し側の責務。
// ============================================================

import { ActivityIndicator, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../../../hooks/useColors';
import { SP, R, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { SPRING_SNAPPY } from '../../../design/motion';
import { PressableScale } from '../../ui/PressableScale';

export interface PostSubmitButtonProps {
  label?: string; // default '投稿'
  loadingLabel?: string; // default '送信中…'
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}

export function PostSubmitButton({
  label = '投稿',
  loadingLabel = '送信中…',
  loading,
  disabled,
  onPress,
}: PostSubmitButtonProps) {
  const C = useColors();

  // disabled / loading のどちらでも押下を無効化する。
  const inactive = disabled || loading;

  // press micro-interaction — PressableScale 内蔵の scale ではなく
  // 自前の sharedValue を Animated.View で wrap し、外側の glow ごと縮める。
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = () => {
    if (inactive) return;
    scale.value = withSpring(0.94, SPRING_SNAPPY);
  };
  const handlePressOut = () => {
    if (inactive) return;
    scale.value = withSpring(1, SPRING_SNAPPY);
  };

  return (
    <Animated.View style={[animStyle, !inactive ? SHADOW.accentGlow : null]}>
      <PressableScale
        onPress={inactive ? undefined : onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={inactive}
        haptic="confirm"
        accessibilityLabel="投稿する"
        accessibilityState={{ disabled: inactive }}
        // 内蔵 scale は無効化 (1) — 自前 Animated.View で wrap 済みなので二重縮小を防ぐ
        scaleValue={1}
        style={{
          height: 36,
          minWidth: 76,
          borderRadius: R.full,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inactive ? 0.45 : 1,
        }}
      >
        {/* グラデーション塗り (背景) — 角丸は親の overflow:hidden でクリップ */}
        <LinearGradient
          colors={[C.accent, C.accentDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['1'],
            paddingHorizontal: SP['4'],
          }}
        >
          {loading ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text
            style={[
              T.buttonMd,
              { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
            ]}
          >
            {loading ? loadingLabel : label}
          </Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
}
