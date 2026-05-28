// ============================================================
// components/settings/NotificationToggleRow.tsx
// ============================================================
// 通知 preference 細分化用の行 component。
// 左に icon + label + description、右に 2 つの Switch (Push / In-app)。
//
// Geek UI 統一:
//   - 色: C.bg2 / C.text / C.text3 / C.accent
//   - typography: T.bodyMd / T.caption
//   - spacing: SP['2'..'4']
//   - native Switch を使用 (trackColor を C.accent に揃える)
// ============================================================

import type { ComponentType } from 'react';
import { View, Text, Switch } from 'react-native';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
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
      {/* 左: icon + label + description */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: C.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconCmp size={18} color={C.accent} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.bodyMd, { color: C.text }]} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text style={[T.caption, { color: C.text3 }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {/* 右: 2 つの Switch (Push / In-app) — 縦並びで省スペース */}
      <View style={{ gap: SP['1'], alignItems: 'flex-end' }}>
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
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
      }}
    >
      <Text style={[T.caption, { color: C.text3, minWidth: 40, textAlign: 'right' }]}>
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
