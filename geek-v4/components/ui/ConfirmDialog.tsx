import { View, Text, Modal } from 'react-native';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from './Button';
import { SHADOW } from '@/design/shadows';

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
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          alignItems: 'center',
          justifyContent: 'center',
          padding: SP['6'],
        }}
      >
        <View
          style={{
            width: '100%',
            backgroundColor: C.bg2,
            borderRadius: R.xl,
            padding: SP['6'],
            gap: SP['4'],
            ...SHADOW.card,
          }}
        >
          <Text style={[T.h3, { color: C.text }]}>{title}</Text>
          {message && <Text style={[T.body, { color: C.text2 }]}>{message}</Text>}
          <View style={{ gap: SP['2'] }}>
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
            />
            <Button label={cancelLabel} onPress={onCancel} variant="ghost" />
          </View>
        </View>
      </View>
    </Modal>
  );
}
