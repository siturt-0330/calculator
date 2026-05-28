import { forwardRef, useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import BottomSheetLib, {
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetHandleProps,
} from '@gorhom/bottom-sheet';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING_SOFT } from '../../design/motion';
import { hap } from '../../design/haptics';

type Props = {
  snapPoints?: (string | number)[];
  children: React.ReactNode;
};

// ============================================================
// BottomSheet — polished wrapper around @gorhom/bottom-sheet
// ------------------------------------------------------------
// UX polish:
//   - Backdrop: solid C.bg fade 0 → 0.65 (200ms ease-out, lib-driven)
//   - Spring entry/close: SPRING_SOFT (ios-native snap)
//   - Handle indicator: 36×4 pill, C.text3, subtle marginTop
//   - Drag haptic: hap.select() when user touches the handle
//   - Content fade-in: opacity 0 → 1 over 180ms after snap settles
//   - ReduceMotion: replace spring with withTiming(150), skip fade
// ============================================================
export const BottomSheet = forwardRef<BottomSheetLib, Props>(
  ({ snapPoints = ['50%', '90%'], children }, ref) => {
    const C = useColors();
    const reduceMotion = useReducedMotion();

    // ---- Backdrop: fade tap-to-dismiss layer ------------------------------
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.65}
          pressBehavior="close"
          style={[props.style, { backgroundColor: C.bg }]}
        />
      ),
      [C.bg],
    );

    // ---- Custom handle: subtle pill + haptic on grab ----------------------
    const renderHandle = useCallback(
      (_props: BottomSheetHandleProps) => (
        <Pressable
          onPressIn={() => hap.select()}
          // Pressable acts as a touch-capture for the handle area.
          // Sheet's internal pan gesture still handles the drag itself.
          style={{
            alignItems: 'center',
            paddingTop: 8,
            paddingBottom: 8,
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: C.text3,
            }}
          />
        </Pressable>
      ),
      [C.text3],
    );

    // ---- Content fade-in once the sheet settles ---------------------------
    const contentOpacity = useSharedValue(reduceMotion ? 1 : 0);

    const onChange = useCallback(
      (index: number) => {
        if (reduceMotion) {
          contentOpacity.value = index >= 0 ? 1 : 1;
          return;
        }
        if (index >= 0) {
          // Sheet snapped open → fade contents in (avoids mid-anim flicker)
          contentOpacity.value = withTiming(1, {
            duration: 180,
            easing: Easing.out(Easing.quad),
          });
        } else {
          // Reset for next open
          contentOpacity.value = 0;
        }
      },
      [contentOpacity, reduceMotion],
    );

    const contentStyle = useAnimatedStyle(() => ({
      opacity: contentOpacity.value,
    }));

    // Always reset on mount in case of remount mid-flow.
    useEffect(() => {
      if (reduceMotion) contentOpacity.value = 1;
    }, [reduceMotion, contentOpacity]);

    // ---- Animation config: spring open/close (or timing if reduceMotion) --
    const animationConfigs = reduceMotion
      ? { duration: 150, easing: Easing.out(Easing.quad) }
      : SPRING_SOFT;

    return (
      <BottomSheetLib
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        handleComponent={renderHandle}
        animationConfigs={animationConfigs}
        onChange={onChange}
        backgroundStyle={{ backgroundColor: C.bg2 }}
      >
        <BottomSheetView style={StyleSheet.absoluteFillObject}>
          <Animated.View style={[StyleSheet.absoluteFillObject, contentStyle]}>
            {children}
          </Animated.View>
        </BottomSheetView>
      </BottomSheetLib>
    );
  },
);

BottomSheet.displayName = 'BottomSheet';
