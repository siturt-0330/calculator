-- =============================================================================
-- 0152_contest_audit_fixes.sql — 0151 適用後監査(2026-06-14・確証19件)の P1/P2 修正
-- -----------------------------------------------------------------------------
-- ★ 0151 はすでに本番適用済み。本ファイルはその上に積む差分。0151 は編集しない。
--    Supabase SQL エディタで手動適用。冪等(drop/create or replace/add constraint)。
--    ★ 適用前提: contest クライアント(lib/api/contests.ts)はまだ無い=旧バイナリが
--      contests/contest_options を author_id 込みで直 select していない(P1-1 の列 revoke が安全に効く)。
--
-- 直す確証 P1(クライアント構築前に必須):
--   [P1-1] author_id 世界読み取り(contests / contest_options) → de-anon 退行。
--          0138 と同じ「table SELECT revoke → author_id 以外を列 GRANT」で封じる。
--          co_insert/co_update/co_delete/crp_insert は contests.author_id を cross-table
--          参照しているので、先に is_contest_author() DEFINER ヘルパへ逃がす(列権限非依存化)。
--   [P1-2] co_update が contest_id/kind/author_id を凍結せず → option 付け替え/kind 改竄。
--          → BEFORE UPDATE トリガで identity 列を不変化(RLS の WITH CHECK は OLD を見られない)。
--   [P1-3] predictions.option_id ON DELETE RESTRICT が締切前の正当なコンテスト削除をブロック。
--          → option_id を ON DELETE CASCADE に変更し、「票のある option の単独削除禁止」は
--            co_delete RLS の not exists に移す(コンテスト全体 cascade は RLS を通らない)。
--   [P1-4] ②-a/④(has_submission)が投票不能(可視窓 now>=lock_at と投票窓 now<lock_at が排他)。
--          → cp_insert の締切窓を has_submission で分岐(submission は lock_at〜result_at)。
--   [P1-5] eval_phase 無機能 → has_submission 経由で post-lock 投票が成立し評価フェーズが実体化。
--
-- 安価で正しい P2(同梱):
--   [P2] confirm_contest_result が suspended/warned を遮断しない → アカウント状態ガード追加。
--   [P2] get_contest_result が invite コミュの answer を非メンバーに渡す → 可視性ゲート追加。
--   [P2] star+submission / eval+no-submission の無意味な組合せ → CHECK で 5 プリセットに整形。
--   [obs] cron 登録の無言 null を可視 warning + 事後検証に置換。
--
-- 見送り(別途・本ファイル外): contrarian_hit/first_participate の付与経路(プロダクト判断)、
--   void 時のカウンタ reconcile(カウンタは self/admin のみ可視=公開漏れ無しの nit)、
--   ④ を objective にするか(下記 §7 のコメント参照・要ユーザー判断)。
-- 依存: is_admin() / is_community_member(uuid) / communities.visibility / profiles.account_state。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §1. is_contest_author(uuid) — DEFINER ヘルパ(列権限を介さず作成者判定)
--     ★ これを挟むことで §6 で contests.author_id の列 SELECT を anon/authenticated から
--        revoke しても、co_*/crp_insert の cross-table 参照が permission denied で壊れない。
--        orphan(author_id null)は false を返す(= orphan の option は admin しか触れず・通報は可)。
-- -----------------------------------------------------------------------------
create or replace function public.is_contest_author(p_contest_id uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce((select author_id = auth.uid() from public.contests where id = p_contest_id), false);
$$;
revoke all on function public.is_contest_author(uuid) from public;
grant execute on function public.is_contest_author(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- §2. contest_options / contest_reports のポリシーを is_contest_author に張り替え
--     (cross-table の c.author_id 参照を排除)。co_delete には [P1-3] の票ガードも同梱。
-- -----------------------------------------------------------------------------
drop policy if exists co_insert on public.contest_options;
create policy co_insert on public.contest_options for insert with check (
  (kind = 'curated' and public.is_contest_author(contest_id)
     and exists (select 1 from public.contests c where c.id = contest_id and now() < c.lock_at))
  or
  (kind = 'submission' and author_id = auth.uid()
     and exists (select 1 from public.contests c where c.id = contest_id and c.has_submission and now() < c.lock_at))
);

drop policy if exists co_update on public.contest_options;
create policy co_update on public.contest_options for update
  using (
    (author_id = auth.uid() or public.is_contest_author(contest_id))
    and exists (select 1 from public.contests c where c.id = contest_id and now() < c.lock_at)
  )
  with check (
    exists (select 1 from public.contests c where c.id = contest_id and now() < c.lock_at)
  );

-- [P1-3] 票のある option は「単独削除」だけ禁止(コンテスト全体削除の cascade は RLS を通らないので影響なし)
drop policy if exists co_delete on public.contest_options;
create policy co_delete on public.contest_options for delete using (
  public.is_admin()
  or (
    (author_id = auth.uid() or public.is_contest_author(contest_id))
    and exists (select 1 from public.contests c where c.id = contest_id and now() < c.lock_at)
    and not exists (select 1 from public.contest_predictions cp where cp.option_id = contest_options.id)
  )
);

drop policy if exists crp_insert on public.contest_reports;
create policy crp_insert on public.contest_reports for insert with check (
  reporter_id = auth.uid()
  and not public.is_contest_author(contest_id)   -- 自作は通報不可(orphan は is_contest_author=false → 通報可)
);

-- -----------------------------------------------------------------------------
-- §3. [P1-2] contest_options の identity 列を UPDATE で凍結する BEFORE UPDATE トリガ
--     (RLS の WITH CHECK は OLD を参照できないため、列の不変化はトリガで担保)
-- -----------------------------------------------------------------------------
create or replace function public.contest_options_guard_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  if public.is_admin() then return new; end if;
  if new.contest_id is distinct from old.contest_id
     or new.kind      is distinct from old.kind
     or new.author_id is distinct from old.author_id then
    raise exception 'guard: option の contest/kind/author は変更できません(label/ordinal のみ可)'
      using errcode = '42501';
  end if;
  -- 念のため: curated を編集しても 20 上限を保つ(自分自身は除外)
  if new.kind = 'curated' then
    select count(*) into n from public.contest_options
      where contest_id = new.contest_id and kind = 'curated' and id <> new.id;
    if n >= 20 then raise exception 'guard: 選択肢は20個までです' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_contest_options_guard_update on public.contest_options;
create trigger trg_contest_options_guard_update before update on public.contest_options
  for each row execute function public.contest_options_guard_update();

-- -----------------------------------------------------------------------------
-- §4. [P1-3] predictions.option_id を ON DELETE RESTRICT → CASCADE に変更
--     (票のある option を含むコンテストの「全体削除」が cascade 中の RESTRICT で abort する問題)
--     単独 option 削除の保護は §2 の co_delete(not exists 票)へ移譲済み。
-- -----------------------------------------------------------------------------
do $$
declare v_fk text;
begin
  select conname into v_fk
    from pg_constraint
   where conrelid = 'public.contest_predictions'::regclass
     and contype = 'f'
     and confrelid = 'public.contest_options'::regclass
   limit 1;
  if v_fk is not null then
    execute format('alter table public.contest_predictions drop constraint %I', v_fk);
  end if;
  alter table public.contest_predictions
    add constraint contest_predictions_option_id_fkey
    foreign key (option_id) references public.contest_options(id) on delete cascade;
  raise notice '0152 §4: contest_predictions.option_id -> on delete cascade (旧FK=% )', coalesce(v_fk,'(none)');
exception when others then
  raise warning '0152 §4: option_id FK の付け替えに失敗: % (手動で確認のこと)', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- §5. [P1-4/P1-5] cp_insert の締切窓を has_submission で分岐
--     - submission(②-a/④): 作品は lock_at で一斉公開 → 投票は lock_at〜result_at。
--     - curated/star(①/②-b/③): 従来どおり lock_at 未満で締切(予想ロック)。
--     - 「見えている選択肢にしか投票できない」を option サブクエリにも反映(curated 常時 / submission は lock_at 以降)。
-- -----------------------------------------------------------------------------
drop policy if exists cp_insert on public.contest_predictions;
create policy cp_insert on public.contest_predictions for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.contests c where c.id = contest_id
      and c.voided = false
      and (
        (c.has_submission     and now() < c.result_at)
        or (not c.has_submission and now() < c.lock_at)
      )
      -- コミュ可視性
      and exists (select 1 from public.communities cm where cm.id = c.community_id
                  and (cm.visibility = 'open' or public.is_community_member(cm.id)))
      -- input_kind 整合 + 可視選択肢整合
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
-- §6. [P1-1] author_id 世界読み取りの封じ込め(0138 と同型: table SELECT revoke → author_id 以外を列 GRANT)
--     ★ §1/§2 で cross-table の author_id 参照は is_contest_author に逃がし済み。
--        RLS が自テーブルの author_id を参照するのは列権限不要なので co_read/cp_read 等は壊れない。
--     ★ DEFINER RPC(get_contest_breakdown/result, confirm, process_due, is_contest_author)は owner 権限で
--        author_id を読むため影響なし。
--     ★ 将来 contests クライアントは author_id を select しない(列を明示列挙する)こと。`select('*')` は不可。
-- -----------------------------------------------------------------------------
do $$
declare cols text; leaked text; missing text;
begin
  -- contest_options: author_id 以外の現存全列を列 GRANT
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema='public' and table_name='contest_options' and column_name <> 'author_id';
  if cols is null then raise exception 'abort 0152: public.contest_options の列が取得できません'; end if;
  revoke select on public.contest_options from authenticated, anon;
  execute format('grant select (%s) on public.contest_options to authenticated, anon', cols);
  select string_agg(distinct grantee, ', ') into leaked
    from information_schema.role_column_grants
   where table_schema='public' and table_name='contest_options'
     and column_name='author_id' and privilege_type='SELECT' and grantee in ('anon','authenticated');
  if leaked is not null then raise exception 'abort 0152/contest_options: author_id がまだ % に SELECT 可能', leaked; end if;
  select string_agg(c.column_name, ', ') into missing
    from information_schema.columns c
   where c.table_schema='public' and c.table_name='contest_options' and c.column_name <> 'author_id'
     and not exists (select 1 from information_schema.role_column_grants g
                     where g.table_schema='public' and g.table_name='contest_options'
                       and g.column_name=c.column_name and g.grantee='authenticated' and g.privilege_type='SELECT');
  if missing is not null then raise exception 'abort 0152/contest_options: 次の列が未 GRANT = 読みが壊れます: %', missing; end if;
  raise notice '0152 contest_options: author_id 以外を列 GRANT 済: %', cols;
end $$;

do $$
declare cols text; leaked text; missing text;
begin
  -- contests: author_id 以外の現存全列を列 GRANT(作成者は公開しない方針=本文/スケジュール等のみ)
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema='public' and table_name='contests' and column_name <> 'author_id';
  if cols is null then raise exception 'abort 0152: public.contests の列が取得できません'; end if;
  revoke select on public.contests from authenticated, anon;
  execute format('grant select (%s) on public.contests to authenticated, anon', cols);
  select string_agg(distinct grantee, ', ') into leaked
    from information_schema.role_column_grants
   where table_schema='public' and table_name='contests'
     and column_name='author_id' and privilege_type='SELECT' and grantee in ('anon','authenticated');
  if leaked is not null then raise exception 'abort 0152/contests: author_id がまだ % に SELECT 可能', leaked; end if;
  select string_agg(c.column_name, ', ') into missing
    from information_schema.columns c
   where c.table_schema='public' and c.table_name='contests' and c.column_name <> 'author_id'
     and not exists (select 1 from information_schema.role_column_grants g
                     where g.table_schema='public' and g.table_name='contests'
                       and g.column_name=c.column_name and g.grantee='authenticated' and g.privilege_type='SELECT');
  if missing is not null then raise exception 'abort 0152/contests: 次の列が未 GRANT = 読みが壊れます: %', missing; end if;
  raise notice '0152 contests: author_id 以外を列 GRANT 済: %', cols;
end $$;

-- -----------------------------------------------------------------------------
-- §7. [P2] プリセット整形 CHECK(明らかに壊れる組合せだけ禁止)
--     - star+submission は禁止: submission option は star 集計に絶対に出ない(silent dead data)。
--     - eval は submission 前提: 評価する対象(作品)が無い eval フェーズは無意味。
--     ※ objective+submission は「正解は result_at まで隠蔽=不変」なので破綻はせず、ここでは禁止しない。
--        ④ を objective(予想)にするか subjective(評価)にするかは未確定 → 必要なら別途 CHECK 追加。
--     既存行は無い想定(クライアント未実装)。違反行があると ADD は失敗する(その場合は行を確認)。
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname='contests_submission_requires_single' and conrelid='public.contests'::regclass) then
    alter table public.contests add constraint contests_submission_requires_single
      check (has_submission = false or input_kind = 'single');
  end if;
  if not exists (select 1 from pg_constraint where conname='contests_eval_requires_submission' and conrelid='public.contests'::regclass) then
    alter table public.contests add constraint contests_eval_requires_submission
      check (has_eval_phase = false or has_submission = true);
  end if;
exception when check_violation then
  raise warning '0152 §7: 既存行が CHECK に違反したため制約追加を skip。違反行を確認のこと: %', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- §8. [P2] confirm_contest_result: suspended/warned を遮断 + 正解は curated option 限定
-- -----------------------------------------------------------------------------
create or replace function public.confirm_contest_result(p_contest_id uuid, p_option_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contest public.contests%rowtype;
begin
  -- [P2] アカウント制限中(suspended/warned)は結果確定もできない。auth.uid() は DEFINER 下でも caller を返す。
  if auth.uid() is not null and exists (
    select 1 from public.profiles where id = auth.uid() and account_state in ('suspended','warned')
  ) then
    raise exception 'guard: アカウント制限中のため結果を確定できません' using errcode = '42501';
  end if;
  select * into v_contest from public.contests where id = p_contest_id;
  if not found then raise exception 'not_found'; end if;
  if (v_contest.author_id is distinct from auth.uid()) and not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_contest.scoring <> 'objective' then raise exception 'subjective contest has no answer'; end if;
  if now() < v_contest.lock_at then raise exception 'too_early'; end if;
  if v_contest.voided then raise exception 'voided'; end if;
  -- 正解は curated option のみ(submission を正解にしない)
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
-- §9. [P2] get_contest_result: invite コミュの answer を非メンバーに渡さない(可視性ゲート)
-- -----------------------------------------------------------------------------
create or replace function public.get_contest_result(p_contest_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contest public.contests%rowtype; v_ans public.contest_answers%rowtype;
begin
  select * into v_contest from public.contests where id = p_contest_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  -- contests_read と同条件: invite コミュの非メンバーには返さない
  if not exists (select 1 from public.communities cm where cm.id = v_contest.community_id
                 and (cm.visibility in ('open','request') or public.is_community_member(cm.id))) then
    return jsonb_build_object('error','forbidden');
  end if;
  if v_contest.voided then return jsonb_build_object('voided', true); end if;
  if now() < v_contest.result_at then return jsonb_build_object('revealed', false); end if;
  select * into v_ans from public.contest_answers where contest_id = p_contest_id;
  if not found then return jsonb_build_object('revealed', true, 'answer_option_id', null); end if;
  return jsonb_build_object('revealed', true, 'answer_option_id', v_ans.option_id, 'confirmed_at', v_ans.confirmed_at);
end;
$$;
revoke all on function public.get_contest_result(uuid) from public;
grant execute on function public.get_contest_result(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- §10. [obs] cron 登録を「無言 null」から「可視 warning + 事後検証」に置換(silent half-apply 防止)
-- -----------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('contest-titles') where exists (select 1 from cron.job where jobname='contest-titles');
      perform cron.schedule('contest-titles', '*/15 * * * *', 'select public.process_due_contest_titles();');
    exception when others then
      raise warning '0152: contest-titles cron 登録に失敗: % — service_role/Edge から process_due_contest_titles() を15分毎に叩く運用にフォールバック', sqlerrm;
    end;
    if not exists (select 1 from cron.job where jobname='contest-titles') then
      raise warning '0152: contest-titles cron が登録されていません — Edge/service_role polling にフォールバックすること';
    end if;
  else
    raise warning '0152: pg_cron 無し — process_due_contest_titles() を Edge(service_role)から15分毎に呼ぶこと';
  end if;
end $$;

-- =============================================================================
-- 適用後の確認: scripts/verify_contest_migration.sql を Supabase SQL エディタで実行。
--   特に [4] で authenticated が process_due_contest_titles を実行できない(false)こと、
--   author_id の列 GRANT が anon/authenticated に無いこと(下記)を確認:
--     select grantee, table_name, column_name from information_schema.role_column_grants
--      where table_schema='public' and table_name in ('contests','contest_options')
--        and column_name='author_id' and privilege_type='SELECT' and grantee in ('anon','authenticated');
--     -- → 0 行が正(author_id は誰にも列 GRANT していない)
-- ロールバック(壊れたら): grant select on public.contests to authenticated, anon;
--                          grant select on public.contest_options to authenticated, anon;  (author_id も再び読めるようになる)
-- =============================================================================
select '0152_contest_audit_fixes 完了 — P1×5(author_id封じ/option凍結/FK cascade/投票窓/eval実体化)+ P2(BAN/可視性/CHECK)+ cron可視化' as note;
