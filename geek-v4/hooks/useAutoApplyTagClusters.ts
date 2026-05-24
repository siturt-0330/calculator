// ============================================================
// useAutoApplyTagClusters — 高信頼クラスタを自動 accept する hook
// ============================================================
// 概要:
//   ユーザーが settings で「タグ自動グループ化」を ON にしている場合、
//   confidence が AUTO_APPLY_THRESHOLD 以上のクラスタを自動で
//   tagGraph に追加する。手動 accept (SuggestedClusters の「グループ化」ボタン)
//   と同じ動作 — hub を root に、members を child に追加。
//
//   失敗時は createdIds を巻き戻し、toast を出す。
//   成功時は undo 付き toast を出す (ユーザーが意図しない accept を取り消せる)。
//
// 設計:
//   - 同じクラスタを同 session 内で重複 accept しないように
//     `autoAppliedRef` (Set) で track。
//   - state 更新 → cluster 再計算 → そのクラスタは inGraphTags に
//     含まれるため再提案されない。次回 mount でも同じ。
//   - ユーザーが手動で removeNode しても、autoAppliedRef は残るので
//     同じ session 内では auto-apply が再発しない (rage-loop 防止)。
//   - autoApply が OFF のときは何もせず early return。
// ============================================================
import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useTagGraphStore } from '../stores/tagGraphStore';
import { useToastStore } from '../stores/toastStore';
import type { SuggestedCluster } from '../lib/tagClustering/suggest';

// 自動 accept する confidence の下限。
//   0.75 = avgCooccur ≥ ~13 かつ variant ≥ 2、または avgCooccur 非常に高 + variant 少。
//   ユーザーから見て「ほぼ間違いなく同類」レベル。
export const AUTO_APPLY_THRESHOLD = 0.75;

// 1 効果内で auto-apply するクラスタ数の上限。
//   バースト防止 (10 クラスタが一度に作られると undo がしづらい)。
export const AUTO_APPLY_MAX_PER_TICK = 2;

// cluster の identity (SuggestedClusters と一致させる)
function clusterKey(c: SuggestedCluster): string {
  return [c.hub, ...c.tags.slice(1).sort()].join('|');
}

export function useAutoApplyTagClusters({
  clusters,
  hydrated,
}: {
  clusters: SuggestedCluster[];
  hydrated: boolean;
}) {
  const enabled = useSettingsStore((s) => s.autoApplyTagClusters);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);
  const addNode = useTagGraphStore((s) => s.addNode);
  const removeNode = useTagGraphStore((s) => s.removeNode);
  const show = useToastStore((s) => s.show);

  // session-only "既に auto-apply 済み" 集合 — rage-loop 防止
  const autoAppliedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    if (!hydrated) return;
    if (!settingsHydrated) return;
    if (clusters.length === 0) return;

    // 信頼度高い順に並べて上から処理 (suggest.ts 側で既に confidence DESC)
    let appliedThisTick = 0;
    for (const c of clusters) {
      if (appliedThisTick >= AUTO_APPLY_MAX_PER_TICK) break;
      if (c.confidence < AUTO_APPLY_THRESHOLD) continue;
      const key = clusterKey(c);
      if (autoAppliedRef.current.has(key)) continue;

      // mark first — try/catch で失敗しても二重発火しない
      autoAppliedRef.current.add(key);

      const createdIds: string[] = [];
      try {
        const hubId = addNode(c.hub, null);
        createdIds.push(hubId);
        for (const tag of c.tags) {
          if (tag === c.hub) continue;
          createdIds.push(addNode(tag, hubId));
        }
        appliedThisTick++;
        // success — undo 付き toast
        show(
          `「${c.hub}」グループを自動作成しました (${c.tags.length} タグ)`,
          'success',
          {
            undoLabel: '元に戻す',
            onUndo: () => {
              for (const id of createdIds) {
                try { removeNode(id); } catch { /* ignore */ }
              }
            },
            duration: 5000,
          },
        );
      } catch (e) {
        // 失敗 — 巻き戻し
        for (const id of createdIds) {
          try { removeNode(id); } catch { /* ignore */ }
        }
        console.warn('[useAutoApplyTagClusters] auto-apply failed:', e);
        // 致命的でなければ silent (ユーザーに毎回 error toast を出さない)
      }
    }
  }, [enabled, hydrated, settingsHydrated, clusters, addNode, removeNode, show]);
}
