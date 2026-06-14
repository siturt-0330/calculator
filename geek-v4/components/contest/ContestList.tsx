// =============================================================================
// components/contest/ContestList.tsx — ホーム「コンテスト」スコープの一覧
// -----------------------------------------------------------------------------
// listOpenContests (RLS が可視性を担保) を並べ、タップで /contest/[id] へ。
// カードは ContestCard を共用。件数は少ない (≤30) ので ScrollView で十分。
// =============================================================================

import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Trophy } from 'lucide-react-native';

import { useTheme } from '../../hooks/useColors';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { useOpenContests } from '../../hooks/useContests';
import { ContestCard } from './ContestCard';

export function ContestList({ topInset = 0 }: { topInset?: number }) {
  const { C } = useTheme();
  const router = useRouter();
  const { data: contests = [], isLoading, isRefetching, refetch } = useOpenContests();

  if (isLoading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.accent} /></View>;
  }

  if (contests.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP['6'], gap: SP['4'] }}>
        <View style={{ width: 72, height: 72, borderRadius: R.full, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent + '1f' }}>
          <Trophy size={32} color={C.accent} strokeWidth={1.9} />
        </View>
        <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>まだコンテストがありません</Text>
        <Text style={[T.small, { color: C.text3, textAlign: 'center', lineHeight: 20 }]}>勝敗予想・公募・レビューなど、コミュニティでみんなと盛り上がろう。</Text>
        <PressableScale onPress={() => router.push('/contest/create' as never)} haptic="tap"
          style={{ marginTop: SP['1'], paddingVertical: SP['3'], paddingHorizontal: SP['6'], borderRadius: R.full, backgroundColor: C.accent }}>
          <Text style={[T.buttonMd, { color: '#fff' }]}>コンテストを作る</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: topInset + SP['3'], paddingHorizontal: SP['4'], paddingBottom: SP['16'], gap: SP['3'] }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={C.accent} />}
    >
      {contests.map((c) => <ContestCard key={c.id} contest={c} />)}
    </ScrollView>
  );
}
