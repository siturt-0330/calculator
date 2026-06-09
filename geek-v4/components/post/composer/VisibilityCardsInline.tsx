import { StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, Globe, Lock, Megaphone, Users } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { useColors } from '../../../hooks/useColors';
import type { PostVisibility } from '../../../lib/api/posts';
import { PressableScale } from '../../ui/PressableScale';

// ============================================================
// VisibilityCardsInline — 投稿作成ステップ2 用の公開範囲選択
// ============================================================
// モーダルではなく、フォーム内にインライン展開する 2×2 カードグリッド。
// 選択状態は親が value / onChange で管理 (controlled)。
// ============================================================

export interface VisibilityCardsInlineProps {
  value: PostVisibility;
  onChange: (v: PostVisibility) => void;
}

type OptionDef = {
  key: PostVisibility;
  Icon: LucideIcon;
  title: string;
  desc: string;
};

const OPTIONS: OptionDef[] = [
  {
    key: 'public',
    Icon: Globe,
    title: '全員に公開',
    desc: 'ホームに表示されます',
  },
  {
    key: 'community_public',
    Icon: Megaphone,
    title: 'コミュ＋公開',
    desc: 'フォロワー+コミュに表示',
  },
  {
    key: 'community_only',
    Icon: Users,
    title: 'コミュ限定',
    desc: 'コミュメンバーのみ',
  },
  {
    key: 'private',
    Icon: Lock,
    title: '自分だけ',
    desc: '下書きとして保存',
  },
];

export function VisibilityCardsInline({ value, onChange }: VisibilityCardsInlineProps) {
  const C = useColors();

  return (
    <View style={styles.grid}>
      {OPTIONS.map(({ key, Icon, title, desc }) => {
        const selected = value === key;

        const cardStyle = [
          styles.card,
          {
            backgroundColor: selected ? C.accentBg : C.bg3,
            borderColor: selected ? C.accent : C.border,
          },
        ];

        const iconColor = selected ? C.accent : C.text2;
        const titleColor = selected ? C.accent : C.text;
        const descColor = selected ? C.accentLight : C.text3;

        return (
          <PressableScale
            key={key}
            haptic="select"
            onPress={() => onChange(key)}
            style={cardStyle}
          >
            {/* アイコン行: アイコン + 選択チェックマーク */}
            <View style={styles.iconRow}>
              <Icon size={20} color={iconColor} strokeWidth={1.8} />
              {selected && (
                <CheckCircle2 size={16} color={C.accent} strokeWidth={2} />
              )}
            </View>

            {/* タイトル */}
            <Text style={[T.smallB, styles.title, { color: titleColor }]}>
              {title}
            </Text>

            {/* 説明 */}
            <Text
              style={[T.caption, { color: descColor }]}
              numberOfLines={2}
            >
              {desc}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP['2'],
  },
  card: {
    width: '48%',
    padding: SP['3'],
    borderRadius: R.lg,
    borderWidth: 1.5,
    gap: SP['1'],
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP['1'],
  },
  title: {
    // color は inline で注入
  },
});
