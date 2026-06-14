-- =============================================================================
-- 0151_contests_skeleton.sql — コンテスト機能 Phase 0(★安全版・2026-06-14 監査反映)
-- -----------------------------------------------------------------------------
-- ★ このファイルは 2026-06-14 の仕組み監査(確証42件)で見つかった P0/P1 を全て
--    塞いだ「作り直し版」。前ドラフト(未適用)を置き換える。Geek の不可侵原則:
--    完全匿名 / k-匿名 / コミット後リビール を「構造で」守る。
--
-- 監査で塞いだ要点:
--   [P0-1/P0-2/P1-10] 正解は contests に持たず別表 contest_answers へ。直 UPDATE 不能、
--      確定は DEFINER RPC confirm_contest_result で 1 回だけ(append-only/immutable)。
--      読むのは get_contest_result(result_at 経過後のみ)。world-readable 正解を根絶。
--   [P0-3/P1-6] 称号は client 自己付与をやめ、pg_cron が result_at+24h 後に
--      サーバ側で的中判定して付与(process_due_contest_titles)。authenticated に付与関数を grant しない。
--   [P0-4/P1-1/P1-5] get_contest_breakdown を母集団統一(Σcell=total・残差0)で再実装。
--      single=option セル / star=rating セル(③が動く)。未コミット・N<K には人数も返さない。
--   [P1-2] cp_insert で option の contest 帰属 + input_kind 整合を検証。
--   [P1-3/P1-4] is_public 列を廃止。submission の可視性は now()>=lock_at の動的派生。
--   [P1-7] suspended/warned は enforce_account_state_write() を貼って投票/作成/提出を遮断。
--   [P1-8] contest_reports + 閾値自動 void。voided を起こす入口を用意。
--   [P1-9/P1-11/P2-6] option_id は on delete restrict、締切後の選択肢改変禁止、締切 CHECK 厳格化。
--   [P1-12] 退会は user_id on delete cascade で消える(RPC delete_account 経路)。export 追加は account.ts 側。
--   [P2-12] cp_insert / contests_insert にコミュ可視性(open or member)を要求。
--   [P2-15] realtime publication は付けない(no-op だった)。集計は RPC ポーリング。
--   [P2-16] streak トリガの dead 変数除去・単一 UPDATE 化。
--
-- 既存 migration は編集しない(idempotency)。本ファイルは新規。Supabase SQL エディタで手動適用。
-- 依存: profiles.account_state(0006) / enforce_account_state_write(0106) / is_community_member(0017) /
--       is_admin() / communities.visibility / pg_cron(任意)。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. ユーティリティ:JST 暦週の開始日(月曜 00:00 JST)
-- -----------------------------------------------------------------------------
create or replace function public.jst_week_start(ts timestamptz default now())
returns date language sql immutable as $$
  select (date_trunc('week', ts at time zone 'Asia/Tokyo'))::date;
$$;

-- -----------------------------------------------------------------------------
-- 1. contests — 本体(★正解列は持たない)
-- -----------------------------------------------------------------------------
create table if not exists public.contests (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references public.communities(id) on delete cascade,
  -- ★ 作成者退会でコンテスト本体＋他人の匿名票まで cascade 消去しない(コミュ財産として温存)。
  --    null 化で残す = 0077 の community-owned content と同方針。以後の編集は admin のみ。
  author_id       uuid references auth.users(id) on delete set null,
  title           text not null check (length(btrim(title)) between 1 and 60),
  description     text check (description is null or length(description) <= 600),
  scoring         text not null check (scoring in ('objective','subjective')),
  input_kind      text not null check (input_kind in ('single','star')),
  has_submission  boolean not null default false,
  has_eval_phase  boolean not null default false,
  lock_at         timestamptz not null,
  eval_unlock_at  timestamptz,
  result_at       timestamptz not null,
  voided          boolean not null default false,
  voided_reason   text,
  titles_processed boolean not null default false,   -- pg_cron 冪等フラグ
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- [P2-6] 締切 CHECK 厳格化(0秒フェーズ・1秒締切を DB で禁止)
  check (lock_at >= created_at + interval '15 minutes'),
  check (lock_at <= created_at + interval '90 days'),
  check (result_at > lock_at),
  check ((has_eval_phase = false and eval_unlock_at is null)
      or (has_eval_phase = true  and eval_unlock_at > lock_at and eval_unlock_at < result_at)),
  -- star は集計のみ(正解なし)。objective は single 前提。
  check (not (input_kind = 'star' and scoring = 'objective'))
);
create index if not exists idx_contests_community on public.contests(community_id);
create index if not exists idx_contests_result_at on public.contests(result_at);

alter table public.contests enable row level security;

-- read: コミュが見えるなら見える(非公開コミュは member 限定)。正解列は存在しないので安全。
drop policy if exists contests_read on public.contests;
create policy contests_read on public.contests for select using (
  exists (select 1 from public.communities c where c.id = community_id
          and (c.visibility in ('open','request') or public.is_community_member(c.id)))
);
-- insert: 本人 かつ コミュ open or member [P2-12]
drop policy if exists contests_insert on public.contests;
create policy contests_insert on public.contests for insert with check (
  author_id = auth.uid()
  and exists (select 1 from public.communities c where c.id = community_id
              and (c.visibility = 'open' or public.is_community_member(c.id)))
);
-- update: 作成者/admin(ただし下のトリガで締切後フィールドを凍結)
drop policy if exists contests_update on public.contests;
create policy contests_update on public.contests for update
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());
-- delete: 締切前の作成者 or admin(締切後は不可逆)
drop policy if exists contests_delete on public.contests;
create policy contests_delete on public.contests for delete
  using (public.is_admin() or (author_id = auth.uid() and now() < lock_at));

-- [P0-2] 締切後/確定後の改竄を凍結する BEFORE UPDATE トリガ
create or replace function public.contests_guard_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if public.is_admin() then return new; end if;
  if now() >= old.lock_at then
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

-- -----------------------------------------------------------------------------
-- 2. contest_options — 選択肢(★is_public は持たない=now()>=lock_at で派生)
-- -----------------------------------------------------------------------------
create table if not exists public.contest_options (
  id           uuid primary key default gen_random_uuid(),
  contest_id   uuid not null references public.contests(id) on delete cascade,
  ordinal      smallint not null,
  label        text not null check (length(btrim(label)) between 1 and 80),
  kind         text not null check (kind in ('curated','submission')),
  author_id    uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (contest_id, ordinal)
);
create index if not exists idx_contest_options_contest on public.contest_options(contest_id);

alter table public.contest_options enable row level security;

-- read: コミュ可視性ゲート(contests_read と同条件) AND
--       curated は常時 / submission は評価フェーズ(now>=lock_at)で一斉公開・提出者本人は自作のみ
drop policy if exists co_read on public.contest_options;
create policy co_read on public.contest_options for select using (
  exists (
    select 1 from public.contests c
    join public.communities cm on cm.id = c.community_id
    where c.id = contest_id
      and (cm.visibility in ('open','request') or public.is_community_member(cm.id))
  )
  and (
    kind = 'curated'
    or author_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.contests c where c.id = contest_id and now() >= c.lock_at)
  )
);
-- insert: curated=作成者&締切前 / submission=本人&has_submission&締切前。is_public は無いので恣意公開不能
drop policy if exists co_insert on public.contest_options;
create policy co_insert on public.contest_options for insert with check (
  (kind = 'curated' and exists (
     select 1 from public.contests c where c.id = contest_id and c.author_id = auth.uid() and now() < c.lock_at))
  or
  (kind = 'submission' and author_id = auth.uid() and exists (
     select 1 from public.contests c where c.id = contest_id and c.has_submission and now() < c.lock_at))
);
-- update: 締切前のみ・本人/作成者・列改竄(label/ordinal すり替え)も締切前に限定 [P1-11]
drop policy if exists co_update on public.contest_options;
create policy co_update on public.contest_options for update
  using (
    (author_id = auth.uid() or exists (select 1 from public.contests c where c.id = contest_id and c.author_id = auth.uid()))
    and exists (select 1 from public.contests c where c.id = contest_id and now() < c.lock_at)
  )
  with check (
    exists (select 1 from public.contests c where c.id = contest_id and now() < c.lock_at)
  );
-- delete: 締切前のみ(締切後は不可逆)。票がある option は FK on delete restrict でそもそも消えない [P1-9]
drop policy if exists co_delete on public.contest_options;
create policy co_delete on public.contest_options for delete using (
  public.is_admin()
  or (
    (author_id = auth.uid() or exists (select 1 from public.contests c where c.id = contest_id and c.author_id = auth.uid()))
    and exists (select 1 from public.contests c where c.id = contest_id and now() < c.lock_at)
  )
);

-- 1コンテストあたり curated 上限(spam 防止)
create or replace function public.contest_options_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  if new.kind = 'curated' then
    select count(*) into n from public.contest_options where contest_id = new.contest_id and kind = 'curated';
    if n >= 20 then raise exception 'guard: 選択肢は20個までです' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_contest_options_guard on public.contest_options;
create trigger trg_contest_options_guard before insert on public.contest_options
  for each row execute function public.contest_options_guard();

-- -----------------------------------------------------------------------------
-- 3. contest_predictions — 完全匿名の投票(★SELECT は self/admin のみ)
-- -----------------------------------------------------------------------------
create table if not exists public.contest_predictions (
  id            uuid primary key default gen_random_uuid(),
  contest_id    uuid not null references public.contests(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  option_id     uuid references public.contest_options(id) on delete restrict,  -- [P1-9] 票がある option は消せない
  rating        smallint check (rating is null or rating between 1 and 5),
  comment       text check (comment is null or length(comment) <= 140),
  -- 投票時刻は「時」粒度までに粗くして指紋化を防ぐ(self/admin しか読めず RPC も返さないので de-anon 面なし)
  committed_hour timestamptz not null default date_trunc('hour', now()),
  unique (contest_id, user_id),
  check ((option_id is not null) or (rating is not null))
);
create index if not exists idx_predictions_contest on public.contest_predictions(contest_id);

alter table public.contest_predictions enable row level security;

-- ★ SELECT は self or admin のみ。作成者条件は絶対に書かない。
drop policy if exists cp_read on public.contest_predictions;
create policy cp_read on public.contest_predictions for select using (user_id = auth.uid() or public.is_admin());

-- INSERT: 本人・締切前・未 void・コミュ可視性・option 帰属&input_kind 整合 [P1-2/P2-12]
drop policy if exists cp_insert on public.contest_predictions;
create policy cp_insert on public.contest_predictions for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.contests c where c.id = contest_id
      and c.voided = false and now() < c.lock_at
      -- コミュ可視性
      and exists (select 1 from public.communities cm where cm.id = c.community_id
                  and (cm.visibility = 'open' or public.is_community_member(cm.id)))
      -- input_kind 整合: single→option / star→rating
      and (
        (c.input_kind = 'single' and option_id is not null and rating is null
          and exists (select 1 from public.contest_options co where co.id = option_id and co.contest_id = contest_id))
        or
        (c.input_kind = 'star' and rating is not null and option_id is null)
      )
  )
);
-- ★ UPDATE 不可(予想ロック)。DELETE は admin のみ(退会は auth.users cascade で消える)
drop policy if exists cp_update on public.contest_predictions;
create policy cp_update on public.contest_predictions for update using (false);
drop policy if exists cp_delete on public.contest_predictions;
create policy cp_delete on public.contest_predictions for delete using (public.is_admin());

-- ★ SELECT 権限は authenticated に残す(self-read は cp_read RLS で self/admin に絞る)。
--    table 権限ごと revoke すると RLS で許可しても本人が自票を読めなくなる(RLS は grant の上のフィルタ)。
--    anon は投票を一切読めないよう SELECT を剥奪。
revoke select on public.contest_predictions from anon;
-- committed_hour を client が任意指定できないよう INSERT は列を絞る(default をサーバ強制) [P2-3]
revoke insert on public.contest_predictions from anon, authenticated;
grant insert (contest_id, user_id, option_id, rating, comment) on public.contest_predictions to authenticated;

-- -----------------------------------------------------------------------------
-- 4. contest_answers — 正解(★直接 read/write 不可・RPC 経由のみ)[P0-1/P0-2]
-- -----------------------------------------------------------------------------
create table if not exists public.contest_answers (
  contest_id    uuid primary key references public.contests(id) on delete cascade,
  option_id     uuid not null references public.contest_options(id) on delete restrict,
  confirmed_at  timestamptz not null default now()
);
alter table public.contest_answers enable row level security;
-- 誰も直接触れない(SELECT/INSERT/UPDATE/DELETE 全拒否)。アクセスは DEFINER RPC のみ。
drop policy if exists ca_none on public.contest_answers;
create policy ca_none on public.contest_answers for all using (false) with check (false);
revoke all on public.contest_answers from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. contest_user_titles — コンテスト固有称号(★本人限定・付与は DEFINER のみ)
-- -----------------------------------------------------------------------------
create table if not exists public.contest_user_titles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  contest_id   uuid not null references public.contests(id) on delete cascade,
  code         text not null check (code in ('predicted_hit','contrarian_hit','first_participate')),  -- allowlist [P0-3]
  earned_at    timestamptz not null default now(),
  granted_at   timestamptz,
  unique (user_id, contest_id, code)
);
create index if not exists idx_cut_user on public.contest_user_titles(user_id);
alter table public.contest_user_titles enable row level security;
drop policy if exists cut_read on public.contest_user_titles;
create policy cut_read on public.contest_user_titles for select using (user_id = auth.uid());
drop policy if exists cut_write on public.contest_user_titles;
create policy cut_write on public.contest_user_titles for all using (false) with check (false);
revoke all on public.contest_user_titles from anon, authenticated;
grant select on public.contest_user_titles to authenticated;

-- -----------------------------------------------------------------------------
-- 6. contest_reports — 通報(★閾値で自動 void)[P1-8]
-- -----------------------------------------------------------------------------
create table if not exists public.contest_reports (
  id           uuid primary key default gen_random_uuid(),
  contest_id   uuid not null references public.contests(id) on delete cascade,
  reporter_id  uuid not null references auth.users(id) on delete cascade,
  reason       text check (reason is null or length(reason) <= 200),
  created_at   timestamptz not null default now(),
  unique (contest_id, reporter_id)
);
alter table public.contest_reports enable row level security;
drop policy if exists crp_insert on public.contest_reports;
create policy crp_insert on public.contest_reports for insert with check (
  reporter_id = auth.uid()
  and exists (select 1 from public.contests c where c.id = contest_id and c.author_id is distinct from auth.uid())  -- 自作は通報不可(orphanは通報可)
);
drop policy if exists crp_read on public.contest_reports;
create policy crp_read on public.contest_reports for select using (reporter_id = auth.uid() or public.is_admin());

-- 閾値(3件)到達で自動 void
create or replace function public.contest_reports_autovoid()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  select count(*) into n from public.contest_reports where contest_id = new.contest_id;
  if n >= 3 then
    update public.contests set voided = true, voided_reason = coalesce(voided_reason, '通報多数により自動停止')
     where id = new.contest_id and voided = false;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_contest_reports_autovoid on public.contest_reports;
create trigger trg_contest_reports_autovoid after insert on public.contest_reports
  for each row execute function public.contest_reports_autovoid();

-- -----------------------------------------------------------------------------
-- 7. [P1-7] suspended/warned を遮断(0106 の enforce_account_state_write を再利用)
-- -----------------------------------------------------------------------------
do $$
declare t text;
  tables text[] := array['contests','contest_options','contest_predictions','contest_reports'];
begin
  if to_regprocedure('public.enforce_account_state_write()') is not null then
    foreach t in array tables loop
      execute format('drop trigger if exists zz_enforce_account_state on public.%I', t);
      execute format('create trigger zz_enforce_account_state before insert on public.%I '
                     || 'for each row execute function public.enforce_account_state_write()', t);
    end loop;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8. RPC: confirm_contest_result — 正解確定(★作成者のみ・1回だけ・以後 immutable)[P0-1/P0-2]
-- -----------------------------------------------------------------------------
create or replace function public.confirm_contest_result(p_contest_id uuid, p_option_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contest public.contests%rowtype;
begin
  select * into v_contest from public.contests where id = p_contest_id;
  if not found then raise exception 'not_found'; end if;
  -- author_id は退会で null になり得る(orphan)。null <> uid は NULL=素通りになるため is distinct from を使う。
  if (v_contest.author_id is distinct from auth.uid()) and not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_contest.scoring <> 'objective' then raise exception 'subjective contest has no answer'; end if;
  if now() < v_contest.lock_at then raise exception 'too_early'; end if;
  if v_contest.voided then raise exception 'voided'; end if;
  if not exists (select 1 from public.contest_options co where co.id = p_option_id and co.contest_id = p_contest_id) then
    raise exception 'option not in contest';
  end if;
  -- 1 回だけ(append-only)。既に確定済みなら false。
  insert into public.contest_answers(contest_id, option_id, confirmed_at)
  values (p_contest_id, p_option_id, now())
  on conflict (contest_id) do nothing;
  return found;
end;
$$;
revoke all on function public.confirm_contest_result(uuid, uuid) from public;
grant execute on function public.confirm_contest_result(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. RPC: get_contest_result — 正解の公開(★result_at 経過後のみ)
-- -----------------------------------------------------------------------------
create or replace function public.get_contest_result(p_contest_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contest public.contests%rowtype; v_ans public.contest_answers%rowtype;
begin
  select * into v_contest from public.contests where id = p_contest_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
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
-- 10. RPC: get_contest_breakdown — 集計(★コミット後ゲート + 母集団統一 k-匿名 + star対応)
--     [P0-4/P1-1/P1-5]
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
    when v_now < v_c.lock_at then 'open'
    when v_now < coalesce(v_c.eval_unlock_at, v_c.lock_at) then 'locked'
    when v_now < v_c.result_at then 'evaluating'
    else 'result' end;

  select * into v_my from public.contest_predictions where contest_id = p_contest_id and user_id = auth.uid();

  -- 未コミットには 分布も人数も一切返さない [P1-1]
  if v_my.id is null then
    return jsonb_build_object('now', v_now, 'phase', v_phase, 'lock_at', v_c.lock_at,
      'eval_unlock_at', v_c.eval_unlock_at, 'result_at', v_c.result_at, 'voided', v_c.voided,
      'my_committed', false, 'options', null,
      'k_policy', jsonb_build_object('min_n', K_MIN_N, 'min_cell', K_MIN_CELL));
  end if;

  -- ★ 母集団統一: cell の合計を total とする(残差0=個票が浮かない)
  if v_c.input_kind = 'star' then
    with cells as (
      select g as rating, count(cp.id)::int as c
        from generate_series(1,5) g
        left join public.contest_predictions cp on cp.contest_id = p_contest_id and cp.rating = g
       group by g)
    -- ★ k-匿名は「1人だけのセルを作らない」が趣旨。0票セルは安全なので除外し、非空セルの最小で判定。
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
         -- 評価フェーズ前の submission はセル・total ともに除外(可視と一致)
         and (co.kind = 'curated' or v_now >= v_c.lock_at)
       group by co.id, co.label, co.ordinal)
    -- ★ 0票の選択肢は安全なので k 判定から除外(非空セルの最小で判定)
    select coalesce(sum(c),0), coalesce(min(c) filter (where c > 0), 0) into v_total, v_min_cell from cells;
    v_k_met := (v_total >= K_MIN_N) and (v_min_cell >= K_MIN_CELL);
    if v_k_met then
      select jsonb_agg(jsonb_build_object('option_id', option_id, 'label', label, 'count', c,
               'percent', round((c::numeric / v_total) * 100, 1),
               'is_mine', option_id = v_my.option_id) order by ordinal)
        into v_options
        from (select co.id as option_id, co.label, co.ordinal,
                     count(cp.id)::int as c
                from public.contest_options co
                left join public.contest_predictions cp on cp.option_id = co.id and cp.contest_id = p_contest_id
               where co.contest_id = p_contest_id and (co.kind = 'curated' or v_now >= v_c.lock_at)
               group by co.id, co.label, co.ordinal) q;
    end if;
  end if;

  -- 正解は result_at 経過後・未 void のときだけ(DEFINER で内部読み)
  if v_now >= v_c.result_at and not v_c.voided then
    select option_id into v_ans from public.contest_answers where contest_id = p_contest_id;
  end if;

  return jsonb_build_object('now', v_now, 'phase', v_phase, 'lock_at', v_c.lock_at,
    'eval_unlock_at', v_c.eval_unlock_at, 'result_at', v_c.result_at, 'voided', v_c.voided,
    'my_committed', true, 'my_option_id', v_my.option_id, 'my_rating', v_my.rating,
    -- 人数も N<K の間は伏せる(N=1 標的コンテストの参加事実漏洩を防ぐ)
    'total_n', case when v_total >= K_MIN_N then v_total else null end,
    'k_anonymity_met', v_k_met, 'options', v_options,
    'answer_option_id', v_ans,
    'k_policy', jsonb_build_object('min_n', K_MIN_N, 'min_cell', K_MIN_CELL));
end;
$$;
revoke all on function public.get_contest_breakdown(uuid) from public;
grant execute on function public.get_contest_breakdown(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. RPC: report_contest — 通報(self・1回)[P1-8]
-- -----------------------------------------------------------------------------
create or replace function public.report_contest(p_contest_id uuid, p_reason text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return false; end if;
  insert into public.contest_reports(contest_id, reporter_id, reason)
  values (p_contest_id, auth.uid(), left(coalesce(p_reason,''), 200))
  on conflict (contest_id, reporter_id) do nothing;
  return found;
end;
$$;
revoke all on function public.report_contest(uuid, text) from public;
grant execute on function public.report_contest(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 12. 称号付与: ★client 自己付与は廃止。pg_cron が result_at+24h 後にサーバ判定 [P0-3/P1-6]
-- -----------------------------------------------------------------------------
create or replace function public.process_due_contest_titles()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c record; v_ans uuid; v_p record; v_done int := 0;
begin
  for v_c in
    select * from public.contests
     where voided = false and titles_processed = false
       and scoring = 'objective'
       and now() >= result_at + interval '24 hours'
  loop
    select option_id into v_ans from public.contest_answers where contest_id = v_c.id;
    if v_ans is not null then
      for v_p in select user_id, option_id from public.contest_predictions where contest_id = v_c.id loop
        if v_p.option_id = v_ans then
          insert into public.contest_user_titles(user_id, contest_id, code, earned_at, granted_at)
          values (v_p.user_id, v_c.id, 'predicted_hit', now(), now())
          on conflict (user_id, contest_id, code) do nothing;
          if found then
            update public.profiles set contest_titles_count = contest_titles_count + 1 where id = v_p.user_id;
          end if;
        end if;
      end loop;
    end if;
    update public.contests set titles_processed = true where id = v_c.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;
-- ★ authenticated には grant しない(自己付与を構造で不能に)。cron / service_role のみ。
revoke all on function public.process_due_contest_titles() from public, anon, authenticated;
grant execute on function public.process_due_contest_titles() to service_role;  -- Edge から service_role で叩く経路用

-- pg_cron があれば 15 分毎に実行(無ければ手動 / Edge から service_role で叩く)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('contest-titles') where exists (select 1 from cron.job where jobname='contest-titles');
    perform cron.schedule('contest-titles', '*/15 * * * *', 'select public.process_due_contest_titles();');
  end if;
exception when others then null; end $$;

-- -----------------------------------------------------------------------------
-- 13. profiles 累積カウンタ + 参加トリガ(★streak の dead 変数除去・単一 UPDATE)[P2-16]
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists contest_participation_total int not null default 0,
  add column if not exists contest_streak_weeks int not null default 0,
  add column if not exists contest_titles_count int not null default 0,
  add column if not exists contest_last_participation_week date;

create or replace function public.contests_after_prediction()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_week date := public.jst_week_start(now()); v_last date;
begin
  select contest_last_participation_week into v_last from public.profiles where id = new.user_id for update;
  update public.profiles
     set contest_participation_total = contest_participation_total + 1,
         contest_streak_weeks = case
           when v_last is null then 1
           when v_last = v_week then contest_streak_weeks            -- 同週内の追加参加は据置
           when v_last = v_week - 7 then contest_streak_weeks + 1    -- 直前週から連続(date 同士の演算)
           else 1 end,
         contest_last_participation_week = v_week
   where id = new.user_id;
  return new;
end;
$$;
drop trigger if exists trg_contests_after_prediction on public.contest_predictions;
create trigger trg_contests_after_prediction after insert on public.contest_predictions
  for each row execute function public.contests_after_prediction();

-- =============================================================================
-- ★ realtime publication は付けない [P2-15](投票は contests 行を touch せず no-op だった/
--    人数を脈動公開すると P1-1 の漏洩源にもなる)。集計は get_contest_breakdown のポーリングで配る。
--
-- 適用後の TODO(別作業):
--   - lib/api/contests.ts(confirm_contest_result / get_contest_breakdown / get_contest_result /
--     report_contest / vote(insert) / 締切判定)
--   - GDPR: account.ts の export に contest_predictions / contest_user_titles を追加(本ファイル外)
--   - void 時の称号/カウンタ reconcile RPC(moderator)・誤結果の代理確定 RPC は次段で
-- ロールバックは新 migration(0152_revert_*.sql)で。本ファイルは編集しない。
-- =============================================================================
