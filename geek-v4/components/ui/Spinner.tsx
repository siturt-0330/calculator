import { useEffect } from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { C, SP } from '../../design/tokens';
import { FONT, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';

export function Spinner({ size = 'small', full }: { size?: 'small' | 'large'; full?: boolean }) {
  if (full) {
    return <FullScreenSpinner />;
  }
  return <ActivityIndicator size={size} color={C.accent} />;
}

// Full-screen "loading" state — replaces the bare ActivityIndicator with a
// subtle pulsing "Geek" logo so the wait feels intentional, not stalled.
function FullScreenSpinner() {
  const pulse = useSharedValue(0.6);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);
  const aPulse = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: SP['3'],
        backgroundColor: C.bg,
      }}
    >
      <Animated.Text
        style={[
          {
            fontFamily: LOGO_FONT,
            fontWeight: LOGO_FONT_WEIGHT,
            fontSize: 36,
            letterSpacing: -1,
            color: C.text,
          },
          aPulse,
        ]}
      >
        Geek
      </Animated.Text>
      <Text
        style={{
          fontFamily: FONT.jp,
          fontSize: 12,
          color: C.text3,
          letterSpacing: 0.5,
        }}
      >
        ちょっと待ってね…
      </Text>
    </View>
  );
}
