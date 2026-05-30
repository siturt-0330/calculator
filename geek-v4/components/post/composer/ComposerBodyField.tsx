// ============================================================
// ComposerBodyField — 投稿本文の "書く面" (Threads / X 風)
// ------------------------------------------------------------
// 役割: box を持たない、キャンバスに直に乗る borderless な本文 textarea。
//       これ自体は純 presentational。state は親が持つ controlled component。
//
// 設計:
//   - borderless / padding 0 / scrollEnabled false の multiline TextInput。
//     18pt / lineHeight 28 / weight 400 で「広くて軽い」書き味を出す。
//   - auto-grow: onContentSizeChange の実測高さを state に保持し、
//     160 〜 520 の範囲で clamp (+8 の余白) → minHeight に反映。
//   - 文字数インジケータ (依存ゼロの "ring" 代替):
//       右下に 28px の円 View を置き、その BORDER 色を
//         text3 → amber(≥85%) → red(≥100%) と段階変化させる。
//       円の中央に「残り文字数 (maxLength - len)」を tabular-nums で表示。
//       value が空のときは描画しない (ノイズを出さない)。
//     さらに field 下端に高さ 2px の細い progress line を敷き、
//       内側 fill の width を ${pct}% / 色を accent → amber → red で変化。
//     react-native-svg は使わず、すべて入れ子の View で表現する。
// ============================================================

import { useCallback, useState } from 'react';
import {
  TextInput,
  View,
  Text,
  Platform,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputSelectionChangeEventData,
  type TextInput as RNTextInput,
} from 'react-native';
import { useColors } from '../../../hooks/useColors';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';

// auto-grow の下限 / 上限。これを超えると TextInput 自身が内部スクロールする。
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 480;

// 文字数インジケータの色しきい値 (使用率)。
const AMBER_THRESHOLD = 0.85;
const FULL_THRESHOLD = 1;

// 本文 textarea の font。design/typography.ts の方針 (system 優先) に合わせる。
const BODY_FONT = Platform.select({
  ios: 'System',
  android: 'NotoSansJP_400Regular',
  web: '-apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif',
  default: 'NotoSansJP_400Regular',
}) as string;

export interface ComposerBodyFieldProps {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  /** 文字数上限 (hard cap)。default 2000 */
  maxLength?: number;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** 親が format toolbar 等で選択範囲を使うための通知 */
  onSelectionChange?: (sel: { start: number; end: number }) => void;
  inputRef?: React.RefObject<RNTextInput>;
}

export function ComposerBodyField({
  value,
  onChangeText,
  placeholder,
  maxLength = 2000,
  autoFocus = false,
  onFocus,
  onBlur,
  onSelectionChange,
  inputRef,
}: ComposerBodyFieldProps) {
  const C = useColors();
  // content に応じて伸びる実測高さ。
  const [height, setHeight] = useState<number>(MIN_HEIGHT);

  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const h = e.nativeEvent.contentSize.height;
      // 160 〜 520 の範囲で clamp。少し余白 (+8) を足して窮屈さを避ける。
      const next = Math.max(MIN_HEIGHT, Math.min(h + 8, MAX_HEIGHT));
      setHeight((prev) => (prev === next ? prev : next));
    },
    [],
  );

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const { start, end } = e.nativeEvent.selection;
      onSelectionChange?.({ start, end });
    },
    [onSelectionChange],
  );

  // 使用率 (0〜1) と、それに応じた色 / 残り文字数。
  const len = value.length;
  const pct = maxLength > 0 ? Math.min(len / maxLength, 1) : 0;
  const remaining = maxLength - len;

  const ringColor =
    pct >= FULL_THRESHOLD ? C.red : pct >= AMBER_THRESHOLD ? C.amber : C.text3;
  const fillColor =
    pct >= FULL_THRESHOLD ? C.red : pct >= AMBER_THRESHOLD ? C.amber : C.accent;

  const hasContent = len > 0;

  return (
    <View style={{ width: '100%' }}>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onContentSizeChange={handleContentSizeChange}
        onSelectionChange={handleSelectionChange}
        placeholder={placeholder}
        placeholderTextColor={C.text3}
        selectionColor={C.accent}
        multiline
        scrollEnabled={false}
        autoFocus={autoFocus}
        maxLength={maxLength}
        textAlignVertical="top"
        accessibilityLabel="本文"
        style={{
          minHeight: height,
          color: C.text,
          fontSize: 18,
          lineHeight: 28,
          fontWeight: '400',
          fontFamily: BODY_FONT,
          // box を持たない: padding 0 でキャンバスに直に乗せる。
          padding: 0,
          textAlignVertical: 'top',
          // web の default のリサイズハンドル / outline を抑制。
          ...(Platform.OS === 'web'
            ? ({ outlineStyle: 'none', resize: 'none' } as object)
            : null),
        }}
      />

      {/* 下端の細い progress line (高さ 2px)。fill 幅 = pct%。 */}
      <View
        pointerEvents="none"
        style={{
          marginTop: SP['3'],
          height: 2,
          borderRadius: R.full,
          backgroundColor: C.border,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${pct * 100}%`,
            borderRadius: R.full,
            backgroundColor: fillColor,
          }}
        />
      </View>

      {/* 右下: 文字数 ring (依存ゼロ — border 色が段階変化する 28px の円)。
          中央に残り文字数を tabular-nums で表示。value が空なら出さない。 */}
      {hasContent && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 0,
            bottom: SP['3'] + 2,
            width: 28,
            height: 28,
            borderRadius: 14,
            borderWidth: 2,
            borderColor: ringColor,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: C.bg3,
          }}
        >
          <Text
            style={[
              T.caption,
              {
                color: ringColor,
                fontVariant: ['tabular-nums'],
                textAlign: 'center',
              },
            ]}
          >
            {remaining}
          </Text>
        </View>
      )}
    </View>
  );
}
