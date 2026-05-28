// ============================================================
// lib/api/searchPreferences.ts — 検索パーソナライズ設定 API
// ------------------------------------------------------------
// 役割:
//   - user_search_preferences テーブルの CRUD (取得 / 更新)
//   - RPC clear_search_history で履歴一掃
//   - RPC get_result_explanation で「この結果について」factors を取得
//
// 並列 D1 / C1 で migration 0084 (user_search_preferences) と
// migration 0085 (RPC) を追加する想定。本ファイルは UI 側 wrapper のみ。
// error 時は default を返すことで「設定が落ちて検索が死ぬ」事故を避ける。
// ============================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { swallow } from '../swallow';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export type SearchPreferences = {
  personalization_enabled: boolean;
  use_location: boolean;
  use_history: boolean;
  diversify_results: boolean;
};

/**
 * 既定値 — 「履歴と多様化は ON、位置情報は OFF (opt-in)」が標準。
 * - personalization_enabled: 全体 master switch
 * - use_history: 過去の検索を参考に最適化 (default ON)
 * - use_location: 現在地に応じた結果 (default OFF, opt-in)
 * - diversify_results: 同じ視点の繰り返しを避ける (default ON)
 */
export const DEFAULT_PREFERENCES: SearchPreferences = {
  personalization_enabled: true,
  use_location: false,
  use_history: true,
  diversify_results: true,
};

/**
 * 「この結果について」で表示する 1 つの要因。
 * - factor: 表示名 (例: "最近の投稿" "あなたが見た投稿")
 * - weight: 0-1 normalized。bar の長さに使う
 * - description: 1 行の説明
 */
export type ResultFactor = {
  factor: string;
  weight: number;
  description: string;
};

// ----------------------------------------------------------------
// Get / Update
// ----------------------------------------------------------------

/**
 * 自分の検索 preferences を取得する。
 *
 * - 未ログイン or 行が無い → DEFAULT_PREFERENCES
 * - エラー時 → DEFAULT_PREFERENCES + swallow breadcrumb
 *   (検索 UI を絶対に止めないため fail-safe)
 */
export async function getSearchPreferences(): Promise<SearchPreferences> {
  try {
    const { data, error } = await withApiTimeout(
      supabase.from('user_search_preferences').select('*').maybeSingle(),
      'searchPreferences.get',
      8000,
    );
    if (error || !data) {
      if (error) swallow('searchPreferences.get', error);
      return DEFAULT_PREFERENCES;
    }
    return {
      personalization_enabled: data.personalization_enabled ?? true,
      use_location: data.use_location ?? false,
      use_history: data.use_history ?? true,
      diversify_results: data.diversify_results ?? true,
    };
  } catch (e) {
    swallow('searchPreferences.get.timeout', e);
    return DEFAULT_PREFERENCES;
  }
}

/**
 * 部分更新 (upsert) — 未指定フィールドは触らない。
 *
 * 未ログインなら no-op。auth.getUser() の結果が null の場合は static に return
 * することで「ログアウト直後の race」で 401 ループに陥らないようにする。
 */
export async function updateSearchPreferences(
  prefs: Partial<SearchPreferences>,
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;

  try {
    const { error } = await withApiTimeout(
      supabase.from('user_search_preferences').upsert({
        user_id: user.id,
        ...prefs,
        updated_at: new Date().toISOString(),
      }),
      'searchPreferences.update',
      8000,
    );
    if (error) throw error;
  } catch (e) {
    swallow('searchPreferences.update', e);
    throw e;
  }
}

// ----------------------------------------------------------------
// Side effects (RPC)
// ----------------------------------------------------------------

/**
 * サーバー側の検索履歴を消去する (RPC: clear_search_history)。
 *
 * クライアント側の autocomplete / store はこの呼び出しの後、別経路で
 * clearAll() してもらう想定。本関数はサーバー側のみを扱う。
 * error 時は swallow して throw — UI 側で toast を出すために伝播させる。
 */
export async function clearSearchHistory(): Promise<void> {
  try {
    const { error } = await withApiTimeout(
      supabase.rpc('clear_search_history'),
      'searchPreferences.clearHistory',
      8000,
    );
    if (error) throw error;
  } catch (e) {
    swallow('searchPreferences.clearHistory', e);
    throw e;
  }
}

/**
 * ある結果がなぜ表示されたかを RPC で取得する。
 *
 * - 失敗 / 空応答 → [] (UI 側で「説明がありません」表示)
 * - timeout は 6s (UI は bottom sheet で待たせる前提なので短め)
 */
export async function getResultExplanation(
  postId: string,
  query: string,
): Promise<ResultFactor[]> {
  try {
    const { data, error } = await withApiTimeout(
      supabase.rpc('get_result_explanation', {
        p_post_id: postId,
        p_query: query,
      }),
      'searchPreferences.getResultExplanation',
      6000,
    );
    if (error) {
      swallow('searchPreferences.getResultExplanation', error);
      return [];
    }
    const rows = (data ?? []) as Array<{
      factor?: unknown;
      weight?: unknown;
      description?: unknown;
    }>;
    return rows
      .map((r): ResultFactor | null => {
        const factor = typeof r.factor === 'string' ? r.factor : null;
        const weight = typeof r.weight === 'number' ? r.weight : null;
        const description = typeof r.description === 'string' ? r.description : '';
        if (factor === null || weight === null) return null;
        // weight を 0..1 に clip して bar 描画を安全にする
        const w = Math.max(0, Math.min(1, weight));
        return { factor, weight: w, description };
      })
      .filter((r): r is ResultFactor => r !== null);
  } catch (e) {
    swallow('searchPreferences.getResultExplanation.timeout', e);
    return [];
  }
}
