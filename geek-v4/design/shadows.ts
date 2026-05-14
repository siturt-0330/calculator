import { Platform, ViewStyle } from 'react-native';
import { C } from './tokens';

export const SHADOW: Record<string, ViewStyle> = {
  none: { shadowOpacity: 0, elevation: 0 },
  card: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 6 },
    default: {},
  })!,
  fab: Platform.select({
    ios: { shadowColor: C.accent, shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
    android: { elevation: 12 },
    default: {},
  })!,
  press: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
    android: { elevation: 2 },
    default: {},
  })!,
  pill: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.30, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 4 },
    default: {},
  })!,
};
