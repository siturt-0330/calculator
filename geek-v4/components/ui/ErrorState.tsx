import { View, Text } from 'react-native';
import { Icon } from '../../constants/icons';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from './Button';

export function ErrorState({
  title = 'うまく読み込めませんでした',
  message = '通信状況をご確認のうえ、もう一度お試しください',
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  const Warn = Icon.warn;
  return (
    <View style={{ padding: SP['10'], alignItems: 'center', gap: SP['3'] }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: C.redBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Warn size={28} color={C.red} strokeWidth={2.2} />
      </View>
      <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>{title}</Text>
      <Text style={[T.body, { color: C.text2, textAlign: 'center', maxWidth: 280 }]}>{message}</Text>
      {onRetry && (
        <View style={{ marginTop: SP['3'] }}>
          <Button label="再試行" onPress={onRetry} variant="secondary" fullWidth={false} />
        </View>
      )}
    </View>
  );
}
