// ============================================================
// PostComposerSheet — 投稿本文の独立 composer (Threads / X 風)
// ------------------------------------------------------------
// 役割: 投稿画面の "本文入力エリア" を component 化して、create.tsx を
// 肥大化させずに体験チューニングをここに集中させる。
//
// 設計:
//   - controlled component (value/onChange) — 親が state を保持する
//   - auto-grow: TextInput の onContentSizeChange で実測高さを保持し、
//     minHeight ↔ AUTO_GROW_MAX_HEIGHT の範囲で滑らかに拡張
//   - focus 時に border (1pt accent) を Reanimated で fade in (200ms)
//   - 「AI 提案」chip は onAiSuggestPress が渡されたときだけ render
//   - 文字数カウンタは右下に subtle 表示。80% で warning, 100% で red.
//   - 上限到達時は TextInput の maxLength で hard cap を効かせる
//     (要件: "上限到達で disabled だが入力は許可" → maxLength で物理的に
//      入力を止め、エラー描画はせず onChange 側に委譲)
//   - 内部 state は "focused" "contentHeight" のみ。それ以外は controlled.
//   - dark + light theme 対応 (useColors).
// ============================================================

import { useCallback, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  Text,
  Platform,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import { Icon } from '../../constants/icons';
import { useColors } from '../../hooks/useColors';
import { T } from '../../design/typography';
import { SP, R } from '../../design/tokens';
import { hapticPresets } from '../../lib/haptics';

// auto-grow の上限。これを超えたら TextInput 自身が内部スクロールする。
// 仕様の "minHeight ~ 480" を採用。
const AUTO_GROW_MAX_HEIGHT = 480;

// 文字数カウンタの色しきい値 (上限の何 % で警告色に切替えるか)
const WARN_THRESHOLD = 0.8;

export type PostComposerSheetProps = {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  /** 入力エリアの最小高さ。default 200 */
  minHeight?: number;
  /** 文字数上限 (hard cap)。default 2000 */
  maxLength?: number;
  /** 文字数カウンタを表示するか。default true */
  showCharCount?: boolean;
  /** mount 時に自動 focus。default false */
  autoFocus?: boolean;
  /** AI でキャプション提案 chip の handler。未指定なら chip 非表示 */
  onAiSuggestPress?: () => void;
};

export function PostComposerSheet({
  value,
  onChange,
  placeholder = 'いま何してる?',
  minHeight = 200,
  maxLength = 2000,
  showCharCount = true,
  autoFocus = false,
  onAiSuggestPress,
}: PostComposerSheetProps) {
  const C = useColors();
  const [, setFocused] = useState(false);
  // TextInput の実測高さ。content に応じて伸びる。
  const [contentHeight, setContentHeight] = useState<number>(minHeight);

  // focus 0 → 1 で border alpha を transparent → accent へ
  const focusProgress = useSharedValue(0);
  // AI chip press feedback (scale 1 → 0.95 → 1)
  const chipScale = useSharedValue(1);

  const handleFocus = useCallback(() => {
    setFocused(true);
    focusProgress.value = withTiming(1, {
      duration: 200,
      easing: Easing.out(Easing.quad),
    });
  }, [focusProgress]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    focusProgress.value = withTiming(0, {
      duration: 200,
      easing: Easing.out(Easing.quad),
    });
  }, [focusProgress]);

  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const measured = e.nativeEvent.contentSize.height;
      // minHeight 〜 AUTO_GROW_MAX_HEIGHT の範囲で clamp
      const next = Math.min(Math.max(measured, minHeight), AUTO_GROW_MAX_HEIGHT);
      // 同値なら setState を skip (再 render 抑制)
      if (next !== contentHeight) setContentHeight(next);
    },
    [contentHeight, minHeight],
  );

  const handleAiPress = useCallback(() => {
    if (!onAiSuggestPress) return;
    hapticPresets.light();
    chipScale.value = withSpring(0.95, { damping: 14, stiffness: 360, mass: 0.6 }, () => {
      chipScale.value = withSpring(1, { damping: 14, stiffness: 360, mass: 0.6 });
    });
    onAiSuggestPress();
  }, [onAiSuggestPress, chipScale]);

  // border は focus で transparent → accent。非 focus 時もレイアウトシフトを
  // 起こさないように常に 1px の border を持たせ、色だけ animate する。
  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focusProgress.value, [0, 1], ['rgba(0,0,0,0)', C.accent]),
  }));

  const chipAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: chipScale.value }],
  }));

  // 文字数カウンタの色
  const len = value.length;
  const ratio = maxLength > 0 ? len / maxLength : 0;
  const counterColor =
    ratio >= 1 ? C.red : ratio >= WARN_THRESHOLD ? C.amber : C.text3;

  const Sparkles = Icon.sparkles;

  return (
    <View style={{ width: '100%' }}>
      <Animated.View
        style={[
          {
            borderRadius: R.lg,
            borderWidth: 1,
            backgroundColor: C.bg2,
            // 右下の counter / 左下の AI chip と本文の余白を確保するため
            // bottom padding を大きめに取る (chip の高さ 32 + margin)
            paddingTop: SP['4'],
            paddingHorizontal: SP['4'],
            paddingBottom: SP['10'],
          },
          borderStyle,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onContentSizeChange={handleContentSizeChange}
          placeholder={placeholder}
          placeholderTextColor={C.text3}
          multiline
          textAlignVertical="top"
          autoFocus={autoFocus}
          maxLength={maxLength}
          // dark / light 双方でカーソルが accent 色で見えるようにする
          selectionColor={C.accent}
          cursorColor={C.accent}
          // Threads / X 風: 18pt regular, 1.6 line-height, slight tight tracking.
          // T.* には該当 size が無いので spec 通りの数値を inline で当てる。
          style={{
            // height で固定すると auto-grow がカクつくため minHeight に寄せる。
            // contentHeight が更新されると render で高さが伸びていく。
            minHeight: Math.max(contentHeight, minHeight),
            maxHeight: AUTO_GROW_MAX_HEIGHT,
            color: C.text,
            fontSize: 18,
            lineHeight: 28, // 18 * 1.555 ≈ 28 (≒ 1.6)
            letterSpacing: -0.2,
            // SF Pro / system font を優先 — design/typography.ts の LOGO_FONT と同方針
            fontFamily: Platform.select({
              ios: 'System',
              android: 'Inter_400Regular',
              web: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Inter, sans-serif',
              default: 'Inter_400Regular',
            }),
            // padding は外側コンテナで持つ — TextInput 自身は 0 にして
            // multiline の textAlignVertical=top と相性を取る
            padding: 0,
            // multiline で web 側に出る default のリサイズハンドルを抑制
            ...(Platform.OS === 'web'
              ? ({ outlineStyle: 'none', resize: 'none' } as object)
              : null),
          }}
        />

        {/* 左下: AI 提案 chip (onAiSuggestPress が渡された時のみ) */}
        {onAiSuggestPress && (
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: SP['3'],
                bottom: SP['3'],
              },
              chipAnimStyle,
            ]}
          >
            <Pressable
              onPress={handleAiPress}
              accessibilityRole="button"
              accessibilityLabel="AI でキャプション提案"
              hitSlop={8}
              style={{
                height: 32,
                borderRadius: 16,
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['1'],
                backgroundColor: C.accentBg,
                borderWidth: 1,
                borderColor: C.accentSoft,
              }}
            >
              <Sparkles size={14} color={C.accent} strokeWidth={2.4} />
              <Text style={[T.smallM, { color: C.accent, fontWeight: '700' }]}>AI 提案</Text>
            </Pressable>
          </Animated.View>
        )}

        {/* 右下: 文字数カウンタ */}
        {showCharCount && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              right: SP['3'],
              bottom: SP['3'],
            }}
          >
            <Text style={[T.caption, { color: counterColor }]}>
              {len} / {maxLength}
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}
