// ============================================================
// useTagClusterSuggestions — タグ自動グルーピング候補を購読
// ============================================================
// 入力ソース:
//   - useTagFilterStore.likedTags    : 「好き」と明示登録したタグ
//   - useTagGraphStore.nodes         : 既存ノード (除外用)
//   - useTagCooccurStore.cooccur     : 共起マトリクス
//
// 出力:
//   - clusters: SuggestedCluster[]
//   - hydrated: boolean (cooccur が hydrate 済みか)
//
// 設計メモ:
//   - クラスタ計算は cooccur が無いと無意味 → cooccur.hydrate を待つ
//   - 結果は useMemo で安定化 (likedTags/nodes/cooccur が変わるまで再計算しない)
//   - クライアントオンリー: 追加の DB クエリは無い
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useTagFilterStore } from '../stores/tagFilterStore';
import { useTagGraphStore } from '../stores/tagGraphStore';
import { useTagCooccurStore } from '../stores/tagCooccurStore';
import { suggestClusters, type SuggestedCluster } from '../lib/tagClustering/suggest';
import { runWhenIdle } from '../lib/scheduler';

export function useTagClusterSuggestions(opts?: { maxClusters?: number }): {
  clusters: SuggestedCluster[];
  hydrated: boolean;
} {
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const nodes = useTagGraphStore((s) => s.nodes);
  const cooccur = useTagCooccurStore((s) => s.cooccur);
  const cooccurHydrated = useTagCooccurStore((s) => s.hydrated);
  const hydrateCooccur = useTagCooccurStore((s) => s.hydrate);
  const ensureFresh = useTagCooccurStore((s) => s.ensureFresh);

  // 1 回だけ hydrate + 必要なら refresh
  useEffect(() => {
    void hydrateCooccur();
  }, [hydrateCooccur]);
  useEffect(() => {
    if (cooccurHydrated) void ensureFresh();
  }, [cooccurHydrated, ensureFresh]);

  // 既存ノードの labels + aliases + related を 1 つの set に
  // (グラフに既に登録済みのタグは提案から除外する)
  const inGraphTags = useMemo(() => {
    const s = new Set<string>();
    for (const n of Object.values(nodes)) {
      if (n?.label) s.add(n.label);
      for (const a of n?.aliases ?? []) s.add(a);
      for (const r of n?.related ?? []) s.add(r);
    }
    return s;
  }, [nodes]);

  // interestTags = likedTags ∪ (graph 内 root の label) のうち、まだグループ化されていない物
  // ※ inGraphTags 全部を抜くと「ホロライブ」みたいに 1 つだけ root にあるタグも候補に上がらない
  //    今は単純に likedTags + graph 内 root labels から取る
  const interestTags = useMemo(() => {
    const arr: string[] = [...likedTags];
    // root ノードのラベルも興味タグ扱い
    for (const n of Object.values(nodes)) {
      if (n?.label) arr.push(n.label);
    }
    return arr;
  }, [likedTags, nodes]);

  // suggestClusters は O(N²) (N = interest タグ数, 最大 50 → 2500 ペア比較)。
  // 入力が変わらなければ再計算しないが、初回 hydrate 直後は重い (~10-30ms).
  // useEffect + runWhenIdle で 1tick 遅延させ、UI スレッドを開ける。
  //
  // 入力 hash を 1 string に圧縮して deep deps を安定化。
  const inputKey = useMemo(() => {
    if (!cooccurHydrated) return '';
    if (interestTags.length < 3) return '';
    return [
      interestTags.length,
      interestTags.slice(0, 20).join('|'),
      inGraphTags.size,
      Object.keys(cooccur).length,
      opts?.maxClusters ?? 5,
    ].join(';');
  }, [cooccurHydrated, interestTags, inGraphTags, cooccur, opts?.maxClusters]);

  const [clustersState, setClustersState] = useState<{ key: string; clusters: SuggestedCluster[] }>({
    key: '',
    clusters: [],
  });

  useEffect(() => {
    if (!inputKey) {
      // 入力が無いなら state も空に
      if (clustersState.key !== '') setClustersState({ key: '', clusters: [] });
      return;
    }
    if (clustersState.key === inputKey) return; // 同じ入力で計算済み

    const handle = runWhenIdle(() => {
      const result = suggestClusters({
        interestTags,
        cooccur,
        inGraphTags,
        maxClusters: opts?.maxClusters ?? 5,
      });
      setClustersState({ key: inputKey, clusters: result });
    }, { timeoutMs: 1000 });

    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, interestTags, cooccur, inGraphTags, opts?.maxClusters]);

  return { clusters: clustersState.clusters, hydrated: cooccurHydrated };
}
