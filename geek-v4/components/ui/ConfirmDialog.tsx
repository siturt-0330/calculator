import { View, Text, Modal, Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from './Button';
import { SHADOW } from '@/design/shadows';

// Polished confirm dialog:
// - Backdrop fades in 200ms / out 160ms; tapping it dismisses (calls onCancel)
// - Dialog box scales 0.96 -> 1.0 + fade in (ZoomIn 220ms) on enter
// - Title (h3, C.text) + body (body, C.text2, lineHeight 22) with clear hierarchy
// - Confirm button is `danger` (red) when destructive, otherwise `primary` (accent);
//   cancel is ghost (neutral)
// API kept fully backward-compatible.
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
          <View style={{ gap: SP['2'], marginTop: SP['1'] }}>
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
              size="lg"
              fullWidth
              haptic={destructive ? 'warn' : 'confirm'}
            />
            <Button
              label={cancelLabel}
              onPress={onCancel}
              variant="ghost"
              size="lg"
              fullWidth
              haptic="tap"
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
