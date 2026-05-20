import { Stack } from 'expo-router';
import { C } from '../../design/tokens';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="language" />
      <Stack.Screen name="nickname" />
      <Stack.Screen name="liked-tags" />
      <Stack.Screen name="blocked-tags" />
      <Stack.Screen name="notifications" />
    </Stack>
  );
}
