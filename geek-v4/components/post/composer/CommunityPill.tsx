// ============================================================
// CommunityPill — 投稿先コミュニティ選択ピル (Reddit 風)
// ------------------------------------------------------------
// コンポーザーの上部 app bar 中央に置く「投稿先 r/community ▾」セレクタ。
// horizontally-hug する rounded-full ピルで、選択中コミュニティのアイコン +
// 名前 (+ 追加選択数バッジ) を表示し、タップで picker sheet を開く。
//
// 純粋な presentational component:
//   - データは props (community / extraCount)
//   - アクションは callback (onPress)
//   - テーマは useColors()
//   - supabase / zustand / fetch は一切持たない
// ============================================================

import { Text } from 'react-native';
import { useColors } from '../../../hooks/useColors';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../ui/PressableScale';
import { CommunityIcon } from '../../ui/CommunityIcon';
import type { Community } from '../../../lib/api/communities';

export interface CommunityPillProps {
  /** (最初に) 選択中のコミュニティ。未選択なら null */
  community: Community | null;
  /** 最初の 1 件より先に選択されている件数 (>0 で "+N" を表示) */
  extraCount?: number;
  /** コミュニティ picker sheet を開く */
  onPress: () => void;
  /** 未選択時のプレースホルダ文言 (default: 'コミュニティを選択') */
  placeholder?: string;
}

const AVATAR = 22;

export function CommunityPill({
  community,
  extraCount = 0,
  onPress,
  placeholder = 'コミュニティを選択',
}: CommunityPillProps) {
  const C = useColors();

  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityLabel={community ? `投稿先コミュニティ: ${community.name}` : placeholder}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        gap: 6,
        maxWidth: 240,
        paddingVertical: 7,
        paddingHorizontal: SP['3'],
        borderRadius: R.full,
        backgroundColor: C.bg3,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      {community ? (
        <>
          {/* アイコン: 画像があれば優先、無ければ icon_color の円 + 絵文字 */}
          <CommunityIcon
            iconUrl={community.icon_url}
            iconEmoji={community.icon_emoji}
            iconColor={community.icon_color}
            name={community.name}
            size={AVATAR}
          />

          <Text numberOfLines={1} style={[T.smallB, { color: C.text, flexShrink: 1 }]}>
            {community.name}
          </Text>

          {extraCount > 0 && (
            <Text style={[T.caption, { color: C.accent }]}>{`+${extraCount}`}</Text>
          )}

          <Icon.chevronD size={16} color={C.text3} strokeWidth={2.2} />
        </>
      ) : (
        <>
          <Icon.community size={16} color={C.text3} strokeWidth={2.2} />
          <Text numberOfLines={1} style={[T.smallM, { color: C.text3, flexShrink: 1 }]}>
            {placeholder}
          </Text>
          <Icon.chevronD size={16} color={C.text3} strokeWidth={2.2} />
        </>
      )}
    </PressableScale>
  );
}
