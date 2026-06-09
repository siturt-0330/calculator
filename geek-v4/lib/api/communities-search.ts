// ============================================================
// lib/api/communities-search.ts — コミュニティ検索 / 探索 API
// ------------------------------------------------------------
// communities.ts から分割。検索・探索に特化した関数群:
//   - searchByName        : 作成時の重複防止用 ilike 検索
//   - fetchOfficialCommunities : 公式コミュ一覧
//   - fetchRisingCommunities   : 急上昇コミュ (last_post_at 降順)
//   - discoverCommunities      : searchCommunities への薄いラッパ (後方互換)
//   - searchCommunities        : マッチ理由 + スコア付き高機能検索
//
// generateVariants / findSimilar を使う唯一のモジュール。
// ============================================================

import { supabase } from '../supabase';
import { generateVariants } from '../search/variants';
import { findSimilar } from '../search/similarity';
import type { Community } from './communities-core';

// ============================================================
// PostgREST or() 文法と ilike を破壊する文字をエスケープ
// ============================================================
function escapeForIlike(s: string): string {
  return s
    .replace(/\\/g, '\\\\')      // backslash 先
    .replace(/%/g, '\\%')         // ilike wildcard
    .replace(/_/g, '\\_')         // ilike wildcard
    .replace(/[,()]/g, '');       // PostgREST or() の区切り文字を削除
}

// ============================================================
// searchCommunities — マッチ理由付きで返す高機能版
// ============================================================
// 改善点 (旧 discoverCommunities 比):
//   1) name と description の両方を検索対象に
//   2) variants は length >= 2 のみ (single char で全件マッチ事故を防ぐ)
//   3) PostgREST or() の文法を破壊する `,` `(` `)` `:` `\` および
//      ilike ワイルドカード `%` `_` を入力からエスケープ
//   4) 結果をクライアント側でスコアリングして再ランキング
//      - name 完全一致: +100
//      - name prefix:   +60
//      - name 含む:     +40
//      - 説明 含む:     +15
//      - synonym 経由:  +5
//      - 公式は微ブースト +5
//      - member_count を log scale で加点 (人気の僅差調整)
//   5) 重複削除 (1 community が複数 OR clause でヒットしうる)
// ============================================================

/** searchCommunities の各結果にマッチ理由とスコアを付与した型 */
export type MatchedBy = 'name-exact' | 'name-prefix' | 'name-contains' | 'desc-contains' | 'synonym' | 'popular';

export type CommunityHit = Community & {
  matchedBy: MatchedBy;
  matchedVariant?: string;
  score: number;
};

/**
 * コミュニティを全文検索してスコア・マッチ理由付きで返す。
 * @param opts.query    検索文字列 (省略時は人気順)
 * @param opts.tag      タグフィルタ (community_tags.tag と完全一致)
 * @param opts.officialOnly  true なら is_official=true のみ
 * @param opts.limit    最大件数 (default 30)
 */
export async function searchCommunities(opts: {
  query?: string;
  tag?: string;
  officialOnly?: boolean;
  limit?: number;
}): Promise<CommunityHit[]> {
  const limit = opts.limit ?? 30;
  const queryStr = opts.query?.trim() ?? '';
  const normalizedQuery = queryStr.toLowerCase();

  // tag フィルタ用 community_id を先に取得 (必要なら)
  let tagFilterIds: string[] | null = null;
  if (opts.tag) {
    const { data: tagged } = await supabase
      .from('community_tags')
      .select('community_id')
      .eq('tag', opts.tag);
    tagFilterIds = (tagged ?? []).map((t) => t.community_id);
    if (tagFilterIds.length === 0) return [];
  }

  // クエリ無し → 人気順 (member_count desc) + last_post_at で活性度ブースト
  if (!queryStr) {
    let q = supabase
      .from('communities')
      .select('*')
      .in('visibility', ['open', 'request'])
      .order('member_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (opts.officialOnly) q = q.eq('is_official', true);
    if (tagFilterIds) q = q.in('id', tagFilterIds);
    const { data, error } = await q;
    if (error) {
      console.warn('[communities] searchCommunities (no query) failed:', error.message);
      return [];
    }
    return (data ?? []).map((c) => ({
      ...c,
      matchedBy: 'popular' as MatchedBy,
      score: c.member_count + (c.is_official ? 5 : 0),
    }));
  }

  // バリエーション生成 (length>=2 のみ、特殊文字エスケープ後に重複除外)
  const rawVariants = generateVariants(queryStr).slice(0, 8);
  const variantsSet = new Set<string>();
  for (const v of rawVariants) {
    const trimmed = v.trim();
    if (trimmed.length < 2) continue;
    const esc = escapeForIlike(trimmed);
    if (esc.length >= 2) variantsSet.add(esc);
  }
  // フォールバック: variants 全部 length<2 なら原文をそのまま (1 文字検索を許可)
  if (variantsSet.size === 0) {
    const esc = escapeForIlike(queryStr);
    if (esc.length >= 1) variantsSet.add(esc);
  }
  const escapedVariants = Array.from(variantsSet);

  // name + description の OR
  const orClauses: string[] = [];
  for (const v of escapedVariants) {
    orClauses.push(`name.ilike.%${v}%`);
    orClauses.push(`description.ilike.%${v}%`);
  }

  let q = supabase
    .from('communities')
    .select('*')
    .in('visibility', ['open', 'request'])
    .or(orClauses.join(','))
    .limit(Math.max(limit * 3, 100)); // overfetch して再ランキング
  if (opts.officialOnly) q = q.eq('is_official', true);
  if (tagFilterIds) q = q.in('id', tagFilterIds);

  const { data, error } = await q;
  if (error) {
    console.warn('[communities] searchCommunities failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as Community[];

  // ----- スコアリング -----
  const hits: CommunityHit[] = [];
  const seenIds = new Set<string>();
  for (const c of rows) {
    if (seenIds.has(c.id)) continue;
    const name = (c.name ?? '').toLowerCase();
    const desc = (c.description ?? '').toLowerCase();

    let bestScore = 0;
    let bestMatch: MatchedBy = 'name-contains';
    let matchedVariant: string | undefined;

    // 原文 (= ユーザーが直接入力した文字列) を最優先で評価
    if (name === normalizedQuery) {
      bestScore = 100;
      bestMatch = 'name-exact';
      matchedVariant = queryStr;
    } else if (name.startsWith(normalizedQuery)) {
      bestScore = 60;
      bestMatch = 'name-prefix';
      matchedVariant = queryStr;
    } else if (name.includes(normalizedQuery)) {
      bestScore = 40;
      bestMatch = 'name-contains';
      matchedVariant = queryStr;
    } else if (desc.includes(normalizedQuery)) {
      bestScore = 15;
      bestMatch = 'desc-contains';
      matchedVariant = queryStr;
    } else {
      // 原文ではマッチしないが variants 経由で hit → synonym 扱い
      for (const v of escapedVariants) {
        const lv = v.toLowerCase();
        if (lv === normalizedQuery) continue;
        if (name.includes(lv)) {
          bestScore = 30;
          bestMatch = 'synonym';
          matchedVariant = v;
          break;
        }
        if (desc.includes(lv)) {
          bestScore = 5;
          bestMatch = 'synonym';
          matchedVariant = v;
          break;
        }
      }
      // それでも無ければ DB の OR にはマッチしてるはずなので 1 点
      if (bestScore === 0) {
        bestScore = 1;
        bestMatch = 'synonym';
      }
    }

    // 公式コミュは僅差ブースト
    if (c.is_official) bestScore += 5;
    // メンバー数の log boost (大規模優位を緩和)
    bestScore += Math.log10(Math.max(1, c.member_count));

    hits.push({ ...c, matchedBy: bestMatch, matchedVariant, score: bestScore });
    seenIds.add(c.id);
  }

  // スコア降順、同点ならメンバー数→新しい順
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.member_count !== a.member_count) return b.member_count - a.member_count;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });

  return hits.slice(0, limit);
}

// ============================================================
// 類似名チェック (作成時の重複防止)
// open + request だけ取得 (invite は除外 — 他人に存在を知らせない)
// あとで client side similarity で絞り込む
// ============================================================
/**
 * コミュニティ名で類似検索する。主に新規作成時の重複防止用。
 * @param query  検索文字列 (2文字未満は空配列を返す)
 * @param limit  最大件数 (default 20)
 */
export async function searchByName(query: string, limit = 20): Promise<Community[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // バリエーション生成 (== / イコール / 同義語 etc.) して or-ilike で broad fetch
  // それから client similarity で再ランキング
  // 監査指摘: 旧実装は `%` / `_` をエスケープしておらず、`_` 含みの入力で
  // ilike が全件マッチ化、`%` 入力で構文崩壊する問題があった。
  // searchCommunities と同じ escapeForIlike を共通利用。
  const variants = generateVariants(q).slice(0, 6);
  const orClauses = variants
    .filter((v) => v.length >= 2)
    .map((v) => `name.ilike.%${escapeForIlike(v)}%`);
  // フォールバック: orClauses が空なら q を escape して ilike
  const orQuery = orClauses.length > 0
    ? orClauses.join(',')
    : `name.ilike.%${escapeForIlike(q)}%`;

  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .in('visibility', ['open', 'request'])
    .or(orQuery)
    .limit(80);

  if (error) {
    console.warn('[communities] searchByName failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as Community[];
  // クライアント側で similarity score で再ランキング (近重複だけを上位に)
  const ranked = findSimilar(q, rows, { threshold: 0.4, limit });
  return ranked.map((r) => r.item);
}

// ============================================================
// 公式コミュニティ一覧 — 探す画面の上部セクション用
// is_official = true のものを member_count → created_at の順で返す
// ============================================================
/**
 * 公式コミュニティを人気順で返す。
 * @param limit  最大件数 (default 10)
 */
export async function fetchOfficialCommunities(limit = 10): Promise<Community[]> {
  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .eq('is_official', true)
    .order('member_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[communities] fetchOfficialCommunities failed:', error.message);
    return [];
  }
  return (data ?? []) as Community[];
}

// ============================================================
// 急上昇コミュニティ — 直近に投稿があったコミュを last_post_at 降順で
// ------------------------------------------------------------
// 「いま盛り上がっている」= 直近にアクティビティがあるコミュの近似。
// GEEK には閲覧者数や時系列の成長率が無いため、last_post_at (最終投稿時刻)
// を活性度の proxy として使う。投稿ゼロ (last_post_at が null) は除外。
// member_count 順の「おすすめ」とは別軸で、新しめ・活発なコミュが上に来る。
// invite (完全招待制) は探索面に出さない (open / request のみ)。
// ============================================================
/**
 * 急上昇コミュニティを最終投稿時刻降順で返す。
 * @param limit  最大件数 (default 20)
 */
export async function fetchRisingCommunities(limit = 20): Promise<Community[]> {
  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .in('visibility', ['open', 'request'])
    .not('last_post_at', 'is', null)
    .order('last_post_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[communities] fetchRisingCommunities failed:', error.message);
    return [];
  }
  return (data ?? []) as Community[];
}

// ============================================================
// コミュニティ検索 (discover) — invite は除外
// variants で「ポケモン / pokemon / ぽけもん / pkmn」等の表記ゆらぎを吸収
//
// 戻り値は Community[] で互換性を保つが、内部では searchCommunities() を呼んで
// matched_by / score 付きの結果を計算し、score 順にソートして返す。
// 詳細メタを使いたい場合は searchCommunities() を直接呼ぶこと。
// ============================================================
/**
 * @deprecated searchCommunities() を直接呼ぶことを推奨。
 *   本関数は後方互換のためのラッパ。matchedBy / score フィールドが必要な
 *   呼び出し元は searchCommunities() に移行してください。
 */
export async function discoverCommunities(opts: {
  query?: string;
  tag?: string;
  limit?: number;
}): Promise<Community[]> {
  const hits = await searchCommunities(opts);
  return hits;
}
