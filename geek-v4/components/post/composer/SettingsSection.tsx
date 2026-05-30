// ============================================================
// SettingsSection — 投稿作成 step 2 (create-settings.tsx) 用セクションラッパー
// ------------------------------------------------------------
// 各設定グループに一貫したヘッダー・区切り線・余白を提供する presentational component。
//
// レイアウト (上から順):
//   1. フル幅 hairline 区切り線 (C.border)
//   2. ヘッダー行: タイトル (T.smallB / C.text2) + 必須バッジ ("必須" in C.red)
//   3. ヒント文言 (optional / T.caption / C.text3)
//   4. children (paddingHorizontal: SP['4'], paddingBottom: SP['4'])
//
// Props:
//   title    — セクションタイトル
//   children — セクション内コンテンツ
//   required — true のとき "必須" バッジを表示 (default: false)
//   hint     — タイトル下に出す補足テキスト (optional)
// ============================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { useColors } from '../../../hooks/useColors';

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
  /** true のとき "必須" バッジを赤で表示 (default: false) */
  required?: boolean;
  /** タイトル下に表示する補足テキスト */
  hint?: string;
}

export function SettingsSection({
  title,
  children,
  required = false,
  hint,
}: SettingsSectionProps) {
  const C = useColors();

  return (
    <View>
      {/* 1. hairline 区切り線 */}
      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: C.border,
        }}
      />

      {/* 2. ヘッダー行 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          paddingHorizontal: SP['4'],
          paddingTop: SP['4'],
          paddingBottom: SP['2'],
        }}
      >
        <Text style={[T.smallB, { color: C.text2, flex: 1 }]}>{title}</Text>

        {required && (
          <View
            style={{
              backgroundColor: C.red + '22',
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 4,
            }}
          >
            <Text style={[T.caption, { color: C.red }]}>必須</Text>
          </View>
        )}
      </View>

      {/* 3. ヒント文言 (optional) */}
      {hint ? (
        <Text
          style={[
            T.caption,
            {
              color: C.text3,
              paddingHorizontal: SP['4'],
              paddingBottom: SP['1'],
            },
          ]}
        >
          {hint}
        </Text>
      ) : null}

      {/* 4. children */}
      <View style={{ paddingHorizontal: SP['4'], paddingBottom: SP['4'] }}>{children}</View>
    </View>
  );
}
