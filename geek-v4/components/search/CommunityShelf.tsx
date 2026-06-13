// ============================================================
// CommunityShelf — 発見タブの 1 セクション (見出し + 縦積みカード)
// おすすめ / 急上昇 / 公式 で再利用。loading / empty state を内包。
// ============================================================
import React from 'react';
import { View, Text } from 'react-native';
import { useColors } from '../../hooks/useColors';
import { SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon, type IconName } from '../../constants/icons';
import { CommunityBigCard } from './CommunityBigCard';
import { CommunityCardSkeletonList } from './CommunityCardSkeleton';
import { type Community } from '../../lib/api/communities';

export interface CommunityShelfProps {
  title: string;
  iconName?: IconName; // e.g. 'sparkles' | 'trendingUp' | 'award'
  iconColor?: string; // optional tint; default C.accent
  communities: Community[];
  memberIdSet: Set<string>;
  joiningIds?: Set<string>;
  onJoin: (c: Community) => void;
  onPressCommunity: (c: Community) => void;
  isLoading?: boolean;
  emptyText?: string; // default 'まだありません'
}

export function CommunityShelf(props: CommunityShelfProps) {
  const C = useColors();

  // アイコンは名前から動的解決 (registry 経由)。未指定なら描画しない。
  const Glyph = props.iconName ? Icon[props.iconName] : null;

  // ★ 2026-06-13 ユーザー要望: 「おすすめ/急上昇/公式」は **まだ参加していない**
  //   コミュニティだけ出す。参加済み (memberIdSet) は提案棚から除外する。
  const visibleCommunities = props.communities.filter((c) => !props.memberIdSet.has(c.id));

  return (
    <View style={{ marginTop: SP['5'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          marginBottom: SP['2'],
          paddingHorizontal: SP['1'],
        }}
      >
        {Glyph ? <Glyph size={18} color={props.iconColor ?? C.accent} strokeWidth={2.4} /> : null}
        <Text style={[T.h2, { color: C.text, fontWeight: '800' }]}>{props.title}</Text>
      </View>

      {props.isLoading ? (
        <CommunityCardSkeletonList count={3} />
      ) : visibleCommunities.length === 0 ? (
        <Text style={[T.small, { color: C.text3, paddingVertical: SP['3'] }]}>
          {props.emptyText ?? 'まだありません'}
        </Text>
      ) : (
        <View style={{ gap: SP['3'] }}>
          {visibleCommunities.map((c) => (
            <CommunityBigCard
              key={c.id}
              community={c}
              isMember={false}
              joining={props.joiningIds?.has(c.id) ?? false}
              onPress={props.onPressCommunity}
              onJoin={props.onJoin}
            />
          ))}
        </View>
      )}
    </View>
  );
}
