import { View, Text } from 'react-native';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: SP['4'],
        paddingVertical: SP['2'],
      }}
    >
      <Text style={[T.smallB, { color: C.text3 }]}>{title.toUpperCase()}</Text>
      {right}
    </View>
  );
}
