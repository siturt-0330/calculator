import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRAD } from '@/design/tokens';
import { SHADOW } from '@/design/shadows';
import { TABBAR } from '@/design/tabbar';
import { SPRING_BOUNCY, FAB_SCALE } from '@/design/motion';
import { hap } from '@/design/haptics';
import { Icon } from '@/constants/icons';

const APressable = Animated.createAnimatedComponent(Pressable);

export function FAB({ onPress }: { onPress: () => void }) {
  const scale = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const Plus = Icon.plus;

  return (
    <APressable
      onPressIn={() => {
        scale.value = withSpring(FAB_SCALE, SPRING_BOUNCY);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING_BOUNCY);
      }}
      onPress={() => {
        hap.confirm();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel="投稿を作成"
      style={[
        {
          width: TABBAR.fabSize,
          height: TABBAR.fabSize,
          borderRadius: TABBAR.fabSize / 2,
          marginTop: TABBAR.fabOffset,
          overflow: 'visible',
          ...SHADOW.fab,
        },
        a,
      ]}
    >
      <LinearGradient
        colors={[...GRAD.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: TABBAR.fabSize / 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
        }}
      >
        <Plus size={28} color="#fff" strokeWidth={2.6} />
      </LinearGradient>
    </APressable>
  );
}
