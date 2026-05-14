import { Easing, WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

export const SPRING_TIGHT: WithSpringConfig = { damping: 18, stiffness: 320, mass: 0.7 };
export const SPRING_BOUNCY: WithSpringConfig = { damping: 10, stiffness: 220, mass: 0.9 };
export const SPRING_GENTLE: WithSpringConfig = { damping: 22, stiffness: 180, mass: 1 };
export const SPRING_SNAP: WithSpringConfig = { damping: 14, stiffness: 400, mass: 0.6 };

export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_OUT_BACK = Easing.bezier(0.34, 1.56, 0.64, 1);

export const TIMING_FAST: WithTimingConfig = { duration: 160, easing: EASE_OUT };
export const TIMING_NORMAL: WithTimingConfig = { duration: 240, easing: EASE_OUT };
export const TIMING_SLOW: WithTimingConfig = { duration: 360, easing: EASE_OUT };

export const PRESS_SCALE = 0.96;
export const PRESS_SCALE_TIGHT = 0.94;
export const FAB_SCALE = 0.92;
export const TAB_INDICATOR = SPRING_TIGHT;
export const HEART_SCALE_KEYFRAMES = [0, 1.3, 1.0, 1.15, 1.0, 0.9, 0] as const;
export const SHIMMER_DURATION = 900;
export const SCREEN_TRANSITION = 280;
export const MODAL_TRANSITION = 320;
export const TOAST_DURATION = 2400;
