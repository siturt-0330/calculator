-- ============================================================
-- 0150_search_visibility_predicate.sql — 検索 RPC の可視性ホール封じ
-- ============================================================
-- 監査 (2026-06-13, 64 エージェント) で確証した P1 セキュリティホール:
--
--   search_posts_v2 (0085) は SECURITY DEFINER (= RLS bypass) なのに、候補
--   抽出 (candidates CTE) の WHERE が ilike / similarity の text-match だけで、
--   投稿の可視性 (can_view_post) も shadowban (author_visible) も一切検査して
--   いなかった。0085:325 の「archive / 削除済を弾く」は実 SQL を伴わない空コメント。
--   これを wrap する search_posts_v3 (0086) / search_posts_v4 (0097) /
--   explain_search_v4 / get_result_explanation はいずれも v2 の候補集合を
--   そのまま使うため、検索語にマッチすれば
--     - 非公開 (private) 投稿
--     - 未参加クローズドコミュ (community_only) の投稿
--     - shadowban された author の投稿
--   の post_id / matched_terms / final_score が全 viewer に返っていた。
--   (本文は client の fetchPostsByIds が RLS 経由で再取得するので漏れないが、
--    post_id 存在オラクル + matched_terms 経由の private 本文クエリ語ヒットが残る)
--
--   対照: 0113 discovery RPC は (can_view_post or author 本人) and author_visible
--   の述語を持つ。検索コア RPC だけがこのガードを欠いていた。
--
-- 本マイグレーションの修正 (2 関数のみ・最小):
--   1. search_posts_v2  … candidates CTE に RLS 同等の可視性述語を追加。
--      → これだけで v3 / v4 / explain_search_v4 / get_result_explanation の
--        候補集合がすべて gate される (全部 v2 の候補を継承するため)。
--   2. get_post_safety  … post_id 直引きの独立オラクル。candidate 集合に依存
--      しないため、関数内に独自の can_view_post gate を追加する。
--
-- 述語の根拠 (RLS と完全一致 = 過剰フィルタにならない):
--   posts_select_visibility (0061) = using (can_view_post(id) or author_id = auth.uid())
--   → 検索が返すのは「直接 posts を select したのと同じ可視集合」になる。
--     community_only 投稿 (参加コミュの member は見える) や自分の private 投稿は
--     can_view_post が true を返すので除外されない。
--   author_visible (0061) = (auth.uid() = author) or (author が shadowban でない)
--
-- helper は既存定義済 (SECURITY DEFINER 内から呼出可):
--   can_view_post(uuid)  … 0023 / 0038
--   author_visible(uuid) … 0061
--
-- ★ 実機計測で判明した本番の実状 (2026-06-13・anon REST で実測):
--   search_posts_v2/v3/v4 は **本番で全クエリ 42804 エラー = 丸ごと壊れて休眠**して
--   いた (上記 text_relevance の double precision 不一致が原因)。よって client は
--   ずっと fallback ilike (RLS 準拠) で検索しており、「検索 RPC が非可視 post_id を
--   返す」ホールは実は発火していなかった。本 migration は **型バグも直す**ので、
--   適用すると検索 RPC (BM25 ランキング) が **本番で初めて稼働**する (= 検索の並びが
--   ilike→BM25 に変わる挙動変化)。万一 RPC に別問題があっても client は v4 失敗時に
--   自動 fallback するので検索自体は壊れない (graceful)。
--   (get_post_safety は本番で稼働中・可視性 gate 欠落 = これが唯一の生リスクだった)
--
-- ★ 適用後に必ず検証する (2 点):
--   (1) 稼働確認: select * from public.search_posts_v4('ゲーム',5,0,null,true,false);
--       が 200 + 妥当な結果を返すこと (旧: 42804)。結果の質も目視。
--   (2) 可視性差分: 別アカの private / 未参加クローズドコミュ投稿にヒットする語で
--       search_posts_v2('<語>',30,0) を 2 アカウントの JWT (or SQL editor で
--       `set local role authenticated; set local request.jwt.claims='{"sub":"<uuid>"}'`)
--       で叩き、見えない投稿の post_id が返らないこと + 公開投稿の件数が減らないこと。
--
-- 適用・デプロイはユーザー明示指示時のみ (CLAUDE.md §0)。Supabase SQL エディタで手動適用。
-- create or replace のみ (drop しない) なので既存 grant は保持されるが、念のため再付与する。
-- ============================================================

-- ============================================================
-- 1. search_posts_v2 — candidates CTE に可視性述語を追加
-- ============================================================
create or replace function public.search_posts_v2(
  p_query text,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  post_id uuid,
  final_score numeric,
  text_relevance numeric,
  recency_boost numeric,
  eeat_score numeric,
  matched_terms text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tokens text[];
  v_expanded text[];
  v_typo_terms text[];
  v_limit int := least(coalesce(p_limit, 20), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  -- A. tokenize (lower + whitespace split + 空要素除去)
  v_tokens := array(
    select t
    from unnest(regexp_split_to_array(lower(trim(p_query)), '\s+')) as t
    where length(t) > 0
  );

  if array_length(v_tokens, 1) is null then
    return;
  end if;

  -- B. 同義語展開: token 自体 + synonyms[] を union
  v_expanded := array(
    select distinct lower(x)
    from (
      select unnest(v_tokens) as x
      union all
      select unnest(s.synonyms) as x
      from public.search_synonyms s
      where s.term = any(v_tokens)
    ) sub
    where length(x) > 0
  );

  -- C. typo correction: 各 token に対して similarity > 0.3 な term を補う
  v_typo_terms := array(
    select distinct s.term
    from public.search_synonyms s,
         unnest(v_tokens) tok
    where similarity(s.term, tok) > 0.3
      and s.term <> tok
    limit 20
  );
  -- typo で見つかった term の synonyms も追加展開
  v_expanded := array(
    select distinct lower(x)
    from (
      select unnest(v_expanded) as x
      union all
      select unnest(s.synonyms) as x
      from public.search_synonyms s
      where s.term = any(v_typo_terms)
      union all
      select unnest(v_typo_terms) as x
    ) sub
    where length(x) > 0
  );

  -- D + E: posts を検索してスコアリング
  return query
  with candidates as (
    -- 各 expanded 語に対して 1 度だけ posts を hit
    select
      p.id,
      p.title,
      p.content,
      p.created_at,
      p.likes_count,
      p.concern_count,
      p.author_id,
      -- text_relevance: title は本文より 2x の重み
      coalesce((
        select max(similarity(coalesce(p.title, ''), e))
        from unnest(v_expanded) e
        where length(e) > 1
      ), 0) * 2.0
      + coalesce((
        select max(similarity(p.content, e))
        from unnest(v_expanded) e
        where length(e) > 1
      ), 0) as text_rel_raw,
      -- 同義語 hit が「実際に文字列として出現した」boost
      (case
        when exists (
          select 1 from unnest(v_expanded) e
          where length(e) > 1
            and (coalesce(p.title,'') ilike '%' || e || '%' or p.content ilike '%' || e || '%')
        )
        then 1.0 else 0.0
       end) as exact_hit
    from public.posts p
    where (
      -- 高速 pre-filter: trgm index 利用のため、 ilike を OR 並べる
      exists (
        select 1 from unnest(v_expanded) e
        where length(e) > 1
          and (coalesce(p.title,'') ilike '%' || e || '%' or p.content ilike '%' || e || '%')
      )
      or exists (
        select 1 from unnest(v_expanded) e
        where length(e) > 1
          and (similarity(coalesce(p.title,''), e) > 0.3 or similarity(p.content, e) > 0.3)
      )
    )
    -- ★ 0150: 可視性 gate (SECURITY DEFINER = RLS bypass のため明示的に再適用)。
    --   RLS posts_select_visibility と同一: 見える投稿 or 自分の投稿、かつ
    --   shadowban された author の投稿を本人以外から除外する。
    --   これにより非公開 / 未参加クローズドコミュ / shadowban 投稿の
    --   post_id・matched_terms・score が候補集合に入らなくなる (v3/v4/explain も継承)。
    and (public.can_view_post(p.id) or p.author_id = auth.uid())
    and public.author_visible(p.author_id)
  ),
  scored as (
    select
      c.id,
      -- text_relevance: 0..3 程度
      (c.text_rel_raw + c.exact_hit) as text_relevance,
      -- recency_boost
      case
        when c.created_at > now() - interval '24 hours' then 1.0
        when c.created_at > now() - interval '7 days'   then 0.8
        when c.created_at > now() - interval '30 days'  then 0.5
        else 0.3
      end::numeric as recency_boost,
      -- eeat_score: author trust + post like 数 (上限 100)
      (
        coalesce((select trust_score from public.profiles pr where pr.id = c.author_id), 50)::numeric
          / 100.0 * 0.7
        + least(coalesce(c.likes_count, 0)::numeric / 100.0, 1.0) * 0.3
      ) as eeat_score,
      -- quality_penalty: concern_count が高ければ大幅減点
      case
        when coalesce(c.concern_count, 0) > 5 then 0.3
        when coalesce(c.concern_count, 0) > 2 then 0.7
        else 1.0
      end::numeric as quality_penalty,
      -- どの語が hit したかを返す (debug + UI ハイライト用)
      array(
        select distinct e
        from unnest(v_expanded) e
        where length(e) > 1
          and (coalesce(c.title,'') ilike '%' || e || '%' or c.content ilike '%' || e || '%')
        limit 10
      ) as matched_terms
    from candidates c
  )
  select
    s.id as post_id,
    (s.text_relevance * s.recency_boost * s.eeat_score * s.quality_penalty)::numeric as final_score,
    -- ★ 0150 型修正 (実機計測で発覚): RETURNS TABLE は text_relevance/recency_boost/
    --   eeat_score を numeric 宣言だが、text_relevance = similarity()*2.0 が
    --   double precision になり 42804「structure of query does not match function
    --   result type (column 3)」で **本番では全クエリが失敗していた** (= 検索 RPC
    --   v2/v3/v4 が丸ごと壊れ、client はずっと fallback ilike で検索していた)。
    --   出力 3 列を明示 ::numeric して戻り型と一致させる (recency/eeat は元々 numeric
    --   だが防御的に cast)。これで v2 が稼働 → v3/v4 も連鎖で稼働する。
    s.text_relevance::numeric,
    s.recency_boost::numeric,
    s.eeat_score::numeric,
    s.matched_terms
  from scored s
  where s.text_relevance > 0
  order by (s.text_relevance * s.recency_boost * s.eeat_score * s.quality_penalty) desc,
           s.recency_boost desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.search_posts_v2(text, int, int) from public;
grant execute on function public.search_posts_v2(text, int, int) to anon, authenticated;

-- ============================================================
-- 2. get_post_safety — post_id 直引きの独立オラクルに可視性 gate
-- ============================================================
-- 元 (0090): where pss.post_id = p_post_id のみ。candidate 集合に依存しない
-- 直引きなので、対象 post_id を知っていれば任意 query 不要で safety 内訳が引けた。
-- can_view_post gate を追加し、見えない投稿には行を返さない。
-- ============================================================
create or replace function public.get_post_safety(p_post_id uuid)
returns table (
  clickbait        numeric,
  spam             numeric,
  low_signal       numeric,
  concern_density  numeric,
  composite        numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    pss.clickbait_score    as clickbait,
    pss.spam_score         as spam,
    pss.low_signal_score   as low_signal,
    pss.concern_density    as concern_density,
    pss.composite_safety_negation as composite
  from public.post_safety_score pss
  where pss.post_id = p_post_id
    -- ★ 0150: 見える投稿のみ safety を返す (非可視投稿の metadata オラクル封じ)。
    and public.can_view_post(p_post_id);
$$;

revoke all on function public.get_post_safety(uuid) from public;
grant execute on function public.get_post_safety(uuid) to anon, authenticated;

select '0150_search_visibility_predicate 完了 — search_posts_v2 candidates に RLS 同等の可視性述語 + get_post_safety に can_view_post gate' as note;
