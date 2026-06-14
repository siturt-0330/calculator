// ============================================================
// CommentSendButton — LINE 風コメントバーの送信ボタン (ミニマル上品演出)
// ------------------------------------------------------------
// 役割: コメント/返信の送信ボタン。投稿詳細のインラインバーと全画面コメント
//       画面の両方で共有する。
//
// 演出 (ユーザー要望「おしゃれで美しく・ミニマル上品」2026-06-14):
//   - 押下時      : 淡い accent の波紋リングが外へ広がって消える (押した実感)。
//                   円の squeeze は PressableScale が担当。
//   - 送信成功時  : Send アイコンが Check にふわっと morph → 少し置いて Send に戻る。
//                   同時にもう一度波紋を出して「送れた」を上品に確定。
//                   成功は親が successTick を ++ して通知する (失敗時は出さない)。
//   - 送信中      : ActivityIndicator。
//
// すべて Reanimated worklet で UI スレッド実行 (60fps 死守)。reduceMotion 下でも
// 破綻しない (timing/spring は RM で短縮されるだけで論理は同じ)。
// ============================================================

import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { Send, Check } from 'lucide-react-native';

import { PressableScale } from '../ui/PressableScale';
import { useColors } from '../../hooks/useColors';

type Props = {
  /** 送信可能か (本文/メディアあり & 未送信)。false 時は無効見た目だが onPress は呼ぶ
   *  (親が「押せない理由」を toast で出すため — disabled だと無反応に見える)。 */
  canPost: boolean;
  /** 送信中 (アップロード/保存) — spinner を出す。 */
  posting: boolean;
  onPress: () => void;
  /** 親が「送信成功」した瞬間に ++ する。変化を検知して Check morph + 波紋を再生。 */
  successTick?: number;
  /** ボタン径 (default 40)。 */
  size?: number;
};

export function CommentSendButton({
  canPost,
  posting,
  onPress,
  successTick = 0,
  size = 40,
}: Props) {
  const C = useColors();

  // 波紋 (0→1 で scale 0.7→2.3 / opacity 0.4→0)
  const ripple = useSharedValue(0);
  // Send⇄Check morph (0=Send / 1=Check)
  const check = useSharedValue(0);

  const playRipple = () => {
    ripple.value = 0;
    ripple.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
  };

  // 送信成功 → Check に morph → 650ms 保持 → Send に戻す。波紋も同時に。
  useEffect(() => {
    if (successTick <= 0) return;
    check.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
      withDelay(650, withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) })),
    );
    playRipple();
    // successTick の変化のみで再生 (check/ripple は worklet 値で deps 不要)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successTick]);

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ripple.value, [0, 0.06, 1], [0, 0.4, 0]),
    transform: [{ scale: interpolate(ripple.value, [0, 1], [0.7, 2.3]) }],
  }));
  const sendStyle = useAnimatedStyle(() => ({
    opacity: 1 - check.value,
    transform: [{ scale: 1 - check.value * 0.35 }],
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: 0.55 + check.value * 0.45 }],
  }));

  const handlePress = () => {
    if (canPost) playRipple(); // 有効時だけ押下の波紋 (無効は静かに)
    onPress();
  };

  const iconColor = canPost ? '#fff' : C.text3;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* 波紋リング — ボタンの後ろから外へ広がって消える (accent の淡いハロー) */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: C.accent,
          },
          rippleStyle,
        ]}
      />
      <PressableScale
        onPress={handlePress}
        haptic={canPost ? 'tap' : undefined}
        scaleValue={0.86}
        accessibilityRole="button"
        accessibilityLabel="送信"
        accessibilityState={{ disabled: !canPost }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: canPost ? C.accent : C.bg3,
          opacity: canPost ? 1 : 0.6,
        }}
      >
        {posting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
            {/* Send / Check を重ねて cross-fade + scale で morph */}
            <Animated.View style={[{ position: 'absolute' }, sendStyle]}>
              <Send size={18} color={iconColor} strokeWidth={2.2} />
            </Animated.View>
            <Animated.View style={[{ position: 'absolute' }, checkStyle]}>
              <Check size={19} color="#fff" strokeWidth={2.6} />
            </Animated.View>
          </View>
        )}
      </PressableScale>
    </View>
  );
}
