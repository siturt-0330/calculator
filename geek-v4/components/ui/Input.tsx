import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import {
  Platform,
  Pressable,
  View,
  TextInput,
  Text,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  interpolateColor,
} from 'react-native-reanimated';
import { SP, R, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { TIMING_FAST, TIMING_NORM } from '../../design/motion';
import { useColors } from '../../hooks/useColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  /** input の下に出る薄い補助文 (helper text). error がある時は error 側を優先表示 */
  helperText?: string;
  containerStyle?: ViewStyle;
  icon?: LucideIcon | ComponentType<{ size: number; color: string; strokeWidth: number }>;
  right?: React.ReactNode;
  /** 文字数カウンタを表示するか. maxLength と value がある時のみ意味を持つ */
  showCounter?: boolean;
};

// 防御的 default — 個別の TextInput に maxLength を付け忘れても、
// 攻撃者が 10MB の文字列を貼り付けて state 更新で UI freeze + memory 枯渇を
// 起こすのを防ぐ safety net。caller が明示的に maxLength を指定したらそちらを尊重する。
// 200 文字あれば search query / 一般的な単行入力には十分。長文 (本文・コメント等)
// は TextArea を使うか、各 caller で明示的に大きい maxLength を渡すこと。
const DEFAULT_INPUT_MAX_LENGTH = 200;

export const Input = forwardRef<TextInput, Props>(function Input(
  {
    label,
    error,
    helperText,
    containerStyle,
    style,
    icon: IconComp,
    right,
    maxLength,
    showCounter,
    value,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const multiline = rest.multiline === true;
  const effectiveMaxLength = maxLength ?? DEFAULT_INPUT_MAX_LENGTH;
  // テーマ購読 — light で入力欄が white-on-white にならないように
  const C = useColors();
  const reduceMotion = useReducedMotion();
  // エラー状態: 視覚的に明確にする (赤枠) — focused より優先
  const showError = Boolean(error);
  // counter は caller が明示で showCounter=true にした時か、caller-supplied maxLength が
  // ある時のみ出す (DEFAULT 200 を毎回出すと UI ノイズになるため明示優先)
  const counterEnabled = showCounter ?? maxLength != null;
  const valueLen = typeof value === 'string' ? value.length : 0;

  // 内部 TextInput ref — wrapper press で focus() を呼ぶために保持しつつ
  // forwardRef で親にも公開する
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => inputRef.current as TextInput, []);

  // borderColor を Reanimated で滑らかに遷移させる。
  // state は 0 = transparent / 1 = focused (accent) / 2 = error (red)。
  const focusProgress = useSharedValue(0);
  // bg は focused で C.bg3 → C.bg2 へ微かに変化 (奥行きを出す)
  const bgProgress = useSharedValue(0);
  // glow opacity (native shadowOpacity を animate)
  const glowOpacity = useSharedValue(0);
  // error 時の shake (translateX) — reduceMotion なら停止
  const shakeX = useSharedValue(0);

  useEffect(() => {
    const target = showError ? 2 : focused ? 1 : 0;
    const cfg = reduceMotion ? { duration: 0 } : TIMING_FAST;
    focusProgress.value = withTiming(target, cfg);
    // 背景 / glow は focused 時だけ立てる (error 時は赤枠の方が支配的)
    bgProgress.value = withTiming(focused && !showError ? 1 : 0, reduceMotion ? { duration: 0 } : TIMING_NORM);
    glowOpacity.value = withTiming(
      focused && !showError ? 0.3 : 0,
      reduceMotion ? { duration: 0 } : TIMING_NORM,
    );
  }, [focused, showError, focusProgress, bgProgress, glowOpacity, reduceMotion]);

  // error に "切り替わった" 瞬間だけ shake を発火 (error が継続して true の時に
  // 毎 render shake してしまうと焦点が落ち着かないので、立ち上がり edge のみ)
  const prevErrorRef = useRef(showError);
  useEffect(() => {
    if (showError && !prevErrorRef.current && !reduceMotion) {
      // 0 → -6 → 6 → -4 → 4 → 0 over ~320ms (60+60+60+70+70)
      shakeX.value = withSequence(
        withTiming(-6, { duration: 60 }),
        withTiming(6, { duration: 60 }),
        withTiming(-4, { duration: 60 }),
        withTiming(4, { duration: 70 }),
        withTiming(0, { duration: 70 }),
      );
    }
    prevErrorRef.current = showError;
  }, [showError, reduceMotion, shakeX]);

  const aBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1, 2],
      ['rgba(0,0,0,0)', C.accent, C.red],
    ),
    backgroundColor: interpolateColor(bgProgress.value, [0, 1], [C.bg3, C.bg2]),
    // RN-Native は Animated shadowOpacity を受け取れる. Web は別途 boxShadow を使う
    shadowColor: C.accent,
    shadowOpacity: Platform.OS === 'web' ? 0 : glowOpacity.value,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    transform: [{ translateX: shakeX.value }],
  }));

  // wrapper を押した時に内部 TextInput に focus を移す.
  // 既に focus 中なら何もしない (caret position が飛んでしまうのを防ぐ)
  const focusInput = () => {
    if (!focused) inputRef.current?.focus();
  };

  return (
    <View style={[{ gap: SP['1'] }, containerStyle]}>
      {label && <Text style={[T.small, { color: C.text2 }]}>{label}</Text>}
      <Pressable onPress={focusInput} accessible={false}>
        <Animated.View
          style={[
            {
              // multiline 時は固定高さを外して minHeight にする — placeholder が
              // ラベルとぶつかったり content が cut off されないように
              ...(multiline
                ? { minHeight: SIZE.input, paddingVertical: SP['2'] }
                : { height: SIZE.input }),
              borderRadius: R.md,
              borderWidth: 1.5,
              flexDirection: 'row',
              alignItems: multiline ? 'flex-start' : 'center',
              paddingHorizontal: SP['4'],
              gap: SP['2'],
              // native での elevation (Android) — opacity 0 から立ち上がる
              elevation: focused && !showError ? 2 : 0,
            },
            aBorder,
            // Web: focus 時に CSS box-shadow で柔らかい halo を出す.
            // RN-Native は Animated.View に shadow を当てると静的計算しか効かないので web 限定…
            // …だったが、Reanimated の shadowOpacity アニメは native でも追従するので
            // web 側だけ box-shadow を残し、native は aBorder の shadowOpacity に任せる.
            Platform.OS === 'web' && focused && !showError
              ? ({ boxShadow: '0 0 0 4px rgba(124,106,247,0.18)' } as object)
              : null,
          ]}
        >
          {IconComp && (
            <View style={{ marginTop: multiline ? 10 : 0 }}>
              <IconComp size={18} color={C.text3} strokeWidth={2.2} />
            </View>
          )}
          <TextInput
            ref={inputRef}
            value={value}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholderTextColor={C.text3}
            // dark theme で黒系カーソルが見えなくなる事故防止
            // - selectionColor: 選択範囲ハイライト (iOS/Android/Web)
            // - cursorColor: Android 13+ のキャレット色 (selectionColor だけだと薄い)
            selectionColor={C.accent}
            cursorColor={C.accent}
            {...rest}
            // maxLength は rest を展開した *後* に置く — caller が明示的に渡した
            // value を使い、未指定なら defense-in-depth で 200 文字 cap
            maxLength={effectiveMaxLength}
            style={[T.body, { flex: 1, color: C.text }, style]}
          />
          {right}
        </Animated.View>
      </Pressable>
      {/* footer row: error / helperText (左) + counter (右) — 同じ行に置いて
          縦方向のジャンプを抑える */}
      {(error || helperText || (counterEnabled && maxLength != null)) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <View style={{ flex: 1 }}>
            {error ? (
              <Text style={[T.small, { color: C.red }]}>{error}</Text>
            ) : helperText ? (
              <Text style={[T.caption, { color: C.text3 }]}>{helperText}</Text>
            ) : null}
          </View>
          {counterEnabled && maxLength != null && (
            <Text style={[T.caption, { color: valueLen >= maxLength ? C.red : C.text3 }]}>
              {valueLen}/{maxLength}
            </Text>
          )}
        </View>
      )}
    </View>
  );
});
