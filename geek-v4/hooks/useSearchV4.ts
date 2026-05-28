// ============================================================
// hooks/useSearchV4.ts — search_posts_v4 / 周辺 RPC の RQ wrapper
// ------------------------------------------------------------
// lib/api/searchV4.ts (C1 並列で実装中) の薄い React Query v5 wrapper。
//   - useSearchV4              : v4 検索 (diversify / sign election 制御つき)
//   - useQueryIntent           : クエリ意図分類 (informational / navigational / etc.)
//   - useActiveRankingWeights  : 現在 active な ranking weight 全体
//   - useWeightsForQuery       : クエリに対する重みづけ (intent 反映後)
//   - useResultExplanation     : 1 件の結果がなぜ出たかの factor breakdown
//   - useLogSearchEngagement   : クリック/skip ログを fire-and-forget で送る mutation
//   - useMultiTaskRanking      : 設定 UI 用に active weight を購読する compound hook
//
// staleTime 設計:
//   - search           : 30s        (入力中の連打を吸収。短くしすぎると thrash)
//   - queryIntent      : 5min       (同一クエリの intent はほぼ変わらない)
//   - rankingWeights   : 10min      (weight 変更は admin のみで頻度低)
//   - resultExplanation: 5min       (同じ post×query の説明は安定。modal 開閉で
//                                     refetch しないよう長めに)
//
// placeholderData = keepPreviousData:
//   タイプ中に query が変わって enabled が再評価されても、前回結果を保持して
//   "0 件 flicker" を防ぐ (useSearchV2 と同じ戦略)。
// ============================================================

import {
  keepPreviousData,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  classifyQueryIntent,
  explainSearchResult,
  getActiveRankingWeights,
  getWeightsForQuery,
  logSearchEngagement,
  searchPostsV4,
  type ActiveWeights,
  type QueryIntent,
  type ResultExplanation,
  type SearchV4Args,
  type SearchV4Result,
} from '../lib/api/searchV4';

// log API は object 引数を受けるので、その型を hook 用に再 export 用エイリアス化。
export type LogSearchEngagementArgs = Parameters<typeof logSearchEngagement>[0];

// ----------------------------------------------------------------
// 1) useSearchV4 — 投稿検索 (v4)
// ----------------------------------------------------------------

/**
 * v4 検索フック。空クエリは disable、staleTime 30s。
 *
 * - `query.trim().length > 0` のときだけ enable
 * - `placeholderData=keepPreviousData` で flicker 回避
 * - queryKey に全 args を含めるので diversify / sign_election の toggle で
 *   別 cache entry が立つ (UI 上は同じクエリでも条件違いを区別)
 */
export function useSearchV4(args: {
  query: string;
  limit?: number;
  offset?: number;
  community_id?: string;
  use_diversify?: boolean;
  use_sign_election?: boolean;
}): UseQueryResult<SearchV4Result[]> {
  const query = args.query.trim();
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;
  const community_id = args.community_id;
  const use_diversify = args.use_diversify;
  const use_sign_election = args.use_sign_election;

  const rpcArgs: SearchV4Args = {
    query,
    limit,
    offset,
    community_id,
    use_diversify,
    use_sign_election,
  };

  return useQuery<SearchV4Result[]>({
    queryKey: [
      'searchV4',
      query,
      limit,
      offset,
      community_id ?? null,
      use_diversify ?? null,
      use_sign_election ?? null,
    ],
    queryFn: () => searchPostsV4(rpcArgs),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// ----------------------------------------------------------------
// 2) useQueryIntent — クエリ意図分類
// ----------------------------------------------------------------

/**
 * クエリの intent 推定。
 *
 * 入力が同じ間 intent はほぼ変わらないため staleTime 5min。
 * 空クエリは disable (RPC を叩かない)。
 */
export function useQueryIntent(query: string): UseQueryResult<QueryIntent[]> {
  const trimmed = query.trim();
  return useQuery<QueryIntent[]>({
    queryKey: ['searchV4', 'queryIntent', trimmed],
    queryFn: () => classifyQueryIntent(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 5 * 60_000,
  });
}

// ----------------------------------------------------------------
// 3) useActiveRankingWeights — グローバルな active weight
// ----------------------------------------------------------------

/**
 * 現在 active な ranking weight 全体を取得。
 *
 * - weight 変更は admin 操作で稀 → staleTime 10min
 * - 設定 UI / debug overlay などからの呼び出しを想定
 */
export function useActiveRankingWeights(): UseQueryResult<ActiveWeights> {
  return useQuery<ActiveWeights>({
    queryKey: ['searchV4', 'activeRankingWeights'],
    queryFn: () => getActiveRankingWeights(),
    staleTime: 10 * 60_000,
  });
}

// ----------------------------------------------------------------
// 4) useWeightsForQuery — クエリに対する重み (intent 反映後)
// ----------------------------------------------------------------

/**
 * クエリに対して適用される重みを返す。
 *
 * server 側で intent によって base weight を上書きしたものを返す想定。
 * staleTime はベース weight 同様 10min。
 */
export function useWeightsForQuery(query: string): UseQueryResult<ActiveWeights> {
  const trimmed = query.trim();
  return useQuery<ActiveWeights>({
    queryKey: ['searchV4', 'weightsForQuery', trimmed],
    queryFn: () => getWeightsForQuery(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 10 * 60_000,
  });
}

// ----------------------------------------------------------------
// 5) useResultExplanation — 1 件の結果の説明
// ----------------------------------------------------------------

/**
 * 「この結果について」modal で使う詳細説明。
 *
 * - `enabled` prop で外部制御 (modal が開いたときだけ fetch)
 * - include_advanced=true で score breakdown まで取りに行く重い版
 * - 同じ (post, query) の説明は安定なので staleTime 5min
 */
export function useResultExplanation(args: {
  post_id: string;
  query: string;
  include_advanced?: boolean;
  enabled?: boolean;
}): UseQueryResult<ResultExplanation> {
  const { post_id, query, include_advanced, enabled = true } = args;
  const trimmedQuery = query.trim();

  return useQuery<ResultExplanation>({
    queryKey: [
      'searchV4',
      'resultExplanation',
      post_id,
      trimmedQuery,
      include_advanced ?? false,
    ],
    queryFn: () => explainSearchResult(post_id, trimmedQuery, include_advanced),
    enabled: enabled && post_id.length > 0 && trimmedQuery.length > 0,
    staleTime: 5 * 60_000,
  });
}

// ----------------------------------------------------------------
// 6) useLogSearchEngagement — クリック / skip ログ (fire-and-forget)
// ----------------------------------------------------------------

/**
 * 検索結果のクリック / dwell / skip を server に通知する mutation。
 *
 * - fire-and-forget: 失敗しても UI は止めない (onError は swallow)
 * - 連発するため retry は 0 (lib 側でも noop で固める想定)
 * - 戻り値 void: server からの ack は不要 (analytics 用)
 */
export function useLogSearchEngagement(): UseMutationResult<
  void,
  Error,
  LogSearchEngagementArgs,
  unknown
> {
  return useMutation<void, Error, LogSearchEngagementArgs, unknown>({
    mutationFn: (args) => logSearchEngagement(args),
    retry: 0,
    onError: () => {
      // fire-and-forget — 失敗は無視 (lib 側で swallow 済み)
    },
  });
}

// ----------------------------------------------------------------
// 7) useMultiTaskRanking — 設定 UI 用 compound hook
// ----------------------------------------------------------------

export type UseMultiTaskRankingResult = {
  weights: ActiveWeights | undefined;
  isLoading: boolean;
  refetch: () => void;
};

/**
 * 設定 UI で「現在の active weight」をリアルタイム表示するための compound hook。
 *
 * - `useActiveRankingWeights` を内部で使う薄い wrapper
 * - 設定画面の "今こんなバランスです" 表示に使い、admin が weight を変えた直後に
 *   `refetch()` を叩いて即時反映する想定
 * - 戻り値を絞ることで UI 側の依存を最小化 (UseQueryResult 全部見えると過剰)
 */
export function useMultiTaskRanking(): UseMultiTaskRankingResult {
  const q = useActiveRankingWeights();
  return {
    weights: q.data,
    isLoading: q.isLoading,
    refetch: () => {
      void q.refetch();
    },
  };
}
