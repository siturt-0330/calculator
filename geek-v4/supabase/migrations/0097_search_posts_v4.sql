-- ============================================================
-- 0097_search_posts_v4.sql — モデルマージ理論の核心: 最終統合検索 RPC
-- ============================================================
-- 目的:
--   0085 〜 0096 で並列に整備された signal / weight / safety / freshness /
--   diversify / intent-aware / engagement-log を、Task Arithmetic 風の
--   線形結合で 1 つの "final_score" に統合する最終 RPC を提供する。
--
--   モデルマージ理論からの対応:
--     - Task Arithmetic       → 各 signal_key の lambda * signal_value の加算
--     - TIES (sparsification) → lambda * apply_sparsification(signal, τ)
--     - TIES (sign election)  → p_use_sign_election=true で compute_merged_score 経由
--     - Task Negation         → safety_negation は ranking_weights で λ<0 が seed 済
--     - AdaMerging            → get_active_ranking_weights() の A/B profile
--     - MergeRec              → get_community_ranking_weights() による community
--                               単位の lambda 上書き
--     - Intent-aware mixing   → get_weights_for_query(p_query) によるクエリ intent
--                               ベースの effective_lambda override
--
--   数式 (略式):
--     final_score(post) =
--         Σ_{s ∈ signals} λ_s(profile, community, intent)
--                          * apply_sparsification(signal_s(post), τ_s)
--                          * intent_multiplier_s(query)
--                          * community_boost_s(community)
--     ↑ さらに p_use_diversify=true なら diversify_post_list_for_user で再ソート
--
-- このマイグレーションで追加する RPC:
--   1. search_posts_v4(...) — 最終統合検索 RPC (本マイグレーションの核心)
--   2. explain_search_v4(p_post_id uuid, p_query text)
--        — 特定 post に対する contributions 内訳を日本語 description 付きで返す
--   3. get_search_v4_health() — admin: profile / A/B group 分布 / 直近 24h 検索数
--                               / mean clicked position を jsonb で返す
--
-- 既存依存 (前提): すべて defensive: to_regclass / regprocedure で if-exists wrap
--   0085: search_posts_v2
--   0086: search_posts_v3 (post_id, final_score, base_score, viewed_boost,
--                          history_boost, text_relevance, recency_boost,
--                          eeat_score, matched_terms)
--   0087: post_quality_score view (usability_score)
--   0088: get_active_ranking_weights() returns (signal_key, lambda, threshold)
--         + user_ab_assignment / ranking_weight_profiles / ranking_weights /
--           ab_group_profile_map
--   0089: get_community_ranking_weights(uuid) returns (signal_key, lambda)
--   0090: post_safety_score view (composite_safety_negation, clickbait_score, …)
--   0091 (想定): post_freshness_score MV (post_id, freshness_score)
--   0092 (想定): diversify_post_list_for_user(uuid, uuid[], numeric[])
--                returns (post_id, final_score, diversity_factor)
--   0093 (想定): apply_sparsification(numeric, numeric)
--                / compute_merged_score(jsonb, jsonb, boolean)
--   0094 (想定): get_weights_for_query(text) returns (signal_key, effective_lambda)
--                / is_recent_event_query(text) returns boolean
--   0095 (想定): log_search_engagement(...) — post-search 用 (本 RPC では呼ばない)
--
-- 設計判断:
--   * 既存 migration 編集禁止 (本 file のみで完結)。
--   * すべて SECURITY DEFINER + set search_path = pg_catalog, public で lockdown
--     (0083 / 0085 / 0086 / 0087 / 0088 / 0090 と同じスタイル)。
--   * 本 RPC 自体は stable (volatile な log_search_engagement は client 側で呼ぶ前提)。
--   * 並列 build 中 (0091-0095) が未適用でも本 migration が壊れないよう、
--     依存 object の存在を to_regclass / to_regprocedure で起動時検査し、
--     未適用なら EXECUTE 動的 SQL or default 値で fallback する。
--   * contributions jsonb は { signal_key: { value, lambda, weighted, threshold,
--       sparsified, source, from_override } } の shape で透明性を担保。
--     explain_search_v4 はこれを展開して日本語 description を付け足す。
--   * search_posts_v3 を「広めに引いて (limit * 4 + offset)」候補集合とする。
--     これにより v3 のパーソナライズが効いた candidate に対し、本層で
--     usability / freshness / safety を加味して再 sort できる。
--   * Safety は λ_s が seed 値 -0.5 (0088) なので、`λ * value` 加算で自然に減点される。
--     contributions の表示でも weighted が負になり transparency と整合。
-- ============================================================

-- ============================================================
-- 0. 依存存在チェック (informational notice のみ、エラーにしない)
-- ============================================================
do $$
declare
  v_missing text := '';
begin
  if to_regclass('public.post_quality_score') is null then
    v_missing := v_missing || ' post_quality_score';
  end if;
  if to_regclass('public.post_safety_score') is null then
    v_missing := v_missing || ' post_safety_score';
  end if;
  if v_missing <> '' then
    raise notice '0097_search_posts_v4: 以下の依存 view が未作成 (default 値で fallback):%', v_missing;
  end if;
end$$;

-- ============================================================
-- 1. search_posts_v4 — 最終統合検索 RPC (本 migration の核心)
-- ============================================================
-- 流れ (10 step):
--   step 1: get_weights_for_query(p_query) で intent ベース weight override を取得
--   step 2: search_posts_v3(p_query, p_limit*4 + p_offset, 0) で広め candidate
--   step 3: 各 candidate の signal を取得 (dynamic EXECUTE で optional view 対応)
--   step 4: get_active_ranking_weights() で base λ + threshold 取得
--   step 5: p_community_id が指定なら get_community_ranking_weights で override
--   step 6: intent 由来の effective_lambda で更に override (step 1 の結果)
--   step 7: is_recent_event_query(p_query) なら freshness の λ を ×1.5
--   step 8: 各 signal に apply_sparsification(value, threshold) を適用
--   step 9: 線形結合 = Σ (λ * sparsified)。compute_merged_score が
--           存在し p_use_sign_election=true なら TIES-like 計算で代替。
--   step 10: p_use_diversify=true なら diversify_post_list_for_user で再ソート
--           (RPC が無ければ scored そのままで sort)
--           最後に offset / limit 適用
--
-- 戻り値 columns:
--   post_id uuid                       — post 識別子
--   final_score numeric                — モデルマージ後の最終スコア
--   contributions jsonb                — 各 signal の (value, lambda, weighted,
--                                        threshold, sparsified, source, from_override) 内訳
--   intent text                        — 推定 intent (recent_event / general)
--   diversity_factor numeric           — diversify の乗数 (1.0 = 影響なし)
--   matched_terms text[]               — v3 由来の matched_terms
-- ============================================================
drop function if exists public.search_posts_v4(text, int, int, uuid, boolean, boolean);
create or replace function public.search_posts_v4(
  p_query              text,
  p_limit              int     default 20,
  p_offset             int     default 0,
  p_community_id       uuid    default null,
  p_use_diversify      boolean default true,
  p_use_sign_election  boolean default false
)
returns table (
  post_id          uuid,
  final_score      numeric,
  contributions    jsonb,
  intent           text,
  diversity_factor numeric,
  matched_terms    text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit       int := least(coalesce(p_limit,  20), 100);
  v_offset      int := greatest(coalesce(p_offset, 0), 0);
  v_inner_limit int := least(greatest(v_limit + v_offset, 20) * 4, 400);
  v_intent      text := 'general';
  v_is_recent   boolean := false;
  -- 依存 object 検査 (本 migration はこれらが無くても壊れない)
  v_has_freshness_mv  boolean :=
    to_regclass('public.post_freshness_score') is not null;
  v_has_safety_view   boolean :=
    to_regclass('public.post_safety_score') is not null;
  v_has_quality_view  boolean :=
    to_regclass('public.post_quality_score') is not null;
  v_has_diversify     boolean :=
    to_regprocedure('public.diversify_post_list_for_user(uuid, uuid[], numeric[])') is not null;
  v_has_sparsify      boolean :=
    to_regprocedure('public.apply_sparsification(numeric, numeric)') is not null;
  v_has_merged_score  boolean :=
    to_regprocedure('public.compute_merged_score(jsonb, jsonb, boolean)') is not null;
  v_has_query_weights boolean :=
    to_regprocedure('public.get_weights_for_query(text)') is not null;
  v_has_recent_evt    boolean :=
    to_regprocedure('public.is_recent_event_query(text)') is not null;
  v_has_community_w   boolean :=
    p_community_id is not null
    and to_regprocedure('public.get_community_ranking_weights(uuid)') is not null;
  v_has_active_w      boolean :=
    to_regprocedure('public.get_active_ranking_weights()') is not null;
  v_has_search_v3     boolean :=
    to_regprocedure('public.search_posts_v3(text, integer, integer)') is not null;
  -- 動的に集める accumulator
  v_weights jsonb := '{}'::jsonb;   -- { signal_key: { lambda, threshold, source } }
  v_sources jsonb := '{}'::jsonb;   -- { signal_key: 'base'|'community'|'intent' }
  v_signals jsonb := '{}'::jsonb;   -- { post_id: { signal_key: value } }
  v_post_ids uuid[] := '{}';
  v_matched jsonb := '{}'::jsonb;   -- { post_id: text[] }
  r record;
begin
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  if not v_has_search_v3 then
    raise notice 'search_posts_v4: search_posts_v3 が未作成のため空集合を返します';
    return;
  end if;

  -- ============================================================
  -- step 1 (intent / recent event 判定)
  -- ============================================================
  if v_has_recent_evt then
    begin
      execute 'select public.is_recent_event_query($1)'
        into v_is_recent
        using p_query;
    exception when others then
      v_is_recent := false;
    end;
  end if;
  v_intent := case when v_is_recent then 'recent_event' else 'general' end;

  -- ============================================================
  -- step 4: base weights (profile 由来の λ + threshold)
  -- ============================================================
  if v_has_active_w then
    begin
      for r in execute
        'select signal_key::text as k, lambda::numeric as l, threshold::numeric as t
           from public.get_active_ranking_weights()'
      loop
        v_weights := v_weights || jsonb_build_object(
          r.k,
          jsonb_build_object('lambda', r.l, 'threshold', r.t, 'source', 'base')
        );
      end loop;
    exception when others then
      -- 失敗時は空のまま (後段でゼロ寄与扱い)
      v_weights := v_weights;
    end;
  end if;

  -- ============================================================
  -- step 5: community override (get_community_ranking_weights は base + delta 済)
  -- ============================================================
  if v_has_community_w then
    begin
      for r in execute
        'select signal_key::text as k, lambda::numeric as l
           from public.get_community_ranking_weights($1)'
        using p_community_id
      loop
        v_weights := v_weights || jsonb_build_object(
          r.k,
          jsonb_build_object(
            'lambda',    r.l,
            'threshold', coalesce((v_weights -> r.k ->> 'threshold')::numeric, 0),
            'source',    'community'
          )
        );
      end loop;
    exception when others then
      null;
    end;
  end if;

  -- ============================================================
  -- step 1 (続き) + step 6: intent ベース override
  -- ============================================================
  if v_has_query_weights then
    begin
      for r in execute
        'select signal_key::text as k, effective_lambda::numeric as l
           from public.get_weights_for_query($1)'
        using p_query
      loop
        v_weights := v_weights || jsonb_build_object(
          r.k,
          jsonb_build_object(
            'lambda',    r.l,
            'threshold', coalesce((v_weights -> r.k ->> 'threshold')::numeric, 0),
            'source',    'intent'
          )
        );
      end loop;
    exception when others then
      null;
    end;
  end if;

  -- ============================================================
  -- step 7: freshness の λ は recent_event のとき ×1.5
  -- ============================================================
  if v_is_recent and (v_weights ? 'freshness') then
    v_weights := jsonb_set(
      v_weights,
      array['freshness', 'lambda'],
      to_jsonb(((v_weights -> 'freshness' ->> 'lambda')::numeric * 1.5))
    );
  end if;

  -- ============================================================
  -- step 2: candidate を v3 で広めに引く
  -- ============================================================
  for r in execute
    'select post_id, text_relevance, recency_boost, eeat_score,
            viewed_boost, history_boost, matched_terms
       from public.search_posts_v3($1, $2, 0)'
    using p_query, v_inner_limit
  loop
    v_post_ids := v_post_ids || r.post_id;
    v_matched  := v_matched  || jsonb_build_object(
      r.post_id::text,
      to_jsonb(coalesce(r.matched_terms, '{}'::text[]))
    );
    v_signals  := v_signals  || jsonb_build_object(
      r.post_id::text,
      jsonb_build_object(
        'text_relevance',     coalesce(r.text_relevance, 0)::numeric,
        'recency',            coalesce(r.recency_boost,  0)::numeric,
        'eeat',               coalesce(r.eeat_score,     0)::numeric,
        'viewed_boost',       coalesce(r.viewed_boost,   1.0)::numeric,
        'history_boost',      coalesce(r.history_boost,  1.0)::numeric,
        'usability',          0.5::numeric,
        'freshness',          0.5::numeric,
        'safety_negation',    0::numeric,
        'clickbait_negation', 0::numeric,
        'diversity_penalty',  0::numeric
      )
    );
  end loop;

  if array_length(v_post_ids, 1) is null then
    return;
  end if;

  -- ============================================================
  -- step 3: optional signal source の埋め込み (dynamic EXECUTE で view 不在に耐える)
  -- ============================================================
  -- usability (post_quality_score)
  if v_has_quality_view then
    for r in execute
      'select pqs.post_id, pqs.usability_score::numeric as v
         from public.post_quality_score pqs
         where pqs.post_id = any($1)'
      using v_post_ids
    loop
      if v_signals ? r.post_id::text then
        v_signals := jsonb_set(
          v_signals,
          array[r.post_id::text, 'usability'],
          to_jsonb(coalesce(r.v, 0.5))
        );
      end if;
    end loop;
  end if;

  -- freshness (post_freshness_score MV — 0091 想定)
  if v_has_freshness_mv then
    begin
      for r in execute
        'select pfs.post_id, pfs.freshness_score::numeric as v
           from public.post_freshness_score pfs
           where pfs.post_id = any($1)'
        using v_post_ids
      loop
        if v_signals ? r.post_id::text then
          v_signals := jsonb_set(
            v_signals,
            array[r.post_id::text, 'freshness'],
            to_jsonb(coalesce(r.v, 0.5))
          );
        end if;
      end loop;
    exception when others then
      -- MV はあるが column 名 / shape が違う場合は default 0.5 のまま
      null;
    end;
  end if;

  -- safety_negation + clickbait_negation (post_safety_score)
  if v_has_safety_view then
    begin
      for r in execute
        'select pss.post_id,
                pss.composite_safety_negation::numeric as v_safety,
                pss.clickbait_score::numeric           as v_click
           from public.post_safety_score pss
           where pss.post_id = any($1)'
        using v_post_ids
      loop
        if v_signals ? r.post_id::text then
          v_signals := jsonb_set(
            v_signals,
            array[r.post_id::text, 'safety_negation'],
            to_jsonb(coalesce(r.v_safety, 0))
          );
          v_signals := jsonb_set(
            v_signals,
            array[r.post_id::text, 'clickbait_negation'],
            to_jsonb(coalesce(r.v_click, 0))
          );
        end if;
      end loop;
    exception when others then
      null;
    end;
  end if;

  -- ============================================================
  -- step 8 + 9 + 10: sparsify / 集計 / sign-election / diversify を 1 つの
  -- 入れ子ブロックで処理する。
  -- 各 optional 依存 (apply_sparsification / compute_merged_score /
  -- diversify_post_list_for_user) は dynamic EXECUTE で呼び、未作成でも
  -- inline fallback で動く。
  -- ============================================================
  declare
    v_post_key  text;
    v_sig_key   text;
    v_sig_val   numeric;
    v_thr       numeric;
    v_sparse    numeric;
    v_lambda    numeric;
    v_src       text;
    v_lin_sum   numeric;
    v_raw       numeric;
    v_contrib   jsonb;
    v_sig_jsonb jsonb;
    v_w_jsonb   jsonb;
    v_scored    jsonb := '{}'::jsonb;   -- { post_id_text: { contributions, raw_score } }
    v_ids       uuid[]    := '{}';
    v_scores    numeric[] := '{}';
    v_use_div   boolean := v_has_diversify and p_use_diversify;
    rec         record;
  begin
    -- step 8: sparsify (v_signals に書き戻し)
    for v_post_key in select k from jsonb_object_keys(v_signals) as k loop
      for v_sig_key in select k from jsonb_object_keys(v_signals -> v_post_key) as k loop
        v_sig_val := (v_signals -> v_post_key ->> v_sig_key)::numeric;
        v_thr     := coalesce((v_weights -> v_sig_key ->> 'threshold')::numeric, 0);
        if v_has_sparsify then
          begin
            execute 'select public.apply_sparsification($1, $2)'
              into v_sparse
              using v_sig_val, v_thr;
          exception when others then
            v_sparse := case when abs(v_sig_val) >= v_thr then v_sig_val else 0 end;
          end;
        else
          v_sparse := case when abs(v_sig_val) >= v_thr then v_sig_val else 0 end;
        end if;
        v_signals := jsonb_set(
          v_signals,
          array[v_post_key, v_sig_key],
          to_jsonb(v_sparse)
        );
      end loop;
    end loop;

    -- step 9: post 単位で λ * sparsified を集計、contributions / raw_score を構築
    for v_post_key in select k from jsonb_object_keys(v_signals) as k loop
      v_contrib   := '{}'::jsonb;
      v_sig_jsonb := '{}'::jsonb;
      v_w_jsonb   := '{}'::jsonb;
      v_lin_sum   := 0;
      for v_sig_key in select k from jsonb_object_keys(v_signals -> v_post_key) as k loop
        v_sig_val := (v_signals -> v_post_key ->> v_sig_key)::numeric;
        v_lambda  := coalesce((v_weights -> v_sig_key ->> 'lambda')::numeric,    0);
        v_thr     := coalesce((v_weights -> v_sig_key ->> 'threshold')::numeric, 0);
        v_src     := coalesce((v_weights -> v_sig_key ->> 'source')::text,       'none');
        v_lin_sum := v_lin_sum + v_lambda * v_sig_val;
        v_contrib := v_contrib || jsonb_build_object(
          v_sig_key,
          jsonb_build_object(
            'value',         v_sig_val,
            'lambda',        v_lambda,
            'weighted',      v_lambda * v_sig_val,
            'threshold',     v_thr,
            'sparsified',    v_sig_val,
            'source',        v_src,
            'from_override', v_src <> 'base' and v_src <> 'none'
          )
        );
        v_sig_jsonb := v_sig_jsonb || jsonb_build_object(v_sig_key, v_sig_val);
        v_w_jsonb   := v_w_jsonb   || jsonb_build_object(v_sig_key, v_lambda);
      end loop;

      -- TIES-like sign election (optional)
      if v_has_merged_score and p_use_sign_election then
        begin
          execute 'select public.compute_merged_score($1, $2, true)'
            into v_raw
            using v_sig_jsonb, v_w_jsonb;
        exception when others then
          v_raw := v_lin_sum;
        end;
      else
        v_raw := v_lin_sum;
      end if;

      v_scored := v_scored || jsonb_build_object(
        v_post_key,
        jsonb_build_object(
          'contributions', v_contrib,
          'raw_score',     v_raw
        )
      );
    end loop;

    -- step 10: raw_score 降順で配列を組む
    for rec in
      select k::uuid as pid,
             (v_scored -> k ->> 'raw_score')::numeric as sc
      from jsonb_object_keys(v_scored) as k
      order by (v_scored -> k ->> 'raw_score')::numeric desc nulls last
    loop
      v_ids    := v_ids    || rec.pid;
      v_scores := v_scores || rec.sc;
    end loop;

    if v_use_div and array_length(v_ids, 1) is not null then
      -- diversify_post_list_for_user (0092) を dynamic で呼ぶ
      begin
        return query execute $q$
          select
            d.post_id,
            d.final_score::numeric                            as final_score,
            ($1 -> d.post_id::text -> 'contributions')        as contributions,
            $2::text                                          as intent,
            coalesce(d.diversity_factor, 1.0)::numeric        as diversity_factor,
            coalesce(
              array(select jsonb_array_elements_text($3 -> d.post_id::text)),
              '{}'::text[]
            ) as matched_terms
          from public.diversify_post_list_for_user(auth.uid(), $4::uuid[], $5::numeric[]) d
          order by d.final_score desc nulls last
          limit $6 offset $7
        $q$
        using v_scored, v_intent, v_matched, v_ids, v_scores, v_limit, v_offset;
        return;
      exception when others then
        -- diversify が落ちたら fallback path に降りる
        null;
      end;
    end if;

    -- fallback: raw_score を final_score として返す (diversify 無効 / 失敗時)
    return query
    select
      pid                                                                  as post_id,
      (v_scored -> pid::text ->> 'raw_score')::numeric                     as final_score,
      (v_scored -> pid::text -> 'contributions')                           as contributions,
      v_intent::text                                                        as intent,
      1.0::numeric                                                          as diversity_factor,
      coalesce(
        array(select jsonb_array_elements_text(v_matched -> pid::text)),
        '{}'::text[]
      ) as matched_terms
    from unnest(v_ids) as pid
    order by (v_scored -> pid::text ->> 'raw_score')::numeric desc nulls last
    limit v_limit
    offset v_offset;
  end;
end;
$$;

revoke all on function public.search_posts_v4(text, int, int, uuid, boolean, boolean) from public;
grant execute on function public.search_posts_v4(text, int, int, uuid, boolean, boolean) to anon, authenticated;

comment on function public.search_posts_v4(text, int, int, uuid, boolean, boolean) is
  '最終統合検索 RPC (Task Arithmetic 風線形結合)。0085-0096 の signal を λ で混ぜ、'
  'community / intent / sign-election / diversify を適用。contributions jsonb で各寄与を透明化。';

-- ============================================================
-- 2. explain_search_v4(p_post_id, p_query) — transparency RPC
-- ============================================================
-- search_posts_v4 を内部から呼んで、対象 post の contributions jsonb を
-- 展開し、各 factor に日本語 description を付けて返す。
--
-- 戻り値: (factor, weight, description)
--   factor      = signal_key
--   weight      = contributions.weighted (λ * sparsified)
--   description = 日本語の説明文 (UI で表示する想定)
-- ============================================================
drop function if exists public.explain_search_v4(uuid, text);
create or replace function public.explain_search_v4(
  p_post_id uuid,
  p_query   text
)
returns table (
  factor      text,
  weight      numeric,
  description text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_contrib jsonb;
  v_intent text;
  v_found boolean := false;
begin
  if p_post_id is null or p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  -- search_posts_v4 を呼んで対象 post を探す (top 100 まで遡る)
  for v_row in
    select * from public.search_posts_v4(p_query, 100, 0, null, true, false)
  loop
    if v_row.post_id = p_post_id then
      v_contrib := v_row.contributions;
      v_intent  := v_row.intent;
      v_found   := true;
      exit;
    end if;
  end loop;

  if not v_found or v_contrib is null then
    -- 該当 post が top 100 に入っていない (= ほぼスコア 0 / 候補外)
    return query select
      'not_found'::text                                                       as factor,
      0::numeric                                                              as weight,
      ('検索結果上位 100 件にこの投稿は含まれていません。'
       || 'クエリ "' || p_query || '" との関連が低い可能性があります。')::text as description;
    return;
  end if;

  -- contributions jsonb を expand
  return query
  with kv as (
    select key as signal_key, value as detail
    from jsonb_each(v_contrib)
  ),
  named as (
    select
      kv.signal_key,
      (kv.detail ->> 'weighted')::numeric        as weight,
      (kv.detail ->> 'value')::numeric           as value,
      (kv.detail ->> 'lambda')::numeric          as lambda,
      (kv.detail ->> 'source')::text             as source,
      (kv.detail ->> 'from_override')::boolean   as from_override
    from kv
  )
  select
    n.signal_key as factor,
    n.weight,
    (case n.signal_key
       when 'text_relevance'     then 'クエリの語と本文 / タイトルの一致度'
       when 'recency'            then '投稿の新しさ (新しいほど高スコア)'
       when 'eeat'               then '投稿者の信用スコア + いいね数による品質指標'
       when 'usability'          then '文字数 / メディア / リンク健全性 / engagement 速度'
       when 'viewed_boost'       then '過去にあなたが閲覧した投稿への小ブースト'
       when 'history_boost'      then '過去の類似検索でクリックされた投稿への小ブースト'
       when 'freshness'          then '24h 以内の engagement velocity'
       when 'safety_negation'    then 'クリックベイト / spam / 低信号 / concern 比率による減点'
       when 'clickbait_negation' then 'タイトルの煽り表現による減点'
       when 'diversity_penalty'  then '同一投稿者の連続表示を抑える多様性ペナルティ'
       else n.signal_key
     end
     || case
          when n.from_override and n.source = 'community'
            then ' (このコミュニティの重み調整あり)'
          when n.from_override and n.source = 'intent'
            then case when v_intent = 'recent_event'
                      then ' (時事クエリのため重みを調整)'
                      else ' (クエリ意図に応じた重み調整あり)'
                 end
          else ''
        end
     || ' [signal=' || round(coalesce(n.value, 0), 3)::text
     || ', λ='     || round(coalesce(n.lambda, 0), 3)::text
     || ']'
    )::text as description
  from named n
  order by abs(n.weight) desc nulls last, n.signal_key;
end;
$$;

revoke all on function public.explain_search_v4(uuid, text) from public;
grant execute on function public.explain_search_v4(uuid, text) to anon, authenticated;

comment on function public.explain_search_v4(uuid, text) is
  'search_posts_v4 の contributions を展開し、日本語 description を付ける transparency RPC';

-- ============================================================
-- 3. get_search_v4_health() — admin: health 監視 RPC
-- ============================================================
-- admin 用: 現在 active な profile / A/B group 分布 / 直近 24h 検索数 /
-- click された平均 position を jsonb で返す。
-- 戻り値の shape:
--   {
--     "active_profile": { "id":..., "name":..., "description":..., "created_at":... },
--     "ab_group_distribution": [ { "ab_group": "g_a", "user_count": 123 }, ... ],
--     "searches_24h":  N,
--     "mean_click_position": x,
--     "dependencies": { "post_freshness_score": true, "diversify_post_list_for_user": false, ... },
--     "generated_at": "2026-..."
--   }
-- ============================================================
drop function if exists public.get_search_v4_health();
create or replace function public.get_search_v4_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_active_profile jsonb := 'null'::jsonb;
  v_ab_dist jsonb := '[]'::jsonb;
  v_searches_24h int := 0;
  v_mean_click numeric := null;
  v_deps jsonb;
  v_is_admin boolean := false;
begin
  -- admin チェック (current_user_is_admin or is_admin のどちらかを使う)
  begin
    if to_regprocedure('public.current_user_is_admin()') is not null then
      execute 'select public.current_user_is_admin()' into v_is_admin;
    elsif to_regprocedure('public.is_admin()') is not null then
      execute 'select public.is_admin()' into v_is_admin;
    end if;
  exception when others then
    v_is_admin := false;
  end;

  if v_uid is null or not v_is_admin then
    raise exception 'get_search_v4_health: admin only' using errcode = '42501';
  end if;

  -- active profile
  if to_regclass('public.ranking_weight_profiles') is not null then
    begin
      execute $q$
        select to_jsonb(p)
          from (
            select id, profile_name, description, created_at
              from public.ranking_weight_profiles
             where is_active = true
             limit 1
          ) p
      $q$ into v_active_profile;
    exception when others then
      v_active_profile := 'null'::jsonb;
    end;
  end if;

  -- A/B group 分布
  if to_regclass('public.user_ab_assignment') is not null then
    begin
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object('ab_group', ab_group, 'user_count', user_count)
                                  order by user_count desc),
                        '[]'::jsonb)
          from (
            select ab_group, count(*)::int as user_count
              from public.user_ab_assignment
             group by ab_group
          ) g
      $q$ into v_ab_dist;
    exception when others then
      v_ab_dist := '[]'::jsonb;
    end;
  end if;

  -- 直近 24h 検索数 (search_query_log は 0085 で作成済)
  if to_regclass('public.search_query_log') is not null then
    begin
      execute $q$
        select count(*)::int
          from public.search_query_log
         where created_at > now() - interval '24 hours'
      $q$ into v_searches_24h;
    exception when others then
      v_searches_24h := 0;
    end;
  end if;

  -- mean clicked position (0095 で search_engagement_log が用意される想定)
  if to_regclass('public.search_engagement_log') is not null then
    begin
      execute $q$
        select avg((position_clicked)::numeric)
          from public.search_engagement_log
         where created_at > now() - interval '24 hours'
           and position_clicked is not null
      $q$ into v_mean_click;
    exception when others then
      v_mean_click := null;
    end;
  elsif to_regclass('public.user_search_history') is not null then
    -- approximation: clicked_post_id が non-null の比率を proxy として返す
    begin
      execute $q$
        select case
                 when count(*) = 0 then null
                 else (count(*) filter (where clicked_post_id is not null)::numeric
                       / count(*)::numeric)
               end
          from public.user_search_history
         where created_at > now() - interval '24 hours'
      $q$ into v_mean_click;
    exception when others then
      v_mean_click := null;
    end;
  end if;

  v_deps := jsonb_build_object(
    'post_freshness_score',         to_regclass('public.post_freshness_score')                                      is not null,
    'post_quality_score',           to_regclass('public.post_quality_score')                                        is not null,
    'post_safety_score',            to_regclass('public.post_safety_score')                                         is not null,
    'search_posts_v3',              to_regprocedure('public.search_posts_v3(text, integer, integer)')               is not null,
    'get_active_ranking_weights',   to_regprocedure('public.get_active_ranking_weights()')                          is not null,
    'get_community_ranking_weights',to_regprocedure('public.get_community_ranking_weights(uuid)')                   is not null,
    'get_weights_for_query',        to_regprocedure('public.get_weights_for_query(text)')                           is not null,
    'is_recent_event_query',        to_regprocedure('public.is_recent_event_query(text)')                           is not null,
    'apply_sparsification',         to_regprocedure('public.apply_sparsification(numeric, numeric)')                is not null,
    'compute_merged_score',         to_regprocedure('public.compute_merged_score(jsonb, jsonb, boolean)')           is not null,
    'diversify_post_list_for_user', to_regprocedure('public.diversify_post_list_for_user(uuid, uuid[], numeric[])') is not null
  );

  return jsonb_build_object(
    'active_profile',        v_active_profile,
    'ab_group_distribution', v_ab_dist,
    'searches_24h',          v_searches_24h,
    'mean_click_position',   v_mean_click,
    'dependencies',          v_deps,
    'generated_at',          now()
  );
end;
$$;

revoke all on function public.get_search_v4_health() from public;
grant execute on function public.get_search_v4_health() to authenticated;

comment on function public.get_search_v4_health() is
  'admin: search v4 health snapshot — active profile / A/B 分布 / 直近 24h 検索数 / mean click position / 依存到達可否';

-- ============================================================
-- 4. ANALYZE (planner に新 stats を読ませる)
-- ============================================================
-- 本 migration は新 table を追加していないが、ranking_weights / community_weight_overrides は
-- 検索 RPC のホットパスなので再 ANALYZE しておく (idempotent / 安全)。
do $$
begin
  if to_regclass('public.ranking_weights') is not null then
    execute 'analyze public.ranking_weights';
  end if;
  if to_regclass('public.community_weight_overrides') is not null then
    execute 'analyze public.community_weight_overrides';
  end if;
end$$;

select '0097_search_posts_v4 完了 — search_posts_v4 (task arithmetic 統合) + explain_search_v4 (transparency) + get_search_v4_health (admin)' as note;
