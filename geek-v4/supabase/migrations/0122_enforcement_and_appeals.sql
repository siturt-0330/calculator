-- ============================================================
-- 0122_enforcement_and_appeals.sql
-- ============================================================
-- 段階的措置(progressive enforcement)と異議申し立て(appeals)。
-- 設計根拠: docs/ADMIN_CONSOLE.md §5.2/§5.3 / 外部調査 §6.1/§6.4 (YouTube/TikTok型)。
--
--   enforcement_actions: 警告(0)→機能制限(1)→一時停止(2)→永久BAN(3) の強度ladder。
--     strike(level 0-1)は issued+90日で失効。重大違反は即最上位(level指定)でバイパス可。
--     append-only(UPDATE/DELETE policy 無し)。
--   appeals: 措置への異議。本人が申立、admin が審査。
--   apply_enforcement(): 措置を記録 + account_state 同期 + moderation_log 記録。
--   active_strike_count(): 失効していない strike(level<=1) の数。
--
-- 依存: 0118(report_cases) / 0120(is_admin) / 既存 profiles.account_state / moderation_log。
-- 冪等・top-level定義・SQL editor手動適用前提・未適用でもクライアントは degrade。
-- ============================================================

-- ------------------------------------------------------------
-- 1) enforcement_actions (append-only)
-- ------------------------------------------------------------
create table if not exists public.enforcement_actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  level         int  not null check (level between 0 and 3),  -- 0:warning 1:feature_limit 2:temp_suspension 3:permanent_ban
  scope         text not null default 'global',                -- 'global' | 'post' | 'comment' | 'dm'
  reason        text default '',
  policy_ref    text,                                          -- 適用ポリシー(statement of reasons 用)
  issued_by     uuid references auth.users(id) on delete set null,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz,                                   -- strike失効/一時措置解除。null=恒久
  linked_case_id uuid,                                         -- report_cases.id (FK無し=履歴保持)
  created_at    timestamptz not null default now()
);

create index if not exists enforcement_actions_user_idx
  on public.enforcement_actions (user_id, issued_at desc);
create index if not exists enforcement_actions_active_idx
  on public.enforcement_actions (user_id, expires_at)
  where expires_at is not null;

alter table public.enforcement_actions enable row level security;

-- select: admin 全件 / 本人は自分の措置を閲覧可(透明性)
drop policy if exists "enforcement_select" on public.enforcement_actions;
create policy "enforcement_select" on public.enforcement_actions for select
  using (public.is_admin() or user_id = auth.uid());

-- insert: admin のみ(通常は apply_enforcement RPC 経由)
drop policy if exists "enforcement_insert" on public.enforcement_actions;
create policy "enforcement_insert" on public.enforcement_actions for insert
  with check (public.is_admin() and issued_by = auth.uid());

-- UPDATE / DELETE policy は作らない = append-only (措置履歴の改ざん防止)

-- ------------------------------------------------------------
-- 2) appeals (異議申し立て)
-- ------------------------------------------------------------
create table if not exists public.appeals (
  id           uuid primary key default gen_random_uuid(),
  action_id    uuid not null references public.enforcement_actions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  message      text not null check (length(message) between 1 and 2000),
  status       text not null default 'pending' check (status in ('pending','approved','denied')),
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  decision_note text,
  created_at   timestamptz not null default now()
);

create index if not exists appeals_status_idx on public.appeals (status, created_at desc);
create index if not exists appeals_user_idx on public.appeals (user_id, created_at desc);

alter table public.appeals enable row level security;

-- insert: 本人のみ(自分の措置への異議)
drop policy if exists "appeals_insert" on public.appeals;
create policy "appeals_insert" on public.appeals for insert
  with check (user_id = auth.uid());

-- select: 本人 or admin
drop policy if exists "appeals_select" on public.appeals;
create policy "appeals_select" on public.appeals for select
  using (user_id = auth.uid() or public.is_admin());

-- update: admin のみ(審査: status/reviewed_*)
drop policy if exists "appeals_admin_update" on public.appeals;
create policy "appeals_admin_update" on public.appeals for update
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 3) active_strike_count() — 失効していない strike(level<=1) 数
-- ------------------------------------------------------------
create or replace function public.active_strike_count(p_user_id uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $fn$
  select count(*)::int
  from public.enforcement_actions
  where user_id = p_user_id
    and level <= 1
    and expires_at is not null
    and expires_at > now();
$fn$;

-- ------------------------------------------------------------
-- 4) apply_enforcement() — 措置を記録 + account_state 同期 + 監査ログ
-- ------------------------------------------------------------
-- level: 0:warning 1:feature_limit 2:temp_suspension 3:permanent_ban
-- p_expires_at 省略時: level<=1(strike)は issued+90日、level>=2 は null(恒久/別途解除)。
-- 重大違反は p_level=3 を直接渡せば累積を待たず即 BAN(バイパス)。
create or replace function public.apply_enforcement(
  p_user_id    uuid,
  p_level      int,
  p_scope      text default 'global',
  p_reason     text default '',
  p_case_id    uuid default null,
  p_expires_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id    uuid;
  v_state text;
  v_exp   timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  if p_level < 0 or p_level > 3 then
    raise exception 'invalid level: %', p_level;
  end if;

  -- strike(警告/機能制限)は 90 日失効、一時/恒久措置は引数 or null
  v_exp := coalesce(p_expires_at, case when p_level <= 1 then now() + interval '90 days' else null end);

  insert into public.enforcement_actions
    (user_id, level, scope, reason, issued_by, issued_at, expires_at, linked_case_id)
  values
    (p_user_id, p_level, coalesce(p_scope, 'global'), p_reason, auth.uid(), now(), v_exp, p_case_id)
  returning id into v_id;

  -- account_state 同期 (guard_profile_update 0105 は admin の UPDATE を許可)
  v_state := case p_level
               when 3 then 'suspended'
               when 2 then 'suspended'
               when 1 then 'restricted'
               else 'caution'
             end;
  update public.profiles set account_state = v_state where id = p_user_id;

  -- 監査ログ (append-only moderation_log)
  insert into public.moderation_log (admin_id, action, target_type, target_id, reason, metadata)
  values (
    auth.uid(),
    case when p_level >= 2 then 'suspend_user' else 'note' end,
    'user', p_user_id,
    coalesce(nullif(p_reason, ''), 'enforcement applied'),
    jsonb_build_object('level', p_level, 'scope', p_scope, 'enforcement_id', v_id,
                       'case_id', p_case_id, 'account_state', v_state, 'expires_at', v_exp)
  );

  return v_id;
end;
$fn$;

-- ------------------------------------------------------------
-- 5) review_appeal() — admin が異議を承認/却下
-- ------------------------------------------------------------
create or replace function public.review_appeal(
  p_appeal_id uuid,
  p_approve   boolean,
  p_note      text default ''
)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  update public.appeals
     set status = case when p_approve then 'approved' else 'denied' end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         decision_note = p_note
   where id = p_appeal_id
   returning user_id into v_user;
  if v_user is null then
    raise exception 'appeal not found: %', p_appeal_id;
  end if;
  insert into public.moderation_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'note', 'user', v_user,
          coalesce(nullif(p_note, ''), 'appeal reviewed'),
          jsonb_build_object('appeal_id', p_appeal_id, 'approved', p_approve));
end;
$fn$;

-- ------------------------------------------------------------
-- 6) grants
-- ------------------------------------------------------------
grant execute on function public.active_strike_count(uuid) to authenticated;
grant execute on function public.apply_enforcement(uuid, int, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.review_appeal(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------
-- 完了マーカー
-- ------------------------------------------------------------
select '0122_enforcement_and_appeals 完了: enforcement_actions(append-only) + appeals + apply_enforcement/active_strike_count/review_appeal RPC' as result;
