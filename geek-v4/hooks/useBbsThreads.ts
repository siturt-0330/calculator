// ============================================================
// hooks/useBbsThreads.ts — BBS スレッド一覧の統合フック
// ------------------------------------------------------------
// bbs.tsx から抽出した 3 つの懸念事項をひとつのフックにまとめる:
//
//   1. スコープ管理 (useBBSScope 相当):
//      - scopeRaw: ユーザーが明示的に切り替えた Scope (null = 動的 default)
//      - effectiveScope: null の間はコミュ参加状況で自動選択 → 切替後は固定
//
//   2. スレッドデータ取得:
//      - effectiveScope='community' → useMyCommunityBBS
//      - effectiveScope='all'       → useBBS
//      - loading / refreshing / refresh / hasJoinedCommunities を統合
//
//   3. コミュニティメタ一括 fetch (CLAUDE.md §14 準拠):
//      - supabase.from() を component から直叩きせず lib/api/ 経由
//      - communityIds 変化時に自動再 fetch (staleTime 5min)
//
// 返却値:
//   threads, loading, refreshing, refresh         — スレッドデータ
//   effectiveScope, setScope                      — スコープ切替
//   hasJoinedCommunities                          — empty state の出し分け用
//   communityMeta                                 — community badge 表示用
//
// 使い方:
//   const { threads, loading, effectiveScope, setScope, communityMeta } = useBbsThreads();
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBBS, useMyCommunityBBS } from './useBBS';
import { fetchCommunityMeta, type CommunityMeta } from '../lib/api/communities';

/** BBS スレッド一覧タブの表示スコープ */
export type Scope = 'community' | 'all';

/**
 * BBS スレッド一覧 + スコープ + コミュニティメタを束ねた統合フック。
 * bbs.tsx の BBSScreen から抽出 — component は表示ロジックのみに集中できる。
 */
// 参照安定の空メタ — communityMetaQ.data 未取得時に毎 render 新規 {} を作らない (FlashList extraData churn 防止)
const EMPTY_META: Record<string, CommunityMeta> = {};

export function useBbsThreads() {
  // ----- 全スレッド / 参加コミュ横断スレッドを両方 mount -----
  // どちらのスコープに切り替えてもデータがキャッシュ済みで即表示できるよう、
  // scope に関係なく両フックを常に呼ぶ。RQ の staleTime 30s が過剰 fetch を防ぐ。
  const allBbs = useBBS();
  const myBbs = useMyCommunityBBS();

  // ----- スコープ管理 -----
  // null = 動的 default: myBbs.loading 中は 'community' を仮表示し、
  // loading 完了後に参加状況で自動選択する (ユーザーの意思が介在する前)。
  // setScope 後は null → 固定値に変わり以降はユーザーの選択が維持される。
  const [scopeRaw, setScopeRaw] = useState<Scope | null>(null);
  const effectiveScope: Scope =
    scopeRaw ?? (myBbs.loading ? 'community' : myBbs.hasJoinedCommunities ? 'community' : 'all');

  // useCallback で安定化 — scope toggle ボタンに渡す onPress の identity を固定
  const setScope = useCallback((s: Scope) => setScopeRaw(s), []);

  // ----- スコープに応じたデータソースを選択 -----
  const scopedSource = effectiveScope === 'community' ? myBbs : allBbs;
  const { threads, loading, refreshing, refresh } = scopedSource;
  const hasJoinedCommunities = 'hasJoinedCommunities' in myBbs ? myBbs.hasJoinedCommunities : false;

  // ----- コミュニティメタ一括 fetch -----
  // 表示中スレッドの community_id を集めて一括 lookup する (N+1 防止)。
  // threads が変わった時だけ communityIds を再計算し、1 リクエストで全バッジ分を取得。
  const communityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of threads) {
      if (t.community_id) ids.add(t.community_id);
    }
    // Array.from(set).sort() で key が安定 (RQ が同一 cache を使える)
    return Array.from(ids).sort();
  }, [threads]);

  const communityMetaQ = useQuery({
    queryKey: ['bbs-thread-communities', communityIds],
    queryFn: () => fetchCommunityMeta(communityIds),
    enabled: communityIds.length > 0,
    staleTime: 5 * 60 * 1000, // コミュ名/アイコンは頻繁に変わらないので 5min キャッシュ
  });
  const communityMeta: Record<string, CommunityMeta> = communityMetaQ.data ?? EMPTY_META;

  return {
    /** 表示中のスレッド一覧 (scope + filter 適用済み) */
    threads,
    /** 初回ロード中 (skeleton 表示判断に使う) */
    loading,
    /** pull-to-refresh 中 */
    refreshing,
    /** pull-to-refresh トリガ */
    refresh,
    /** 現在の表示スコープ ('community' | 'all') */
    effectiveScope,
    /** スコープを切り替える (呼び出し後は scopeRaw に固定される) */
    setScope,
    /** コミュニティスコープで参加コミュが 0 件かどうか (empty state 判定用) */
    hasJoinedCommunities,
    /**
     * community_id → { name, icon_emoji } のマッピング。
     * 遅延 fetch なので初回 render 時は空オブジェクト。
     * FlashList の extraData に渡して遅延 fetch 完了時に再 render させること。
     */
    communityMeta,
  };
}
