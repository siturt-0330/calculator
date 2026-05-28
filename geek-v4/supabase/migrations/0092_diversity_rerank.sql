-- ============================================================
-- 0092_diversity_rerank.sql — 多軸 diversity rerank RPC
-- ============================================================
-- 目的:
--   filter bubble 緩和をさらに強化する。
--   0086 の search_posts_v3 は「同一 author の連続抑制」のみだったが、
--   これを **author + community + topic (tag)** の 3 軸に拡張する
--   汎用 rerank RPC を提供する。検索結果 / フィード結果のどちらにも
--   後段で被せられる pure-rerank ヘルパとして使う。
--
-- 入力:
--   p_post_ids uuid[]   — 元のランキング結果 (post_id 配列)
--   p_scores   numeric[] — 同じ index の score 配列 (長さ一致)
--   p_max_per_author int    default 2
--   p_max_per_community int default 3
--   p_max_per_tag int       default 3
--
-- 出力:
--   table(post_id uuid, final_score numeric, diversity_factor numeric)
--   final_score 降順で返す。
--
-- 計算:
--   各 post について軸ごとに row_number() を取り、上限を超えた分に
--   ペナルティを掛ける。複数軸が同時に超えた場合は累積 (掛け算)。
--     - rn_author    > max_per_author    → ×0.5
--     - rn_community > max_per_community → ×0.7
--     - rn_tag (max) > max_per_tag       → ×0.8
--   final_score = original_score × diversity_factor
--
-- 軸が存在しない場合の skip 方針:
--   - posts.author_id    は 0001 で必須 → 常に評価。
--   - community 軸: 0023 の post_communities (post_id, community_id) が
--     存在する場合のみ評価。1 post が複数 community に属する場合は
--     「いずれかの community で max rn」を採用 (= 最も混雑している
--     community で評価される)。post_communities に行が無い post は
--     community 軸を skip (penalty 無し)。
--   - tag 軸: posts.tag_names text[] (0001 で非正規化保持) を unnest
--     して評価。タグごとに rn を取り、その post の tag 内の最大 rn を
--     採用。tag_names が空配列の post は tag 軸 skip。
--   ※ 仕様には post_tags table が前提とあるが、このリポジトリでは
--     存在せず posts.tag_names text[] に統合されている。同等の効果が
--     得られるよう unnest で対応する。
--
-- 設計判断:
--   * 既存 migration は編集しない (idempotency 維持)。
--   * SECURITY DEFINER + search_path = pg_catalog, public で lockdown
--     (0083 / 0085 / 0086 と同じスタイル)。
--   * p_post_ids と p_scores の長さが不一致なら即 return (空)。
--   * 冪等: drop function if exists + create or replace。何度流しても OK。
--   * pure-rerank なので RLS を経由しない (入力 post_id 自体は呼び出し
--     元が既に RLS 通過した結果のはず)。SECURITY DEFINER の理由は
--     呼び出し元 (search_posts_v3 / get_feed_page 等) と同じ権限
--     コンテキストで使うため。
--   * primary tag は alphabetical の最初の 1 件で安定化した helper view
--     post_primary_tag を提供 (UI の "代表タグ" 表示にも転用可)。
--
-- 提供するもの:
--   1. view  public.post_primary_tag (post_id, primary_tag)
--   2. RPC   public.diversify_post_list(uuid[], numeric[], int, int, int)
--   3. RPC   public.diversify_post_list_for_user(uuid, uuid[], numeric[])
--      ↑ user_search_preferences.diversify_results = false なら no-op で
--         score をそのまま返す wrapper。
-- ============================================================

-- ============================================================
-- 1. post_primary_tag — 各 post の代表タグ (alphabetical 1 件目)
-- ============================================================
-- tag_names text[] が空 / null の post はこの view に出てこない。
-- create or replace view で冪等にする。
-- ============================================================
create or replace view public.post_primary_tag as
select
  p.id as post_id,
  (
    select t
    from unnest(p.tag_names) as t
    where t is not null and length(trim(t)) > 0
    order by lower(t) asc
    limit 1
  ) as primary_tag
from public.posts p
where p.tag_names is not null
  and array_length(p.tag_names, 1) is not null;

-- view への SELECT 権限は anon / authenticated に許可 (post 自体の
-- RLS は base table 側で効く)。
revoke all on public.post_primary_tag from public;
grant select on public.post_primary_tag to anon, authenticated;

-- ============================================================
-- 2. diversify_post_list — 多軸 diversity rerank の汎用 RPC
-- ============================================================
drop function if exists public.diversify_post_list(uuid[], numeric[], int, int, int);
create or replace function public.diversify_post_list(
  p_post_ids uuid[],
  p_scores numeric[],
  p_max_per_author int default 2,
  p_max_per_community int default 3,
  p_max_per_tag int default 3
)
returns table (
  post_id uuid,
  final_score numeric,
  diversity_factor numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_len_ids int;
  v_len_scores int;
  v_max_author int := greatest(coalesce(p_max_per_author, 2), 1);
  v_max_community int := greatest(coalesce(p_max_per_community, 3), 1);
  v_max_tag int := greatest(coalesce(p_max_per_tag, 3), 1);
begin
  -- 入力 guard: いずれかが NULL / 長さ不一致なら空を返す
  if p_post_ids is null or p_scores is null then
    return;
  end if;
  v_len_ids := coalesce(array_length(p_post_ids, 1), 0);
  v_len_scores := coalesce(array_length(p_scores, 1), 0);
  if v_len_ids = 0 or v_len_ids <> v_len_scores then
    return;
  end if;

  return query
  with input_arr as (
    -- 入力 array を (post_id, score, ord) の row 集合に展開
    select
      pid as post_id,
      sc as score,
      ord
    from unnest(p_post_ids, p_scores)
      with ordinality as u(pid, sc, ord)
  ),
  base as (
    -- posts と join して author / created_at を取得
    -- (post_id が posts に存在しないものは捨てる)
    select
      i.post_id,
      i.score,
      i.ord,
      p.author_id,
      p.created_at
    from input_arr i
    join public.posts p on p.id = i.post_id
  ),
  -- author 軸 (常に評価される)
  ranked_author as (
    select
      b.post_id,
      row_number() over (
        partition by b.author_id
        order by b.score desc nulls last, b.created_at desc nulls last
      ) as rn_author
    from base b
  ),
  -- community 軸: post_communities (M:N) に登録されている community ごとに
  -- rn を取って、その post の中で max を採用。post_communities に行が
  -- 無い post は rn_community = NULL → penalty 対象外。
  community_expanded as (
    select
      b.post_id,
      pc.community_id,
      b.score,
      b.created_at
    from base b
    join public.post_communities pc on pc.post_id = b.post_id
  ),
  ranked_community_each as (
    select
      ce.post_id,
      row_number() over (
        partition by ce.community_id
        order by ce.score desc nulls last, ce.created_at desc nulls last
      ) as rn_in_community
    from community_expanded ce
  ),
  ranked_community as (
    select
      r.post_id,
      max(r.rn_in_community) as rn_community
    from ranked_community_each r
    group by r.post_id
  ),
  -- tag 軸: posts.tag_names text[] を unnest して tag ごとに rn を取り、
  -- その post の tag 内の max を採用。tag_names が空 / null の post は
  -- rn_tag = NULL → penalty 対象外。
  tag_expanded as (
    select
      b.post_id,
      lower(trim(t)) as tag,
      b.score,
      b.created_at
    from base b
    join public.posts p on p.id = b.post_id
    cross join lateral unnest(coalesce(p.tag_names, '{}'::text[])) as t
    where t is not null and length(trim(t)) > 0
  ),
  ranked_tag_each as (
    select
      te.post_id,
      row_number() over (
        partition by te.tag
        order by te.score desc nulls last, te.created_at desc nulls last
      ) as rn_in_tag
    from tag_expanded te
  ),
  ranked_tag as (
    select
      r.post_id,
      max(r.rn_in_tag) as rn_tag
    from ranked_tag_each r
    group by r.post_id
  ),
  combined as (
    select
      b.post_id,
      b.score,
      b.created_at,
      ra.rn_author,
      rc.rn_community,
      rt.rn_tag
    from base b
    left join ranked_author ra on ra.post_id = b.post_id
    left join ranked_community rc on rc.post_id = b.post_id
    left join ranked_tag rt on rt.post_id = b.post_id
  ),
  factored as (
    select
      c.post_id,
      c.score,
      c.created_at,
      (
        case when c.rn_author is not null and c.rn_author > v_max_author then 0.5::numeric else 1.0::numeric end
        *
        case when c.rn_community is not null and c.rn_community > v_max_community then 0.7::numeric else 1.0::numeric end
        *
        case when c.rn_tag is not null and c.rn_tag > v_max_tag then 0.8::numeric else 1.0::numeric end
      ) as factor
    from combined c
  )
  select
    f.post_id,
    (coalesce(f.score, 0::numeric) * f.factor)::numeric as final_score,
    f.factor as diversity_factor
  from factored f
  order by (coalesce(f.score, 0::numeric) * f.factor) desc nulls last,
           f.created_at desc nulls last;
end;
$$;

revoke all on function public.diversify_post_list(uuid[], numeric[], int, int, int) from public;
grant execute on function public.diversify_post_list(uuid[], numeric[], int, int, int) to anon, authenticated;

-- ============================================================
-- 3. diversify_post_list_for_user — 設定 (diversify_results) を尊重する wrapper
-- ============================================================
-- user_search_preferences.diversify_results = false の user に対しては
-- no-op (factor = 1.0, score をそのまま) を返す。
-- 行が無い user は default true 扱い (= diversify を適用)。
-- ============================================================
drop function if exists public.diversify_post_list_for_user(uuid, uuid[], numeric[]);
create or replace function public.diversify_post_list_for_user(
  p_user_id uuid,
  p_post_ids uuid[],
  p_scores numeric[]
)
returns table (
  post_id uuid,
  final_score numeric,
  diversity_factor numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_len_ids int;
  v_len_scores int;
  v_diversify boolean := true;
begin
  if p_post_ids is null or p_scores is null then
    return;
  end if;
  v_len_ids := coalesce(array_length(p_post_ids, 1), 0);
  v_len_scores := coalesce(array_length(p_scores, 1), 0);
  if v_len_ids = 0 or v_len_ids <> v_len_scores then
    return;
  end if;

  -- 設定取得 (NULL user / 未登録 user は default = true 扱い)
  if p_user_id is not null then
    select coalesce(p.diversify_results, true)
      into v_diversify
      from public.user_search_preferences p
      where p.user_id = p_user_id;
    if v_diversify is null then
      v_diversify := true;
    end if;
  end if;

  if v_diversify then
    -- 設定 ON → 多軸 diversify を実行
    return query
      select d.post_id, d.final_score, d.diversity_factor
      from public.diversify_post_list(p_post_ids, p_scores) d;
  else
    -- 設定 OFF → no-op (元の score をそのまま、factor = 1.0)
    return query
      select
        u.pid::uuid as post_id,
        u.sc::numeric as final_score,
        1.0::numeric as diversity_factor
      from unnest(p_post_ids, p_scores) with ordinality as u(pid, sc, ord)
      order by u.ord asc;
  end if;
end;
$$;

revoke all on function public.diversify_post_list_for_user(uuid, uuid[], numeric[]) from public;
grant execute on function public.diversify_post_list_for_user(uuid, uuid[], numeric[]) to anon, authenticated;

-- ============================================================
-- 末尾 note (適用確認用 — 失敗時に明確にする)
-- ============================================================
select 'note: 0092_diversity_rerank applied — diversify_post_list (3-axis: author/community/tag) + post_primary_tag view + user-aware wrapper' as note;
