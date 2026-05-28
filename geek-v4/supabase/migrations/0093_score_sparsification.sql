-- ============================================================
-- 0093_score_sparsification.sql — TIES-like score sparsification
-- ============================================================
-- 目的:
--   モデルマージにおける TIES (Trim + Elect Sign + Merge) を、
--   検索 ranking の signal 線形結合上で近似する。
--
--   TIES の元論文 (Yadav et al., 2023) では各 task vector を:
--     1. Trim         — 絶対値が小さい entry を 0 にして「ノイズ」除去
--     2. Elect Sign   — 各 entry で sign を多数決 (重み付き符号合議)
--     3. Merge        — 採用された sign に一致する task の値だけ平均
--   して合成する。
--
--   ここでは task vector の代わりに、各 signal_key
--   (text_relevance / recency / engagement / quality 等) の値を
--   per-post で集めた配列を 1 つの "ベクトル" とみなし、
--   lambda 重みでマージする手続きを SQL 関数として提供する。
--
-- 前提 (0088 で導入予定 — 本 migration 内では参照のみ、依存はしない):
--   ranking_weights(signal_key text pk, lambda numeric, threshold numeric, ...)
--   signal_key は 0088 / 0085 の v_search_signals に揃える想定 (例:
--     text_relevance / recency / engagement / author_trust / usability ...)。
--   ※ 本 migration の RPC は jsonb で signals と weights を受け取るため、
--     ranking_weights テーブルの存在を実行時に強く要求しない (= 疎結合)。
--
-- 設計判断:
--   * すべて create or replace / drop ... if exists で冪等。
--   * apply_sparsification / compute_merged_score は immutable + pure。
--     elect_sign_and_merge も入力配列のみに依存する pure 関数。
--   * 関数本体はテーブル access を一切しない (pure function)。
--     ranking_weights は呼び出し側 (lib/api) で jsonb に展開して渡す。
--   * SECURITY DEFINER は plpgsql / sql 双方で search_path lockdown
--     (PostgreSQL search_path 注入対策 — 0083 / 0085 / 0087 と同じスタイル)。
--     ※ apply_sparsification は超軽量の純粋演算なので SECURITY INVOKER のままで OK
--       (lockdown 不要)。
--   * 運用観察用に signal_sparsification_stats view を提供。
--     v_search_signals (0087) と ranking_weights (0088) が両方 LEFT JOIN で
--     存在すれば集計、無ければ空行で fail-safe。
--   * jsonb 操作は -> / ->> / jsonb_each / jsonb_each_text を使う。
-- ============================================================

-- ============================================================
-- 1. apply_sparsification(signal_value, threshold) — Trim
-- ============================================================
-- TIES の "Trim" 段階に対応。
-- |signal_value| <= threshold なら 0 を返す (= ノイズ除去で干渉を断つ)。
-- それ以外は signal_value をそのまま通す。
--
-- 用途: 他関数 (compute_merged_score) から呼ばれる単位演算。
-- pure / immutable / parallel safe — index expression にも使える。
-- ============================================================
drop function if exists public.apply_sparsification(numeric, numeric);
create or replace function public.apply_sparsification(
  p_signal_value numeric,
  p_threshold numeric
)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when p_signal_value is null then 0::numeric
    when p_threshold is null then p_signal_value
    when abs(p_signal_value) <= abs(p_threshold) then 0::numeric
    else p_signal_value
  end;
$$;

comment on function public.apply_sparsification(numeric, numeric) is
  'TIES "Trim" 相当: |value| <= threshold なら 0 にして干渉除去';

revoke all on function public.apply_sparsification(numeric, numeric) from public;
grant execute on function public.apply_sparsification(numeric, numeric)
  to anon, authenticated;

-- ============================================================
-- 2. elect_sign_and_merge(signal_values[], lambdas[]) — Elect + Merge
-- ============================================================
-- TIES の "Elect Sign" + "Merge" 段階に対応。
--
--   入力: p_signal_values  numeric[]  (各 signal の trim 後の値)
--         p_lambdas        numeric[]  (signal_values と同じ長さ)
--
--   手順:
--     1. contribution_i = lambda_i * value_i  を全 signal について計算
--     2. 符号別に総和:
--          pos_sum = sum(contribution_i)  for contribution_i > 0
--          neg_sum = sum(contribution_i)  for contribution_i < 0
--     3. 多数決 sign:
--          abs(pos_sum) > abs(neg_sum)  → +
--          それ以外                      → -  (tie 含む)
--     4. 採用 sign に一致する contribution の合計を返す。
--
--   配列長が不一致 / null / 空 のときは 0 を返す (fail-safe)。
--
-- SECURITY DEFINER + search_path lockdown は
-- データには触らないが慣行 (0083 / 0085 と同様) で揃える。
-- immutable: 入力のみに依存するため。
-- ============================================================
drop function if exists public.elect_sign_and_merge(numeric[], numeric[]);
create or replace function public.elect_sign_and_merge(
  p_signal_values numeric[],
  p_lambdas numeric[]
)
returns numeric
language plpgsql
immutable
parallel safe
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pos_sum numeric := 0;
  v_neg_sum numeric := 0;
  v_merged  numeric := 0;
  v_contrib numeric;
  v_n       int;
  i         int;
begin
  if p_signal_values is null or p_lambdas is null then
    return 0::numeric;
  end if;

  v_n := coalesce(array_length(p_signal_values, 1), 0);
  if v_n = 0 or v_n <> coalesce(array_length(p_lambdas, 1), 0) then
    return 0::numeric;
  end if;

  -- Pass 1: 符号別に重み付き和を計算 (Elect Sign)
  for i in 1 .. v_n loop
    v_contrib := coalesce(p_lambdas[i], 0) * coalesce(p_signal_values[i], 0);
    if v_contrib > 0 then
      v_pos_sum := v_pos_sum + v_contrib;
    elsif v_contrib < 0 then
      v_neg_sum := v_neg_sum + v_contrib;
    end if;
  end loop;

  -- Pass 2: 採用 sign に一致する contribution だけ Merge
  -- 多数決: abs(pos) > abs(neg) なら +、それ以外 (tie 含む) は -
  if abs(v_pos_sum) > abs(v_neg_sum) then
    -- + 採用
    for i in 1 .. v_n loop
      v_contrib := coalesce(p_lambdas[i], 0) * coalesce(p_signal_values[i], 0);
      if v_contrib > 0 then
        v_merged := v_merged + v_contrib;
      end if;
    end loop;
  else
    -- - 採用 (tie も含めて - 側に寄せる)
    for i in 1 .. v_n loop
      v_contrib := coalesce(p_lambdas[i], 0) * coalesce(p_signal_values[i], 0);
      if v_contrib < 0 then
        v_merged := v_merged + v_contrib;
      end if;
    end loop;
  end if;

  return v_merged;
end;
$$;

comment on function public.elect_sign_and_merge(numeric[], numeric[]) is
  'TIES "Elect Sign + Merge" 相当: weighted sum で sign を多数決し、その sign に一致する contribution のみ加算';

revoke all on function public.elect_sign_and_merge(numeric[], numeric[]) from public;
grant execute on function public.elect_sign_and_merge(numeric[], numeric[])
  to anon, authenticated;

-- ============================================================
-- 3. compute_merged_score(signals, weights, use_sign_election) — 全工程合成
-- ============================================================
-- TIES の Trim → (Elect Sign →) Merge を 1 関数にまとめた high-level API。
--
--   入力例:
--     p_signals = '{"text_relevance":0.82,"recency":0.41,"engagement":-0.05}'
--     p_weights = '{
--        "text_relevance":{"lambda":1.0,"threshold":0.1},
--        "recency":      {"lambda":0.6,"threshold":0.05},
--        "engagement":   {"lambda":0.4,"threshold":0.1}
--     }'
--     p_use_sign_election = false   → 単純加算 (Trim + 重み付き sum)
--                         = true    → elect_sign_and_merge を経由
--
--   手順:
--     1. p_weights の各 key について lambda / threshold を取り出す
--        (デフォルト lambda=1.0, threshold=0.0)
--     2. p_signals[key] を apply_sparsification(value, threshold) で trim
--     3. contributions = [lambda * trimmed_value, ...] を構築
--     4. use_sign_election=true → elect_sign_and_merge(trimmed_values, lambdas)
--                       false → sum(contributions)
--
--   signals 側に key が無い場合は 0 として扱う (fail-safe)。
--   weights 側に key が無い signal は無視する (重み未定義 = 採用しない)。
--
-- SECURITY DEFINER + search_path lockdown + immutable。
-- ============================================================
drop function if exists public.compute_merged_score(jsonb, jsonb, boolean);
create or replace function public.compute_merged_score(
  p_signals jsonb,
  p_weights jsonb,
  p_use_sign_election boolean default false
)
returns numeric
language plpgsql
immutable
parallel safe
security definer
set search_path = pg_catalog, public
as $$
declare
  v_signal_values numeric[] := '{}'::numeric[];
  v_lambdas       numeric[] := '{}'::numeric[];
  v_simple_sum    numeric   := 0;
  v_key           text;
  v_weight_obj    jsonb;
  v_lambda        numeric;
  v_threshold     numeric;
  v_raw_value     numeric;
  v_trimmed       numeric;
begin
  -- 入力 null / 空 は 0 で fail-safe
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then
    return 0::numeric;
  end if;

  -- p_weights を回して各 signal を処理
  -- (weights を主軸にする = 重み未定義 signal は無視する設計)
  for v_key, v_weight_obj in
    select * from jsonb_each(p_weights)
  loop
    -- weight object は { lambda: x, threshold: y } を想定。
    -- jsonb の値が object でないときは {} 扱い (デフォルト適用)。
    if v_weight_obj is null or jsonb_typeof(v_weight_obj) <> 'object' then
      v_lambda    := 1.0;
      v_threshold := 0.0;
    else
      v_lambda    := coalesce((v_weight_obj ->> 'lambda')::numeric, 1.0);
      v_threshold := coalesce((v_weight_obj ->> 'threshold')::numeric, 0.0);
    end if;

    -- signal 値を取り出す。signals が null / key 不在なら 0。
    if p_signals is null or jsonb_typeof(p_signals) <> 'object' then
      v_raw_value := 0;
    else
      begin
        v_raw_value := coalesce((p_signals ->> v_key)::numeric, 0);
      exception when others then
        -- 数値変換失敗時は 0 にフォールバック
        v_raw_value := 0;
      end;
    end if;

    -- Trim 適用
    v_trimmed := public.apply_sparsification(v_raw_value, v_threshold);

    -- 配列に積む (Elect Sign 用) と並行して simple sum も計算
    v_signal_values := array_append(v_signal_values, v_trimmed);
    v_lambdas       := array_append(v_lambdas, v_lambda);
    v_simple_sum    := v_simple_sum + v_lambda * v_trimmed;
  end loop;

  if p_use_sign_election then
    return public.elect_sign_and_merge(v_signal_values, v_lambdas);
  else
    return v_simple_sum;
  end if;
end;
$$;

comment on function public.compute_merged_score(jsonb, jsonb, boolean) is
  'TIES (Trim + Elect Sign + Merge) を score 線形結合上で近似する high-level RPC。p_use_sign_election=false なら単純な trim 後の重み付き和';

revoke all on function public.compute_merged_score(jsonb, jsonb, boolean) from public;
grant execute on function public.compute_merged_score(jsonb, jsonb, boolean)
  to anon, authenticated;

-- ============================================================
-- 4. signal_sparsification_stats — view (運用観察用)
-- ============================================================
-- sparsification が効きすぎていないか (signal がほぼ全部 0 になっていないか)
-- を監視するための view。
--
-- 計算対象:
--   signal_key                — 0088 ranking_weights の signal_key
--   threshold                 — その signal の閾値
--   mean_value_after_trim     — trim 後の平均値 (= 0 が多いほど低い)
--   pct_zeroed                — trim で 0 になった row の割合 (0..1)
--
-- 実装方針:
--   * ranking_weights / v_search_signals の存在を前提にしないため、
--     to_regclass で実体確認した上で UNION ALL する設計に
--     したいところだが、view 定義に動的 SQL は使えない。
--   * 代わりに「テーブルが存在する前提」で書いた view 本体は
--     create or replace で出し、ranking_weights が無い環境では
--     view 自体の作成を skip する DO block でガードする。
--   * v_search_signals の signal は author_trust / usability_score だけが
--     現状 numeric として揃っているため、それを軸に統計を取る。
--     0088 で追加される signal が増えれば、view 側を後続 migration で拡張する。
-- ============================================================
do $$
declare
  v_have_weights bool := to_regclass('public.ranking_weights') is not null;
  v_have_signals bool := to_regclass('public.v_search_signals') is not null;
begin
  -- どちらか欠けるなら placeholder view (空の正しい schema) で代用する。
  -- これにより API 側が view を SELECT してもエラーにならない。
  execute 'drop view if exists public.signal_sparsification_stats cascade';

  if v_have_weights and v_have_signals then
    -- ranking_weights × v_search_signals が両方そろっている場合の実装。
    -- v_search_signals の numeric 列 (author_trust / usability_score) を
    -- unpivot して signal_key と突き合わせる。
    execute $v$
      create or replace view public.signal_sparsification_stats as
      with signals_long as (
        select
          'author_trust'::text  as signal_key,
          (s.author_trust)::numeric as value
        from public.v_search_signals s
        where s.author_trust is not null
        union all
        select
          'usability_score'::text as signal_key,
          (s.usability_score)::numeric as value
        from public.v_search_signals s
        where s.usability_score is not null
      ),
      joined as (
        select
          sl.signal_key,
          coalesce(w.threshold, 0)::numeric as threshold,
          sl.value as raw_value,
          public.apply_sparsification(sl.value, coalesce(w.threshold, 0)) as trimmed_value
        from signals_long sl
        left join public.ranking_weights w on w.signal_key = sl.signal_key
      )
      select
        signal_key,
        threshold,
        avg(trimmed_value)::numeric as mean_value_after_trim,
        (
          sum(case when trimmed_value = 0 then 1 else 0 end)::numeric
          / nullif(count(*), 0)
        )::numeric as pct_zeroed
      from joined
      group by signal_key, threshold;
    $v$;
  else
    -- placeholder: 0 行を返す view。schema は実装版と一致させる。
    execute $v$
      create or replace view public.signal_sparsification_stats as
      select
        null::text     as signal_key,
        null::numeric  as threshold,
        null::numeric  as mean_value_after_trim,
        null::numeric  as pct_zeroed
      where false;
    $v$;
  end if;

  execute 'comment on view public.signal_sparsification_stats is '
    || quote_literal(
         'signal ごとの trim 後の統計 (mean_value_after_trim / pct_zeroed)。'
         || 'sparsification が効きすぎていないかの監視用'
       );

  execute 'grant select on public.signal_sparsification_stats to anon, authenticated';
end
$$;

-- ============================================================
-- 5. 末尾 note
-- ============================================================
select '0093_score_sparsification 完了 — apply_sparsification / elect_sign_and_merge / compute_merged_score RPC + signal_sparsification_stats view' as note;
