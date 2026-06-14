// =============================================================================
// components/contest/CommunityContestsSection.tsx — コミュ詳細ホームの「開催中のコンテスト」
// -----------------------------------------------------------------------------
// そのコミュの開催中(未void かつ result 未到達)のコンテストをカードで出す。0件なら何も出さない。
// コミュのホームフィード(投稿)の上に差し込んで「コミュのイベントとして流れる」感を出す(①)。
// =============================================================================

import { View, Text } from 'react-native';
import { Trophy } from 'lucide-react-native';

import { useTheme } from '../../hooks/useColors';
import { SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useContestsByCommunity } from '../../hooks/useContests';
import { ContestCard } from './ContestCard';

export function CommunityContestsSection({ communityId }: { communityId: string }) {
  const { C } = useTheme();
  const { data: contests = [] } = useContestsByCommunity(communityId);
  const active = contests.filter((c) => !c.voided && (!c.result_at || new Date() < new Date(c.result_at)));
  if (active.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['1'], gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <Trophy size={15} color={C.accent} strokeWidth={2.2} />
        <Text style={[T.smallB, { color: C.text }]}>開催中のコンテスト</Text>
      </View>
      {active.map((c) => <ContestCard key={c.id} contest={c} />)}
    </View>
  );
}
