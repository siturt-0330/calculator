// ============================================================
// AuthorIdentityRow — 投稿作成キャンバス最上部の「投稿者アイデンティティ行」
// ------------------------------------------------------------
// X (Twitter) 風の構成:
//   [アバター]  誰が投稿しているか + 補助テキスト        [匿名トグル pill]
//
// - 右端の pill 自体が匿名 ON/OFF のコントロール (タップで切替)。
// - 匿名時はアバターを差し替え、名前を伏せ、pill を accent 配色に。
// - 純粋な presentational component (状態は親が保持し props で渡す)。
// ============================================================

import { View, Text, StyleSheet } from 'react-native';
import { EyeOff, Eye } from 'lucide-react-native';
import { useColors } from '../../../hooks/useColors';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { Avatar } from '../../ui/Avatar';
import { PressableScale } from '../../ui/PressableScale';

export interface AuthorIdentityRowProps {
  displayName: string; // 例: ニックネーム、または 'あなた'
  anonymous: boolean;
  onToggleAnonymous: (next: boolean) => void;
  avatarUri?: string | null;
  avatarEmoji?: string | null;
}

export function AuthorIdentityRow(props: AuthorIdentityRowProps) {
  const { displayName, anonymous, onToggleAnonymous, avatarUri, avatarEmoji } = props;
  const C = useColors();

  // 匿名 / 公開で pill の配色・アイコン・ラベルを出し分ける。
  const pillBg = anonymous ? C.accentBg : C.bg3;
  const pillBorder = anonymous ? C.accent : C.border;

  return (
    <View style={styles.row}>
      {/* 左: アバター (匿名なら専用表現、そうでなければ ring 付き) */}
      {anonymous ? (
        <Avatar size={44} anonymous />
      ) : (
        <Avatar size={44} name={displayName} uri={avatarUri} emoji={avatarEmoji} ring="accent" />
      )}

      {/* 中央: 投稿者名 + 補助テキスト */}
      <View style={styles.center}>
        <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
          {anonymous ? '匿名で投稿' : displayName}
        </Text>
        <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
          {anonymous ? '名前は表示されません' : 'プロフィールに表示されます'}
        </Text>
      </View>

      {/* 右: 匿名トグル pill (この pill 自体がコントロール) */}
      <PressableScale
        haptic="select"
        onPress={() => onToggleAnonymous(!anonymous)}
        accessibilityRole="switch"
        accessibilityState={{ checked: anonymous }}
        accessibilityLabel={anonymous ? '匿名投稿をオフにする' : '匿名で投稿する'}
        style={[styles.pill, { backgroundColor: pillBg, borderColor: pillBorder }]}
      >
        {anonymous ? (
          <>
            <EyeOff size={14} color={C.accentLight} strokeWidth={2.2} />
            <Text style={[T.smallB, { color: C.accentLight }]}>匿名</Text>
          </>
        ) : (
          <>
            <Eye size={14} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.smallM, { color: C.text2 }]}>名前公開</Text>
          </>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP['3'],
  },
  center: {
    flex: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: SP['3'],
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: R.full,
  },
});
