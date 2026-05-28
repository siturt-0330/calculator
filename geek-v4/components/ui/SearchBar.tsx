// ============================================================
// SearchBar
// ------------------------------------------------------------
// Apple/iOS-flavored search field with:
//   - focus expansion (subtle padding grow) — withTiming(220, ease-out)
//   - border C.border → C.accent + accent halo on focus (200ms)
//   - Cancel button sliding in from the right (translateX 60 → 0)
//   - clear "X" inside the input, fading in over 150ms when value.length > 0
//   - magnifying-glass color shift (text3 → accent) on focus
//   - Reduce-Motion aware — skips expand + glow when the user opts out
//   - Theme-aware via useColors() (no static `C` import for colors)
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { PressableScale } from './PressableScale';
import { Icon } from '../../constants/icons';
import { R, SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { TIMING_FAST, TIMING_NORM } from '../../design/motion';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

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
  const C = useColors();
  const reduceMotion = useReducedMotion();
  const Search = Icon.search;
  const X = Icon.close;
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // ── animation drivers ────────────────────────────────────
  // focusProgress drives: border color, halo opacity, container
  // padding-expand and the Cancel button slide-in.
  const focusProgress = useSharedValue(0);
  // clearProgress fades the inline "X" inside the input — driven
  // by `value.length > 0` (not focus) so it appears the moment
  // the first character is typed.
  const clearProgress = useSharedValue(0);

  useEffect(() => {
    focusProgress.value = withTiming(focused ? 1 : 0, TIMING_NORM);
  }, [focused, focusProgress]);

  useEffect(() => {
    clearProgress.value = withTiming(value.length > 0 ? 1 : 0, {
      ...TIMING_FAST,
      duration: 150,
    });
  }, [value.length, clearProgress]);

  // ── animated styles ──────────────────────────────────────
  // Container: border color + (motion-OK only) the gentle expand
  // and accent shadow halo. We avoid animating width/height — the
  // expansion is expressed as horizontal padding so the field
  // "breathes" without nudging neighbouring layout.
  const aContainer = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [C.border, C.accent],
    );
    if (reduceMotion) {
      return { borderColor };
    }
    // 16 → 20 px horizontal padding (subtle "expand")
    const paddingHorizontal = SP['4'] + focusProgress.value * 4;
    return {
      borderColor,
      paddingHorizontal,
      // shadow halo — fades 0 → 0.25 with focus
      shadowColor: C.accent,
      shadowOpacity: focusProgress.value * 0.25,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
    };
  });

  // Cancel button: slides in from the right (translateX 60 → 0)
  // and fades in alongside. When unfocused we keep width: 0 so the
  // hidden button doesn't reserve space and squeeze the input.
  const aCancelWrap = useAnimatedStyle(() => {
    const opacity = focusProgress.value;
    // collapse to zero width when fully unfocused so the input
    // can use the full row; the slide is purely visual.
    const visible = focusProgress.value > 0.01;
    return {
      opacity,
      transform: [{ translateX: (1 - focusProgress.value) * 60 }],
      width: visible ? undefined : 0,
      marginLeft: visible ? SP['2'] : 0,
      overflow: 'hidden',
    };
  });

  // Inline clear "X": fade in/out over 150ms.
  const aClearBtn = useAnimatedStyle(() => ({
    opacity: clearProgress.value,
    // collapse layout when fully hidden so it doesn't steal a tap
    // area near the right edge.
    width: clearProgress.value < 0.01 ? 0 : undefined,
  }));

  // ── event handlers ───────────────────────────────────────
  const handleCancel = () => {
    onChangeText('');
    inputRef.current?.blur();
  };
  const handleClearInline = () => {
    onChangeText('');
    // keep focus so the user can keep typing — only the value clears
    inputRef.current?.focus();
  };

  // ── icon color (instant flip; respects ReduceMotion implicitly) ─
  // lucide-react-native doesn't expose an animatable `color` prop, so
  // we drive it from React state. The change is instantaneous, which
  // is acceptable per the spec ("color shift on focus" — no timing).
  const iconColor = focused ? C.accent : C.text3;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Animated.View
        style={[
          {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['2'],
            height: SIZE.input,
            paddingHorizontal: SP['4'],
            borderRadius: R.full,
            backgroundColor: C.bg3,
            borderWidth: 1.5,
            borderColor: C.border,
          },
          aContainer,
          // Web: render the halo as a box-shadow ring so it shows up
          // outside the container (RN `shadow*` props don't paint on web
          // for non-iOS shadow stacks).
          Platform.OS === 'web' && focused && !reduceMotion
            ? ({ boxShadow: '0 0 0 4px rgba(124,106,247,0.18)' } as object)
            : null,
        ]}
      >
        <Search size={18} color={iconColor} strokeWidth={2.2} />
        <TextInput
          ref={inputRef}
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
        {/* Inline clear "X" — visible only when there is text. */}
        <Animated.View style={aClearBtn}>
          {value.length > 0 ? (
            <PressableScale
              onPress={handleClearInline}
              haptic="tap"
              accessibilityLabel="入力をクリア"
            >
              <X size={18} color={C.text3} strokeWidth={2.2} />
            </PressableScale>
          ) : null}
        </Animated.View>
      </Animated.View>

      {/*
        Cancel button — slides in from the right when the field is focused.
        Tap clears + blurs (canonical iOS pattern). Kept outside the bar's
        rounded container so the slide-in reads as a separate affordance.
      */}
      <Animated.View style={aCancelWrap}>
        <PressableScale
          onPress={handleCancel}
          haptic="tap"
          accessibilityLabel="検索をキャンセル"
        >
          <View style={{ paddingHorizontal: SP['2'], paddingVertical: SP['1'] }}>
            <Animated.Text style={[T.bodyM, { color: C.accent }]}>
              キャンセル
            </Animated.Text>
          </View>
        </PressableScale>
      </Animated.View>

      {/*
        ─ Future extension ─
        If callers need a horizontal recent-searches row beneath the bar,
        accept a `recentSearches: string[]` (+ onPickRecent) prop and render
        chips here using PressableScale + { backgroundColor: C.bg2,
        ...T.smallM, color: C.text2 }. Today consumers use the dedicated
        <SearchHistoryChips /> component (components/search/SearchHistoryChips.tsx)
        for that, so this bar stays focused on the input affordance.

        Similarly, if a separator divider sits below this bar (e.g. above a
        suggestions list), animate its `height` from 0 → 1 on focus with the
        same `focusProgress` shared value — exporting a helper would be the
        cleanest path; for now consumers can drive their own divider.
      */}
    </View>
  );
}
