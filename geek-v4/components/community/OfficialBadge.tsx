// ============================================================
// OfficialBadge — 公式認証バッジ
// ============================================================
// 公式コミュニティ (communities.is_official = true) を表す
// アクセント色のピル。チェックマーク + 「公式」のテキスト。
// サイズは sm (リスト用) / md (詳細ヘッダ用) を選べる。
// ============================================================
import { View, Text, type ViewStyle } from 'react-native';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';

type Size = 'sm' | 'md';

type Props = {
  size?: Size;
  style?: ViewStyle;
  /**
   * テキストを隠してチェックマークだけにする。コンパクトな場所 (チップ内など) で使用。
   */
  iconOnly?: boolean;
};

const SIZE_TOKENS: Record<Size, { iconSize: number; fontSize: number; px: number; py: number; gap: number }> = {
  sm: { iconSize: 10, fontSize: 10, px: 6,  py: 2, gap: 3 },
  md: { iconSize: 12, fontSize: 11, px: SP['2'], py: 3, gap: 4 },
};

export function OfficialBadge({ size = 'sm', style, iconOnly = false }: Props) {
  const t = SIZE_TOKENS[size];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.gap,
          paddingHorizontal: iconOnly ? t.py : t.px,
          paddingVertical: t.py,
          backgroundColor: C.accent,
          borderRadius: R.full,
        },
        style,
      ]}
      accessibilityLabel="公式コミュニティ"
    >
      <Icon.check size={t.iconSize} color="#fff" strokeWidth={3} />
      {!iconOnly && (
        <Text
          style={{
            color: '#fff',
            fontSize: t.fontSize,
            fontWeight: '800',
            letterSpacing: 0.3,
          }}
        >
          公式
        </Text>
      )}
    </View>
  );
}
