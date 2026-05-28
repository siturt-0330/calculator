// ============================================================
// components/community/CommunitySubTabs.tsx
// ------------------------------------------------------------
// コミュニティ詳細画面の 4 (+1) サブタブ chip ナビ。
//
//   ホーム / 掲示板 / マップ / カレンダー / (管理人 *mod only*)
//
// expo-router の Tabs in Tabs は親 (tabs)/_layout.tsx と衝突するため、
// 親 component (community/[id]/index.tsx) が `value` state を保持し、
// このコンポーネントは pure な chip 行として描画するだけ。
//
// design 統一:
//   - 非 active: C.bg2 chip, C.text2 label, C.border
//   - active:   GRAD.primary グラデ + 白文字 + 軽い glow
//   - admin chip は GRAD.warm (mod アクセント) で明確に区別
// ============================================================
import { View, Text, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP, SHADOW, GRAD } from '../../design/tokens';
import { T } from '../../design/typography';
import type { LucideIcon } from 'lucide-react-native';

export type CommunitySubTabKey = 'home' | 'bbs' | 'map' | 'calendar' | 'admin';

type ChipDef = {
  key: CommunitySubTabKey;
  label: string;
  icon: LucideIcon;
};

// 表示順固定: 4 sub tab + admin (mod 限定で末尾)
const TABS: ChipDef[] = [
  { key: 'home', label: 'ホーム', icon: Icon.home },
  // Icon.message が registry に無いので Icon.bbs (MessageSquare) を流用
  { key: 'bbs', label: '掲示板', icon: Icon.bbs },
  { key: 'map', label: 'マップ', icon: Icon.map },
  { key: 'calendar', label: 'カレンダー', icon: Icon.calendar },
  { key: 'admin', label: '管理人', icon: Icon.shield },
];

export function CommunitySubTabs({
  value,
  onChange,
  showAdmin,
}: {
  value: CommunitySubTabKey;
  onChange: (k: CommunitySubTabKey) => void;
  showAdmin: boolean;
}) {
  const visibleTabs = TABS.filter((t) => t.key !== 'admin' || showAdmin);
  return (
    <View
      style={{
        backgroundColor: C.bg,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SP['3'],
          paddingVertical: SP['3'],
          gap: SP['2'],
          alignItems: 'center',
        }}
      >
        {visibleTabs.map((t) => {
          const active = value === t.key;
          const isAdminChip = t.key === 'admin';
          return (
            <SubTabChip
              key={t.key}
              chip={t}
              active={active}
              admin={isAdminChip}
              onPress={() => onChange(t.key)}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function SubTabChip({
  chip,
  active,
  admin,
  onPress,
}: {
  chip: ChipDef;
  active: boolean;
  admin: boolean;
  onPress: () => void;
}) {
  const I = chip.icon;
  // active 時のグラデ: admin は警告系 (GRAD.warm), それ以外は primary 紫
  // 非 active は flat C.bg2 + border。
  if (active) {
    const grad = admin ? GRAD.warm : GRAD.primary;
    return (
      <PressableScale
        onPress={onPress}
        haptic="select"
        accessibilityRole="tab"
        accessibilityState={{ selected: true }}
        accessibilityLabel={`${chip.label} (選択中)`}
        // Web では shadowColor の glow が cropped されると残念なので
        // overflow: visible にしておく (Native は影付き)
        style={{ borderRadius: R.full, overflow: Platform.OS === 'web' ? 'visible' : 'hidden' }}
      >
        <LinearGradient
          colors={[grad[0], grad[grad.length - 1]] as unknown as readonly [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: SP['4'],
            paddingVertical: SP['2'],
            borderRadius: R.full,
            ...SHADOW.glow,
          }}
        >
          <I size={14} color="#fff" strokeWidth={2.6} />
          <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>{chip.label}</Text>
        </LinearGradient>
      </PressableScale>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="tab"
      accessibilityState={{ selected: false }}
      accessibilityLabel={chip.label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: SP['4'],
        paddingVertical: SP['2'],
        borderRadius: R.full,
        backgroundColor: C.bg2,
        borderWidth: 1,
        borderColor: admin ? C.amber + '55' : C.border,
        ...SHADOW.xs,
      }}
    >
      <I
        size={14}
        color={admin ? C.amber : C.text2}
        strokeWidth={2.4}
      />
      <Text
        style={[
          T.smallM,
          {
            color: admin ? C.amber : C.text2,
            fontWeight: '700',
          },
        ]}
      >
        {chip.label}
      </Text>
    </PressableScale>
  );
}
