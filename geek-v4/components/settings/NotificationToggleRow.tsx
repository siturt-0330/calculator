// ============================================================
// components/settings/NotificationToggleRow.tsx
// ============================================================
// 通知 preference 細分化用の行 component。
// 左に icon (accentBg の丸チップ) + label + description、
// 右に 2 つの Switch (Push / In-app) — 固定幅ラベル + 揃えた行高で整列。
//
// Geek UI 統一:
//   - 色: useColors() (ライト/ダーク両対応)
//   - typography: T.bodyB / T.caption / T.captionM
//   - spacing: SP['1'..'4'] / radius: R.full (チップは必ず正円・影なし)
//   - native Switch を使用 (trackColor を C.accent に揃える)
// ============================================================

import type { ComponentType } from 'react';
import { View, Text, Switch } from 'react-native';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';
import type { LucideIcon } from 'lucide-react-native';

type IconLike = LucideIcon | ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export type NotificationToggleRowProps = {
  icon: IconLike;
  label: string;
  description?: string;
  push: boolean;
  inapp: boolean;
  onChangePush: (next: boolean) => void;
  onChangeInApp: (next: boolean) => void;
  // 行全体を disabled にしたい場合 (Push master off 等)
  disabled?: boolean;
};

export function NotificationToggleRow({
  icon: IconCmp,
  label,
  description,
  push,
  inapp,
  onChangePush,
  onChangeInApp,
  disabled = false,
}: NotificationToggleRowProps) {
  const C = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: SP['3'],
        paddingHorizontal: SP['4'],
        gap: SP['3'],
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {/* 左: icon 丸チップ (accentBg・正円・影/白背景なし) + label + description */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: R.full,
          backgroundColor: C.accentBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconCmp size={18} color={C.accent} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {/* 右: 2 つの Switch (Push / In-app) — 固定幅ラベル + 行高を揃えて縦に整列 */}
      <View style={{ gap: SP['1'] }}>
        <ToggleWithLabel
          label="Push"
          value={push}
          onValueChange={onChangePush}
          disabled={disabled}
        />
        <ToggleWithLabel
          label="In-app"
          value={inapp}
          onValueChange={onChangeInApp}
          disabled={disabled}
        />
      </View>
    </View>
  );
}

function ToggleWithLabel({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const C = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        minHeight: 32,
      }}
    >
      <Text style={[T.captionM, { color: C.text3, width: 44, textAlign: 'right' }]}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: C.bg4, true: C.accent }}
        thumbColor="#ffffff"
        disabled={disabled}
        // iOS は ios_backgroundColor も合わせると false 時の色が綺麗
        ios_backgroundColor={C.bg4}
      />
    </View>
  );
}
