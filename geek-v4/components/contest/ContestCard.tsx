// =============================================================================
// components/contest/ContestCard.tsx — コンテスト1件のカード(一覧/コミュホーム共用)
// -----------------------------------------------------------------------------
// kicker(種類) + 太字タイトル + 状態(受付中/集計中/結果発表・期限なし対応) + chevron。
// タップで /contest/[id] へ。ContestList とコミュ詳細ホームのカルーセルで共用。
// =============================================================================

import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';

import { useTheme } from '../../hooks/useColors';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { derivePhase, flagsToPreset, type Contest, type ContestPreset } from '../../lib/api/contests';

const PINK = '#E891C7';
const KICKER: Record<ContestPreset, string> = {
  prediction: '予想', poll: 'アンケート', submission: '公募', review: 'レビュー', hybrid: 'ハイブリッド',
};

function untilLabel(target: string | null): string {
  if (!target) return '';
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return '締切';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `あと${min}分`;
  const h = Math.floor(min / 60);
  if (h < 24) return `あと${h}時間`;
  return `あと${Math.floor(h / 24)}日`;
}

export function contestStatus(c: Contest, accent: string, dim: string): { text: string; tone: string } {
  if (c.voided) return { text: '中止', tone: dim };
  const phase = derivePhase(c);
  if (phase === 'open') return { text: `受付中${c.lock_at ? `・${untilLabel(c.lock_at)}` : '・期限なし'}`, tone: accent };
  if (c.has_submission && (!c.result_at || new Date() < new Date(c.result_at))) return { text: `投票受付中${c.result_at ? `・${untilLabel(c.result_at)}` : ''}`, tone: accent };
  if (phase === 'result') return { text: '結果発表', tone: PINK };
  return { text: '集計中', tone: dim };
}

export function ContestCard({ contest, compact = false }: { contest: Contest; compact?: boolean }) {
  const { C } = useTheme();
  const router = useRouter();
  const preset = flagsToPreset(contest);
  const st = contestStatus(contest, C.accent, C.text3);
  return (
    <PressableScale onPress={() => router.push(`/contest/${contest.id}` as never)} haptic="tap"
      style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2, padding: SP['4'], flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[T.captionM, { color: C.accent, letterSpacing: 0.6 }]}>{KICKER[preset]}</Text>
        <Text style={[T.h4, { color: C.text }]} numberOfLines={compact ? 1 : 2}>{contest.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'], marginTop: 2 }}>
          <View style={{ width: 6, height: 6, borderRadius: R.full, backgroundColor: st.tone }} />
          <Text style={[T.caption, { color: st.tone }]}>{st.text}</Text>
        </View>
      </View>
      <ChevronRight size={20} color={C.text4} strokeWidth={2} />
    </PressableScale>
  );
}
