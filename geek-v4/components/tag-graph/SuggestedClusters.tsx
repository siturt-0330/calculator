// ============================================================
// SuggestedClusters — タグ自動グルーピング候補の UI
// ============================================================
// 表示:
//   各クラスタを 1 カードずつ:
//     [hub タグ (大)]
//     [member chip 1] [member chip 2] ...
//     confidence: ★★★ + signals
//     [✓ グループ化]  [× スキップ]
//
// 操作:
//   - グループ化: tagGraphStore.addNode で hub を root に、各 member を child に追加
//                 toast で「○○ グループを作成しました」+ 「元に戻す」
//   - スキップ:   このセッション中だけ隠す (localState)
// ============================================================
import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useTagGraphStore } from '../../stores/tagGraphStore';
import { useToastStore } from '../../stores/toastStore';
import type { SuggestedCluster } from '../../lib/tagClustering/suggest';

export function SuggestedClusters({
  clusters,
  hydrated,
}: {
  clusters: SuggestedCluster[];
  hydrated: boolean;
}) {
  const addNode = useTagGraphStore((s) => s.addNode);
  const removeNode = useTagGraphStore((s) => s.removeNode);
  const show = useToastStore((s) => s.show);
  // セッション内のみ覚える skip 集合 (永続化不要 — リロードで戻る)
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const visible = clusters.filter((c) => !skipped.has(clusterKey(c)));

  if (!hydrated) return null;     // 共起データ未取得時は何も出さない
  if (visible.length === 0) return null;

  const onAccept = (cluster: SuggestedCluster) => {
    // hub を root として追加 → 各 member を child として追加
    // 失敗時に巻き戻せるよう createdIds を集める
    const createdIds: string[] = [];
    try {
      const hubId = addNode(cluster.hub, null);
      createdIds.push(hubId);
      for (const tag of cluster.tags) {
        if (tag === cluster.hub) continue;
        const childId = addNode(tag, hubId);
        createdIds.push(childId);
      }
      // skip 集合に入れる (次回提案から除外)
      setSkipped((s) => {
        const next = new Set(s);
        next.add(clusterKey(cluster));
        return next;
      });
      show(
        `「${cluster.hub}」グループを作成しました (${cluster.tags.length} タグ)`,
        'success',
      );
    } catch (e) {
      console.warn('[SuggestedClusters] accept failed:', e);
      // 部分成功でも巻き戻し
      for (const id of createdIds) {
        try { removeNode(id); } catch { /* ignore */ }
      }
      show('グループ作成に失敗しました', 'error');
    }
  };

  const onSkip = (cluster: SuggestedCluster) => {
    setSkipped((s) => {
      const next = new Set(s);
      next.add(clusterKey(cluster));
      return next;
    });
  };

  return (
    <View style={{ gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 14 }}>💡</Text>
        <Text style={[T.smallM, { color: C.text, fontWeight: '800' }]}>
          自動グルーピング候補
        </Text>
        <Text style={[T.caption, { color: C.text3 }]}>
          ({visible.length})
        </Text>
      </View>
      <View style={{ gap: SP['2'] }}>
        {visible.map((c) => (
          <Animated.View
            key={clusterKey(c)}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            layout={Layout.springify().damping(20)}
            style={{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.accentSoft,
              gap: SP['2'],
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={{ fontSize: 18 }}>📁</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[T.bodyB, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                  {c.hub}
                </Text>
                <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                  {confidenceLabel(c.confidence)} ・ {signalSummary(c)}
                </Text>
              </View>
            </View>

            {/* member タグ chip 列 */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {c.tags.slice(1).map((m) => (
                <View
                  key={m}
                  style={{
                    paddingHorizontal: SP['2'], paddingVertical: 3,
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.accentSoft,
                  }}
                >
                  <Text style={[T.caption, { color: C.accentLight }]}>{m}</Text>
                </View>
              ))}
            </View>

            {/* action 列 */}
            <View style={{ flexDirection: 'row', gap: SP['2'], marginTop: 2 }}>
              <PressableScale
                onPress={() => onAccept(c)}
                haptic="confirm"
                style={{
                  flex: 1,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                  paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                  backgroundColor: C.accent, borderRadius: R.full,
                }}
              >
                <Icon.ok size={12} color="#fff" strokeWidth={2.6} />
                <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>グループ化</Text>
              </PressableScale>
              <PressableScale
                onPress={() => onSkip(c)}
                haptic="tap"
                style={{
                  paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                  backgroundColor: C.bg3, borderRadius: R.full,
                  borderWidth: 1, borderColor: C.border,
                }}
              >
                <Text style={[T.smallM, { color: C.text2 }]}>スキップ</Text>
              </PressableScale>
            </View>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

// ============================================================
// helpers
// ============================================================
function clusterKey(c: SuggestedCluster): string {
  // hub + sorted members を JOIN — クラスタの identity
  return [c.hub, ...c.tags.slice(1).sort()].join('|');
}

function confidenceLabel(c: number): string {
  if (c >= 0.7) return '★★★ 高信頼';
  if (c >= 0.5) return '★★ 中信頼';
  return '★ 弱め';
}

function signalSummary(c: SuggestedCluster): string {
  const parts: string[] = [];
  if (c.signals.avgCooccur > 0) {
    parts.push(`共起 ${c.signals.avgCooccur.toFixed(1)}`);
  }
  if (c.signals.variantPairs > 0) {
    parts.push(`同義 ${c.signals.variantPairs}`);
  }
  parts.push(`${c.signals.memberCount} タグ`);
  return parts.join(' ・ ');
}
