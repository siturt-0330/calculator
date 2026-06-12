import { View, Text, Modal, Pressable, Platform, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { hapticPresets } from '../../lib/haptics';

// Polished confirm dialog (iOS アラート風):
// - Backdrop fades in 200ms / out 160ms; tapping it dismisses (calls onCancel)
// - Dialog box scales 0.96 -> 1.0 + fade in (ZoomIn 220ms) on enter
// - Title (h3, C.text) + body (body, C.text2, lineHeight 22) with clear hierarchy
// - ボタンは iOS HIG に倣い 2 つの時だけ横並び (cancel 左 / confirm 右)。
//   3 つ以上に拡張する場合は縦並びへフォールバックする (現 API は常に 2)。
// - confirm は太字 + accent、destructive 時は fontWeight '700' + C.red
// API kept fully backward-compatible.

// ボタン高さは 44pt 以上を維持 (HIG タップターゲット)
const ACTION_MIN_HEIGHT = 48;
// Button.tsx の CTA radius (12) と揃える
const ACTION_RADIUS = 12;

// delayPressIn は PressableProps の型に無いが実装はサポート (OS 既定 ~130ms 遅延を排除)
const PRESSABLE_TUNING = { delayPressIn: 0 } as Record<string, unknown>;

// Web のみ cursor: pointer (タップ可能の明示)
const WEB_CURSOR =
  Platform.OS === 'web' ? ({ cursor: 'pointer' } as unknown as ViewStyle) : null;

type DialogAction = {
  key: string;
  label: string;
  onPress: () => void;
  weight: '600' | '700';
  color: string;
  haptic: keyof typeof hapticPresets;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = '確認',
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
  destructive,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}) {
  // cancel 左 / confirm 右 (iOS の作法: 破壊的でない「逃げ道」が先)
  const actions: DialogAction[] = [
    { key: 'cancel', label: cancelLabel, onPress: onCancel, weight: '600', color: C.text, haptic: 'light' },
    {
      key: 'confirm',
      label: confirmLabel,
      onPress: onConfirm,
      weight: '700',
      color: destructive ? C.red : C.accent,
      haptic: destructive ? 'warning' : 'medium',
    },
  ];
  // 2 ボタン時のみ横並び。3 つ以上は縦並びフォールバック
  const horizontal = actions.length === 2;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onCancel}>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(160)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          alignItems: 'center',
          justifyContent: 'center',
          padding: SP['6'],
        }}
      >
        {/* Tap-to-dismiss backdrop. Sits behind the dialog content. */}
        <Pressable
          onPress={onCancel}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <Animated.View
          entering={ZoomIn.duration(220)}
          exiting={ZoomOut.duration(160)}
          style={{
            width: '100%',
            maxWidth: 420,
            backgroundColor: C.bg2,
            borderRadius: R.xl,
            padding: SP['6'],
            gap: SP['4'],
            borderWidth: 1,
            borderColor: C.border,
            ...SHADOW.card,
          }}
        >
          <Text style={[T.h3, { color: C.text, fontWeight: '700' }]}>{title}</Text>
          {message && (
            <Text style={[T.body, { color: C.text2, lineHeight: 22 }]}>{message}</Text>
          )}
          <View
            style={{
              flexDirection: horizontal ? 'row' : 'column',
              gap: SP['3'],
              marginTop: SP['1'],
            }}
          >
            {actions.map((a) => (
              <Pressable
                key={a.key}
                {...PRESSABLE_TUNING}
                onPress={a.onPress}
                onPressIn={() => hapticPresets[a.haptic]()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={({ pressed }) => [
                  {
                    flex: horizontal ? 1 : undefined,
                    minHeight: ACTION_MIN_HEIGHT,
                    borderRadius: ACTION_RADIUS,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: SP['3'],
                    backgroundColor: pressed ? C.bg4 : C.bg3,
                  },
                  WEB_CURSOR,
                ]}
              >
                <Text
                  style={{ fontSize: 16, fontWeight: a.weight, color: a.color, letterSpacing: 0.2 }}
                  numberOfLines={1}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
