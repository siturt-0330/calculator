-- =============================================================================
-- 0156_contest_deadline_invariants.sql — 0155 後の砦修正 ★未適用ドラフト(手動適用)
-- -----------------------------------------------------------------------------
-- 0155 が lock_at/result_at を NULL 可にしたことで開いた穴を、適用後監査(16エージェント・
-- 確証10)が検出。invariant A(投票中=締切なし/締切前は正解を絶対に出さない)を封鎖する。
-- 0155 は confirm_contest_result / contests_guard_update を作り直さないため、ここで NULL 安全化。
--   [P0 AL-1] confirm_contest_result の too_early が lock_at NULL を素通り → 投票中に正解格納
--   [P0 AL-2] contests_guard_update が lock_at NULL で凍結に入らず、作成者が lock を NULL→過去へ flip → reveal
--   [P0 K1 ] objective+submission+result_at NULL で締切後に投票が開いたまま正解が漏れる
--   [P1 AC-1] objective+期限なし は正解を永遠にリビールできない/称号も付かない壊れ状態
-- 方針: ★objective は lock_at と result_at の両方必須(reveal+称号の周期を保証) / ★objective+submission は
--   禁止(K1 の面ごと消す。UI も生成しない) / confirm と guard を NULL 安全化(防御の二重化)。
-- 既存 migration は編集しない。冪等(create or replace / add constraint guard)。
-- 依存: 0151(guard/confirm) / 0152(confirm 0152版) / 0155(NULL化)。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. プリセット/期限の不変条件(NULL オペランドで非違反にならない二値 CHECK。UPDATE flip も塞ぐ)
--    A: objective は lock_at かつ result_at が必須(AC-1 + 称号周期)
--    B: objective+submission は禁止(K1 を面ごと消す。勝敗予想は curated 単一選択のみ)
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname='contests_objective_needs_deadlines' and conrelid='public.contests'::regclass) then
    alter table public.contests add constraint contests_objective_needs_deadlines
      check (scoring <> 'objective' or (lock_at is not null and result_at is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname='contests_objective_no_submission' and conrelid='public.contests'::regclass) then
    alter table public.contests add constraint contests_objective_no_submission
      check (not (scoring = 'objective' and has_submission = true));
  end if;
exception when check_violation then
  raise warning '0156: 既存行が CHECK に違反したため追加を skip。違反行を確認のこと: %', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 2. [P0 AL-1] confirm_contest_result — too_early を NULL 安全化(0152版を維持+1行)
-- -----------------------------------------------------------------------------
create or replace function public.confirm_contest_result(p_contest_id uuid, p_option_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contest public.contests%rowtype;
begin
  if auth.uid() is not null and exists (
    select 1 from public.profiles where id = auth.uid() and account_state in ('suspended','warned')
  ) then
    raise exception 'guard: アカウント制限中のため結果を確定できません' using errcode = '42501';
  end if;
  select * into v_contest from public.contests where id = p_contest_id;
  if not found then raise exception 'not_found'; end if;
  if (v_contest.author_id is distinct from auth.uid()) and not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_contest.scoring <> 'objective' then raise exception 'subjective contest has no answer'; end if;
  -- ★ NULL 安全: lock_at が NULL(締切なし) or 締切前は確定不可(投票中に正解を格納させない)
  if v_contest.lock_at is null or now() < v_contest.lock_at then raise exception 'too_early'; end if;
  if v_contest.voided then raise exception 'voided'; end if;
  if not exists (select 1 from public.contest_options co
                 where co.id = p_option_id and co.contest_id = p_contest_id and co.kind = 'curated') then
    raise exception 'option not in contest';
  end if;
  insert into public.contest_answers(contest_id, option_id, confirmed_at)
  values (p_contest_id, p_option_id, now())
  on conflict (contest_id) do nothing;
  return found;
end;
$$;
revoke all on function public.confirm_contest_result(uuid, uuid) from public;
grant execute on function public.confirm_contest_result(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. [P0 AL-2] contests_guard_update — 凍結を NULL 安全化 + 締切の新設/解除/前倒しを禁止
--    (NULL→過去 flip による即時リビールを封じる。admin は冒頭で素通り)
-- -----------------------------------------------------------------------------
create or replace function public.contests_guard_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if public.is_admin() then return new; end if;
  -- ★ 締切の新設/解除(NULL↔非NULL)と前倒しは作成者でも不可(投票中→即リビール状態への一手遷移を封じる)
  if (old.lock_at is null) is distinct from (new.lock_at is null)
     or (old.lock_at is not null and new.lock_at is not null and new.lock_at < old.lock_at) then
    raise exception 'guard: 締切の新設/解除/前倒しはできません' using errcode = '42501';
  end if;
  -- ★ NULL 安全: 締切後フィールド凍結は lock_at が非NULL かつ経過後のみ
  if old.lock_at is not null and now() >= old.lock_at then
    if new.lock_at <> old.lock_at or new.result_at <> old.result_at
       or coalesce(new.eval_unlock_at, 'epoch') <> coalesce(old.eval_unlock_at, 'epoch')
       or new.scoring <> old.scoring or new.input_kind <> old.input_kind
       or new.has_submission <> old.has_submission or new.has_eval_phase <> old.has_eval_phase then
      raise exception 'guard: 締切後はコンテストの設定を変更できません' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_contests_guard_update on public.contests;
create trigger trg_contests_guard_update before update on public.contests
  for each row execute function public.contests_guard_update();

-- =============================================================================
-- ★ 期限なし(lock_at NULL)が許されるのは subjective かつ非 submission(アンケート/レビュー)のみ。
--   objective(勝敗予想)は CHECK で lock+result 必須 → client も「期限なし」を出さない(create.tsx)。
-- =============================================================================
select '0156_contest_deadline_invariants 完了 — objective は lock+result 必須 / objective+submission 禁止 / confirm の too_early を NULL 安全化 / guard で締切の新設・解除・前倒しを禁止 (AL-1/AL-2/K1/AC-1 封鎖)' as note;
