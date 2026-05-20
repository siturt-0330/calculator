// 検索画面のインライン・フィルタ・トグル 2 つ:
//   1. 「好きなタグ優先」  — liked tags のみに絞る (任意, デフォルト OFF)
//   2. 「ブロックタグを除外」 — blocked tags を非表示にする
//      ※ 安全のためデフォルト ON を呼び出し側で渡すこと。本コンポーネントは
//        prop で受け取った値をそのまま表示するだけ (自前で state を持たない)。
//
// 2 つのピル (横並び) で、ON のとき左に check アイコン + accent 着色。
// 既存の ScopeToggle / フィルタ画面のスタイルに揃える。

import { View, Text } from 'react-native';
import { PressableScale } from '@/components/ui/PressableScale';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

type Props = {
  likedOnly: boolean;
  hideBlocked: boolean;
  onLikedOnly: (v: boolean) => void;
  onHideBlocked: (v: boolean) => void;
};

export function InlineTagFilterToggles({
  likedOnly,
  hideBlocked,
  onLikedOnly,
  onHideBlocked,
}: Props) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: SP['2'],
        paddingHorizontal: SP['4'],
        paddingVertical: SP['2'],
      }}
    >
      <FilterPill
        label="好きなタグ優先"
        active={likedOnly}
        onToggle={() => onLikedOnly(!likedOnly)}
        activeColor={C.liked}
        activeBg={C.likedBg}
      />
      <FilterPill
        label="ブロックタグを除外"
        active={hideBlocked}
        onToggle={() => onHideBlocked(!hideBlocked)}
        activeColor={C.block}
        activeBg={C.blockBg}
      />
    </View>
  );
}

function FilterPill({
  label,
  active,
  onToggle,
  activeColor,
  activeBg,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  activeColor: string;
  activeBg: string;
}) {
  const CheckIcon = Icon.check;
  return (
    <PressableScale
      onPress={onToggle}
      haptic="select"
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['1'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['2'],
        borderRadius: R.full,
        borderWidth: 1,
        backgroundColor: active ? activeBg : 'transparent',
        borderColor: active ? activeColor : C.border,
      }}
    >
      {active ? (
        <CheckIcon size={14} color={activeColor} strokeWidth={2.5} />
      ) : null}
      <Text
        style={[
          T.smallM,
          {
            color: active ? activeColor : C.text2,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableScale>
  );
}
