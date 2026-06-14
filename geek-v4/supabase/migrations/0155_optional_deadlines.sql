-- =============================================================================
-- 0155_optional_deadlines.sql — 期限(締切/結果発表)を任意化 ★未適用ドラフト
-- -----------------------------------------------------------------------------
-- lock_at / result_at を NULL 可に。「締切なし」= ずっと open(いつでも投票でき、
-- コミット後リビールで分布だけ見える)。アンケート/レビュー/予想 向け。
-- ★ 砦: 「lock_at が NULL or 締切前」の間は正解(answer)を絶対に出さない
--   (投票中に正解を見せない)。匿名/k-匿名/コミット後リビールは従来どおり。
-- ★ submission(公募②-a / ④)は作品の一斉公開→投票の二段階に lock_at が構造的に必須なので
--   lock_at NOT NULL を CHECK で要求(co_read の可視性が now>=lock_at に依存するため)。
-- 既存 CHECK(lock>=created+15分 / result>lock 等)は NULL オペランドだと unknown=非違反に
--   なるので、NULL を自動許容する(drop 不要)。非 NULL の時だけ従来どおり強制される。
-- 依存: 0151(contests/RPC) / 0152(cp_insert/get_contest_result 再作成版)。本ファイルは
--   その上で cp_insert / get_contest_result / get_contest_breakdown を NULL 対応に作り直す。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 列を NULL 可に + submission は lock 必須
-- -----------------------------------------------------------------------------
alter table public.contests alter column lock_at   drop not null;
alter table public.contests alter column result_at drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contests_submission_needs_lock' and conrelid = 'public.contests'::regclass) then
    alter table public.contests add constraint contests_submission_needs_lock
      check (has_submission = false or lock_at is not null);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. cp_insert — 締切窓を NULL 対応(締切なし=ずっと投票可)
--    (0152 版に NULL 許容を追加。submission は lock 必須なので下限は option 可視で担保)
-- -----------------------------------------------------------------------------
drop policy if exists cp_insert on public.contest_predictions;
create policy cp_insert on public.contest_predictions for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.contests c where c.id = contest_id
      and c.voided = false
      -- 締切窓: submission は result_at まで(なければ無期限)、それ以外は lock_at まで(なければ無期限)
      and (
        (c.has_submission     and (c.result_at is null or now() < c.result_at))
        or (not c.has_submission and (c.lock_at is null or now() < c.lock_at))
      )
      and exists (select 1 from public.communities cm where cm.id = c.community_id
                  and (cm.visibility = 'open' or public.is_community_member(cm.id)))
      and (
        (c.input_kind = 'single' and option_id is not null and rating is null
          and exists (select 1 from public.contest_options co
                       where co.id = option_id and co.contest_id = contest_id
                         and (co.kind = 'curated' or now() >= c.lock_at)))
        or
        (c.input_kind = 'star' and rating is not null and option_id is null)
      )
  )
);

-- -----------------------------------------------------------------------------
-- 3. get_contest_result — NULL 対応(締切なし/締切前は正解を出さない)
-- -----------------------------------------------------------------------------
create or replace function public.get_contest_result(p_contest_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contest public.contests%rowtype; v_ans public.contest_answers%rowtype;
begin
  select * into v_contest from public.contests where id = p_contest_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  -- 可視性ゲート(invite コミュの非メンバーには返さない)
  if not exists (select 1 from public.communities cm where cm.id = v_contest.community_id
                 and (cm.visibility in ('open','request') or public.is_community_member(cm.id))) then
    return jsonb_build_object('error','forbidden');
  end if;
  if v_contest.voided then return jsonb_build_object('voided', true); end if;
  -- ★ 投票中(締切なし or 締切前)は正解を出さない
  if v_contest.lock_at is null or now() < v_contest.lock_at then return jsonb_build_object('revealed', false); end if;
  -- result_at があり未到達なら未公開
  if v_contest.result_at is not null and now() < v_contest.result_at then return jsonb_build_object('revealed', false); end if;
  select * into v_ans from public.contest_answers where contest_id = p_contest_id;
  if not found then return jsonb_build_object('revealed', true, 'answer_option_id', null); end if;
  return jsonb_build_object('revealed', true, 'answer_option_id', v_ans.option_id, 'confirmed_at', v_ans.confirmed_at);
end;
$$;
revoke all on function public.get_contest_result(uuid) from public;
grant execute on function public.get_contest_result(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. get_contest_breakdown — phase / 正解ゲートを NULL 対応
--    (集計・k-匿名ロジックは 0151 と同一。phase と answer ゲートだけ NULL 安全化)
-- -----------------------------------------------------------------------------
create or replace function public.get_contest_breakdown(p_contest_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  K_MIN_N    constant int := 5;
  K_MIN_CELL constant int := 2;
  v_now      timestamptz := now();
  v_c        public.contests%rowtype;
  v_my       public.contest_predictions%rowtype;
  v_total    int := 0;
  v_min_cell int := 0;
  v_k_met    boolean := false;
  v_options  jsonb;
  v_phase    text;
  v_ans      uuid;
begin
  select * into v_c from public.contests where id = p_contest_id;
  if not found then return jsonb_build_object('error','not_found'); end if;

  v_phase := case
    when v_c.voided then 'voided'
    when v_c.lock_at is null then 'open'                                       -- ★ 締切なし = ずっと open
    when v_now < v_c.lock_at then 'open'
    when v_c.result_at is null then 'locked'                                    -- ★ lock 後・result 未設定
    when v_now < coalesce(v_c.eval_unlock_at, v_c.lock_at) then 'locked'
    when v_now < v_c.result_at then 'evaluating'
    else 'result' end;

  select * into v_my from public.contest_predictions where contest_id = p_contest_id and user_id = auth.uid();

  -- 未コミットには 分布も人数も一切返さない
  if v_my.id is null then
    return jsonb_build_object('now', v_now, 'phase', v_phase, 'lock_at', v_c.lock_at,
      'eval_unlock_at', v_c.eval_unlock_at, 'result_at', v_c.result_at, 'voided', v_c.voided,
      'my_committed', false, 'options', null,
      'k_policy', jsonb_build_object('min_n', K_MIN_N, 'min_cell', K_MIN_CELL));
  end if;

  -- ★ 母集団統一: cell の合計を total とする(残差0)。0票セルは k 判定から除外(非空セルの最小)。
  if v_c.input_kind = 'star' then
    with cells as (
      select g as rating, count(cp.id)::int as c
        from generate_series(1,5) g
        left join public.contest_predictions cp on cp.contest_id = p_contest_id and cp.rating = g
       group by g)
    select coalesce(sum(c),0), coalesce(min(c) filter (where c > 0), 0) into v_total, v_min_cell from cells;
    v_k_met := (v_total >= K_MIN_N) and (v_min_cell >= K_MIN_CELL);
    if v_k_met then
      select jsonb_agg(jsonb_build_object('rating', rating, 'count', c,
               'percent', round((c::numeric / v_total) * 100, 1),
               'is_mine', rating = v_my.rating) order by rating desc)
        into v_options
        from (select g as rating, count(cp.id)::int as c
                from generate_series(1,5) g
                left join public.contest_predictions cp on cp.contest_id = p_contest_id and cp.rating = g
               group by g) q;
    end if;
  else
    with cells as (
      select co.id as option_id, co.label, count(cp.id)::int as c, co.ordinal
        from public.contest_options co
        left join public.contest_predictions cp on cp.option_id = co.id and cp.contest_id = p_contest_id
       where co.contest_id = p_contest_id
         and (co.kind = 'curated' or v_now >= v_c.lock_at)
       group by co.id, co.label, co.ordinal)
    select coalesce(sum(c),0), coalesce(min(c) filter (where c > 0), 0) into v_total, v_min_cell from cells;
    v_k_met := (v_total >= K_MIN_N) and (v_min_cell >= K_MIN_CELL);
    if v_k_met then
      select jsonb_agg(jsonb_build_object('option_id', option_id, 'label', label, 'count', c,
               'percent', round((c::numeric / v_total) * 100, 1),
               'is_mine', option_id = v_my.option_id) order by ordinal)
        into v_options
        from (select co.id as option_id, co.label, co.ordinal, count(cp.id)::int as c
                from public.contest_options co
                left join public.contest_predictions cp on cp.option_id = co.id and cp.contest_id = p_contest_id
               where co.contest_id = p_contest_id and (co.kind = 'curated' or v_now >= v_c.lock_at)
               group by co.id, co.label, co.ordinal) q;
    end if;
  end if;

  -- ★ 正解は「投票が締め切られた後(lock 非NULL かつ経過) + (result_at なし or 経過) + 未void」のみ。
  --   締切なし(lock NULL)は投票中なので絶対に出さない。
  if not v_c.voided and v_c.lock_at is not null and v_now >= v_c.lock_at
     and (v_c.result_at is null or v_now >= v_c.result_at) then
    select option_id into v_ans from public.contest_answers where contest_id = p_contest_id;
  end if;

  return jsonb_build_object('now', v_now, 'phase', v_phase, 'lock_at', v_c.lock_at,
    'eval_unlock_at', v_c.eval_unlock_at, 'result_at', v_c.result_at, 'voided', v_c.voided,
    'my_committed', true, 'my_option_id', v_my.option_id, 'my_rating', v_my.rating,
    'total_n', case when v_total >= K_MIN_N then v_total else null end,
    'k_anonymity_met', v_k_met, 'options', v_options,
    'answer_option_id', v_ans,
    'k_policy', jsonb_build_object('min_n', K_MIN_N, 'min_cell', K_MIN_CELL));
end;
$$;
revoke all on function public.get_contest_breakdown(uuid) from public;
grant execute on function public.get_contest_breakdown(uuid) to anon, authenticated;

-- =============================================================================
-- ★ 適用後に砦の再監査を回す(締切 NULL で「投票中に正解が漏れない」「締切なしでも
--   k-匿名/コミット後リビールが従来どおり」を確証)。
-- =============================================================================
select '0155_optional_deadlines 完了 — lock_at/result_at を NULL 可に + cp_insert/get_contest_result/get_contest_breakdown を NULL 対応(締切なし=ずっとopen・投票中は正解非公開) + submission は lock 必須 CHECK' as note;
