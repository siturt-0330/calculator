// =============================================================================
// EditorialField — EDITORIAL「特集」言語のテキスト入力(目録カード一葉)
// -----------------------------------------------------------------------------
// ・黒地 C.bg + 大型タイポ + 紫 accent を一点集中。
// ・入力欄は subtle な塗り(C.bg2)+ 枠線で「ここに入力する」を明示し、focus で
//   枠線が C.border→C.accent に灯る(以前の下線一本から、視認性重視に更新)。
// ・presentational に徹する(fetch/router/store なし)。唯一の例外として focus の
//   内部 state と枠線アニメ用 sharedValue(focusProgress)だけを内部で持つ。
// ・props はすべて親から注入。useReducedMotion() を尊重しモーションを退避する。
// ・構成: ラベル行(ラベル + 必須 * + 文字数カウンタ)→ hint → 入力本体(塗り箱)。
// =============================================================================

import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { SPRING_TIGHT, TIMING_NORM } from '../../design/motion';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolateColor,
  useReducedMotion,
} from 'react-native-reanimated';

// ----- props ----------------------------------------------------------------
// 親が挙動と値を注入する。focus 状態と枠線アニメだけは内部で完結させる。
export interface EditorialFieldProps {
  /** ラベル文字列(例: 「コミュニティ名」)。アクセシビリティラベルにも使う。 */
  label: string;
  /** 必須項目なら true。ラベル横に C.red の * を添える。 */
  required?: boolean;
  /** 補足説明。指定時のみラベル下に C.text3 の小さな注記を出す。 */
  hint?: string;
  /** 現在値(制御コンポーネント)。 */
  value: string;
  /** 入力変更ハンドラ。 */
  onChangeText: (t: string) => void;
  /** プレースホルダ文字列。 */
  placeholder?: string;
  /** 最大文字数。showCount と併せてカウンタ表示に使う。 */
  maxLength?: number;
  /** 複数行入力にするか。true で minHeight 96 + 上揃え。 */
  multiline?: boolean;
  /** 文字数カウンタを出すか(maxLength 併用時のみ実表示)。 */
  showCount?: boolean;
  /** マウント時に自動フォーカスするか。 */
  autoFocus?: boolean;
  /** 送信(returnKey)時のハンドラ。 */
  onSubmitEditing?: () => void;
  /** returnKey の種別。 */
  returnKeyType?: 'done' | 'search' | 'next';
  /** 自動大文字化(英字入力欄では 'none' 推奨)。 */
  autoCapitalize?: 'none' | 'sentences';
}

export function EditorialField(props: EditorialFieldProps) {
  const {
    label,
    required = false,
    hint,
    value,
    onChangeText,
    placeholder,
    maxLength,
    multiline = false,
    showCount = false,
    autoFocus = false,
    onSubmitEditing,
    returnKeyType,
    autoCapitalize,
  } = props;

  const reduceMotion = useReducedMotion();

  // focus の内部 state と枠線アニメ駆動用 sharedValue。0=blur / 1=focus。
  const [, setFocused] = useState(false);
  const focusProgress = useSharedValue(0);

  const handleFocus = useCallback(() => {
    setFocused(true);
    // reduce-motion でも色変化は許容。spring は timing に退避。
    focusProgress.value = reduceMotion
      ? withTiming(1, TIMING_NORM)
      : withSpring(1, SPRING_TIGHT);
  }, [focusProgress, reduceMotion]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    focusProgress.value = reduceMotion
      ? withTiming(0, TIMING_NORM)
      : withSpring(0, SPRING_TIGHT);
  }, [focusProgress, reduceMotion]);

  // 枠線は使わない(オレンジ/白の枠を排除)。focus は塗りを C.bg2 → C.bg3 に僅かに
  // 持ち上げて静かに示す。
  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [C.bg2, C.bg3],
    ),
  }));

  // 文字数カウンタの色: 残り少(>=90%)で amber、超過で red、通常は text4。
  const count = value.length;
  const nearLimit = maxLength != null && count >= maxLength * 0.9;
  const overLimit = maxLength != null && count > maxLength;
  const counterColor = overLimit ? C.red : nearLimit ? C.amber : C.text4;

  const showCounter = showCount && maxLength != null;

  return (
    <View style={styles.root}>
      {/* ラベル行: 左にラベル(+必須*)、右端に文字数カウンタ。 */}
      <View style={styles.labelRow}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
          {required ? <Text style={styles.requiredMark}> *</Text> : null}
        </Text>
        {showCounter ? (
          <Text style={[styles.counter, { color: counterColor }]}>
            {count}/{maxLength}
          </Text>
        ) : null}
      </View>

      {/* 補足説明(任意)。 */}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {/* 入力本体。塗り(C.bg2)+枠線で「入力欄」を明示し、focus で枠が accent に灯る。 */}
      <Animated.View style={[styles.inputBox, boxStyle]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.text3}
          selectionColor={C.accent}
          cursorColor={C.accent}
          maxLength={maxLength}
          multiline={multiline}
          autoFocus={autoFocus}
          autoCapitalize={autoCapitalize}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={handleFocus}
          onBlur={handleBlur}
          accessibilityLabel={label}
          underlineColorAndroid="transparent"
          style={[
            T.body,
            {
              color: C.text,
              paddingVertical: multiline ? 10 : 8,
              minHeight: multiline ? 96 : undefined,
              textAlignVertical: multiline ? 'top' : 'auto',
            },
            // Web: ブラウザ既定のフォーカス枠線(OS accent 由来のオレンジ等)を消す。
            Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none' } as object) : null,
          ]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...T.smallB,
    color: C.text2,
    flexShrink: 1,
  },
  requiredMark: {
    ...T.smallB,
    color: C.red,
  },
  counter: {
    ...T.caption,
    marginLeft: 8,
  },
  hint: {
    ...T.caption,
    color: C.text3,
    marginTop: 4,
  },
  // 入力箱: 枠線なしの subtle な塗りのみ。focus で boxStyle が塗りを僅かに持ち上げる。
  inputBox: {
    marginTop: 6,
    backgroundColor: C.bg2,
    borderRadius: R.md,
    paddingHorizontal: SP[3],
  },
});
