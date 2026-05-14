import { View, TextInput } from 'react-native';
import { PressableScale } from './PressableScale';
import { Icon } from '@/constants/icons';
import { C, R, SP, SIZE } from '@/design/tokens';
import { T } from '@/design/typography';

export function SearchBar({
  value,
  onChangeText,
  placeholder = '検索',
  onSubmit,
  autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const Search = Icon.search;
  const X = Icon.close;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        height: SIZE.input,
        paddingHorizontal: SP['4'],
        borderRadius: R.full,
        backgroundColor: C.bg3,
      }}
    >
      <Search size={18} color={C.text3} strokeWidth={2.2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.text3}
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        style={[T.body, { flex: 1, color: C.text }]}
      />
      {value.length > 0 && (
        <PressableScale onPress={() => onChangeText('')} haptic="tap">
          <X size={18} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
      )}
    </View>
  );
}
