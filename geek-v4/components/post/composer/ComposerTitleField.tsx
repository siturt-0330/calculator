// ============================================================
// ComposerTitleField — 大きく枠線のない "タイトル" hero 入力 (Reddit 風)
// ------------------------------------------------------------
// 役割: 投稿 composer の最上部に置く「タイトル」入力。box/border を持たず
// キャンバスに直接乗る hero テキスト入力として、本文 (PostComposerSheet)
// と視覚的な主従関係を作る。
//
// 設計:
//   - controlled component (value / onChangeText) — 親が state を保持
//   - borderless: ui/Input の boxed input は使わず素の TextInput。
//     padding 0 でキャンバスに直接乗せる。
//   - 単一行寄り (multiline 無し)。returnKeyType 'next' + blurOnSubmit で
//     送信時に本文へフォーカスを渡す導線を親に残す。
//   - focus 状態を local state で追跡し、文字数カウンタを
//     「focus 中」または「上限の 85% 以上」のときだけ subtle 表示。
//     85% で amber、100% で red に色が変わる。
//   - inputRef が渡されたら TextInput へ forward (親から focus 制御可能に)。
//   - dark / light 双方対応 (useColors)。純 presentational。
// ============================================================

import { useState } from 'react';
import { TextInput, View, Text, Platform, type TextInput as RNTextInput } from 'react-native';
import { useColors } from '../../../hooks/useColors';
import { SP } from '../../../design/tokens';
import { T } from '../../../design/typography';

// 文字数カウンタを表示し始めるしきい値 (上限の何 % から見せるか)。
// 仕様: focus 中 OR 85% 以上で表示。
const COUNTER_VISIBLE_THRESHOLD = 0.85;
// amber に切替えるしきい値 (= 表示開始と同じ 85%)。
const WARN_THRESHOLD = 0.85;

export interface ComposerTitleFieldProps {
  value: string;
  onChangeText: (t: string) => void;
  /** プレースホルダ。default 'タイトル (任意)' */
  placeholder?: string;
  /** 文字数上限 (hard cap)。default 80 */
  maxLength?: number;
  /** TextInput への ref forward (親から focus 制御したいとき) */
  inputRef?: React.RefObject<RNTextInput>;
}

export function ComposerTitleField({
  value,
  onChangeText,
  placeholder = 'タイトル (任意)',
  maxLength = 80,
  inputRef,
}: ComposerTitleFieldProps) {
  const C = useColors();
  const [focused, setFocused] = useState(false);

  const len = value.length;
  const ratio = maxLength > 0 ? len / maxLength : 0;

  // カウンタの色: 100% で red、85% 以上で amber、それ未満は text3。
  const counterColor = ratio >= 1 ? C.red : ratio >= WARN_THRESHOLD ? C.amber : C.text3;

  // 表示条件: focus 中 OR 85% 以上。
  const showCounter = focused || ratio >= COUNTER_VISIBLE_THRESHOLD;

  return (
    <View style={{ width: '100%' }}>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={C.text3}
        selectionColor={C.accent}
        maxLength={maxLength}
        // 単一行 hero 入力。Enter で本文へ送る導線を親に残す。
        blurOnSubmit
        returnKeyType="next"
        accessibilityLabel="タイトル"
        style={{
          color: C.text,
          fontSize: 22,
          fontWeight: '800',
          lineHeight: 28,
          // SF Pro / system を優先 — design/typography.ts と同方針
          fontFamily: Platform.select({
            ios: 'System',
            android: 'NotoSansJP_700Bold',
            web: '-apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif',
            default: 'NotoSansJP_700Bold',
          }),
          // borderless: 枠も padding も持たずキャンバスに直接乗せる
          padding: 0,
          // web の default outline / リサイズハンドルを抑制
          ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
        }}
      />

      {/* 右寄せ文字数カウンタ — focus 中 or 85% 以上のときだけ subtle 表示 */}
      {showCounter && (
        <View pointerEvents="none" style={{ alignItems: 'flex-end', marginTop: SP['1'] }}>
          <Text style={[T.caption, { color: counterColor, fontVariant: ['tabular-nums'] }]}>
            {len}/{maxLength}
          </Text>
        </View>
      )}
    </View>
  );
}
