import { useEffect, useState } from 'react';
import { Platform, TextInput } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { PressableScale } from './PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { TIMING_FAST } from '../../design/motion';

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
  const [focused, setFocused] = useState(false);

  // Smooth border-color transition on focus (transparent → accent).
  const focusProgress = useSharedValue(0);
  useEffect(() => {
    focusProgress.value = withTiming(focused ? 1 : 0, TIMING_FAST);
  }, [focused, focusProgress]);
  const aBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      ['rgba(0,0,0,0)', C.accent],
    ),
  }));

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          height: SIZE.input,
          paddingHorizontal: SP['4'],
          borderRadius: R.full,
          backgroundColor: C.bg3,
          borderWidth: 1.5,
        },
        aBorder,
        // Web: focus 中はうっすら accent halo を出して「アクティブ」を強調
        Platform.OS === 'web' && focused
          ? // RN-web は box-shadow を直接通す
            ({ boxShadow: '0 0 0 4px rgba(124,106,247,0.18)' } as object)
          : null,
      ]}
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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // memory DoS 対策: 検索クエリは 200 文字 cap
        maxLength={200}
        style={[T.body, { flex: 1, color: C.text }]}
      />
      {value.length > 0 && (
        <PressableScale onPress={() => onChangeText('')} haptic="tap">
          <X size={18} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
      )}
    </Animated.View>
  );
}
