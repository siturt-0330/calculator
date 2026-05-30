// =============================================================================
// TabVisibilityToggle — 「このタブを他人に表示」のトグル pill (本人専用)
// -----------------------------------------------------------------------------
// 共有・投稿の各タブの上に置く小さなコントロール。Eye / EyeOff アイコン +
// ラベルで現在の公開状態を示し、タップで切り替え。
//
// presentational に徹する。値変更は親から渡る setValue で行う。
// 非表示時は本人視点で「他の人にはこのタブが見えません」の説明文を併記する。
// =============================================================================

import { View, Text } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export function TabVisibilityToggle({
  value,
  onChange,
  tabName,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  /** 「共有」「投稿」などの表示名 (アクセシビリティとヒントに使う) */
  tabName: string;
}) {
  const visible = value;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingHorizontal: SP['4'],
        paddingTop: SP['3'],
        paddingBottom: SP['2'],
      }}
    >
      <PressableScale
        onPress={() => onChange(!visible)}
        haptic="select"
        accessibilityRole="switch"
        accessibilityState={{ checked: visible }}
        accessibilityLabel={`${tabName}を${visible ? '非公開' : '公開'}にする`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: SP['3'],
          paddingVertical: 6,
          borderRadius: R.full,
          backgroundColor: visible ? C.accentBg : C.bg2,
          borderWidth: 1,
          borderColor: visible ? C.accentSoft : C.border,
        }}
      >
        {visible ? (
          <Eye size={13} color={C.accent} strokeWidth={2.2} />
        ) : (
          <EyeOff size={13} color={C.text2} strokeWidth={2.2} />
        )}
        <Text
          style={[
            T.smallB,
            { color: visible ? C.accent : C.text2, fontSize: 12 },
          ]}
        >
          {visible ? '公開中' : '非公開'}
        </Text>
      </PressableScale>

      <Text style={[T.caption, { color: C.text3, flex: 1 }]} numberOfLines={1}>
        {visible
          ? '他の人にもこのタブが見えます'
          : '他の人には見えません (あなたには表示されています)'}
      </Text>
    </View>
  );
}
