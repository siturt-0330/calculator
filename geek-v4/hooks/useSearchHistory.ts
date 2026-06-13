// ============================================================
// useSearchHistory — 既存の searchHistoryStore + autocomplete を統合した hook
// ------------------------------------------------------------
// 役割:
//   - 検索画面 UI (SearchFocusOverlay など) が必要とする「履歴 list +
//     pick / remove / clear」を 1 つの hook で提供する
//   - 既存 lib/search/autocomplete.ts の LRU (200 件) は MMKV/localStorage に
//     永続化されており「より長い履歴」になっている — それを wrap して、
//     UI が "最近の検索 (= 直近 N 件、display 表記)" を直接読めるようにする
//   - 既存の `useSearchHistoryStore` (短期 12 件、ts 付き) は UI の "短期表示"
//     用に併用する
//
// API 維持の制約:
//   - autocomplete.ts の保存先 (geek.search.autocomplete.v1) は変えない
//   - searchHistoryStore (geek:search_history / _v2) も変えない
//   - 全ての mutation は両方のストアに同期する (display を残すため)
// ============================================================
import { useCallback, useMemo } from 'react';
import { useSearchHistoryStore } from '../stores/searchHistoryStore';
import {
  loadQueryStats,
  saveQueryStats,
  recordQuery,
  clearQueryStats,
  type QueryStatMap,
} from '../lib/search/autocomplete';
import { deepNormalize } from '../lib/search/tokenize';
import { swallow } from '../lib/swallow';

export interface UseSearchHistoryResult {
  /** 直近 limit 件の検索ワード (重複除去、新しい順) */
  history: string[];
  /** 履歴へ 1 件追加 (debounce 経由ではなく commit 時に呼ぶ想定) */
  pickQuery: (raw: string) => void;
  /** 1 件削除 */
  removeQuery: (raw: string) => void;
  /** 全削除 */
  clearAll: () => void;
}

/**
 * 検索履歴の読み書き hook。
 *
 * @param limit chips に並べる最大件数 (既定 10)
 *
 * 内部:
 *   1. useSearchHistoryStore の `history` (短期 12 件) を先に並べる
 *   2. autocomplete.ts の `loadQueryStats()` の lastUsed 降順を merge
 *      (display を優先しつつ、key の正規化で dedupe)
 *   3. limit で打ち切る
 */
export function useSearchHistory(limit = 10): UseSearchHistoryResult {
  const storeHistory = useSearchHistoryStore((s) => s.history);
  const storeAdd = useSearchHistoryStore((s) => s.add);
  const storeRemove = useSearchHistoryStore((s) => s.remove);
  const storeClear = useSearchHistoryStore((s) => s.clear);

  // history は store の re-render を trigger にして memoize
  // (autocomplete の永続 stats はキーストロークごとには変わらないと仮定し、
  //  store 履歴に追従して再計算するだけで十分)
  const history = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();

    const pushIfNew = (raw: string): boolean => {
      const q = (raw ?? '').trim();
      if (!q) return false;
      const key = deepNormalize(q) || q.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      out.push(q);
      return true;
    };

    // 1) store の history (12 件、新しい順) を最優先
    for (const h of storeHistory) {
      if (out.length >= limit) break;
      pushIfNew(h);
    }

    // 2) autocomplete の永続 stats (lastUsed 降順) で補完
    if (out.length < limit) {
      try {
        const stats: QueryStatMap = loadQueryStats();
        const entries = Object.entries(stats)
          .sort((a, b) => b[1].lastUsed - a[1].lastUsed);
        for (const [key, stat] of entries) {
          if (out.length >= limit) break;
          const display = (stat.display ?? key).trim();
          if (!display) continue;
          pushIfNew(display);
        }
      } catch (e) {
        swallow('useSearchHistory.loadStats', e);
      }
    }

    return out.slice(0, limit);
  }, [storeHistory, limit]);

  /** 1 件追加 — 短期 store + 永続 stats の両方に書く */
  const pickQuery = useCallback((raw: string) => {
    const q = (raw ?? '').trim();
    if (!q) return;
    // 短期 store (UI 即時反映)
    storeAdd(q);
    // 永続 stats (頻度 / lastUsed 集計)
    try {
      recordQuery(q);
    } catch (e) {
      swallow('useSearchHistory.recordQuery', e);
    }
  }, [storeAdd]);

  /** 1 件削除 — 両ストアから削る */
  const removeQuery = useCallback((raw: string) => {
    const q = (raw ?? '').trim();
    if (!q) return;
    storeRemove(q);
    // 永続 stats からも削る (key は deepNormalize されている)
    try {
      const stats = loadQueryStats();
      const key = deepNormalize(q) || q;
      // display 一致 (key と異なる場合) もケアする
      let mutated = false;
      if (stats[key]) {
        delete stats[key];
        mutated = true;
      }
      for (const [k, v] of Object.entries(stats)) {
        if (v.display && deepNormalize(v.display) === (deepNormalize(q) || q)) {
          delete stats[k];
          mutated = true;
        }
      }
      if (mutated) saveQueryStats(stats);
    } catch (e) {
      swallow('useSearchHistory.removeQuery', e);
    }
  }, [storeRemove]);

  /** 全削除 — 両ストアを空に */
  const clearAll = useCallback(() => {
    storeClear();
    try {
      clearQueryStats();
    } catch (e) {
      swallow('useSearchHistory.clearAll', e);
    }
  }, [storeClear]);

  return { history, pickQuery, removeQuery, clearAll };
}
