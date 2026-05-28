-- ============================================================
-- 0069: コミュニティ メンバーの昇格 / 降格 (promote / demote)
-- ============================================================
-- 設計:
--   community_members.role を 'member' ↔ 'admin' で切り替える RPC を提供する。
--   owner だけが promote/demote 可能。admin が admin を作れると階層が崩れる
--   (admin が他 admin を kick できない RLS と整合性が取れない) ため。
--
--   owner 自身の role は変更不可 (owner は唯一 1 名 / コミュニティの設計)。
--   target が自分自身であってもブロック (== owner が自分を降格させない)。
--
-- 既存 (0068):
--   - community_members.role enum は ('owner' / 'admin' / 'member') (0017)
--   - mod_action_logs.action の check 制約に 'promote' / 'demote' が既に含まれる (0068)
--   - is_community_mod(community_id) は既に定義済 (0068)
--
-- security definer + search_path 固定 (RLS bypass しても owner 判定で守る)。
-- 全 statement は idempotent (create or replace function)。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) is_community_owner — owner だけ判定する helper
-- ============================================================
-- 既存 is_community_owner は 0017 で定義済 (両者シグネチャ同一なら
-- create or replace で上書きしても問題なし)。安全のため security definer +
-- search_path 固定で再定義。
create or replace function public.is_community_owner(target_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.community_members
    where community_id = target_community_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

comment on function public.is_community_owner(uuid) is
  'owner 判定。community_members.role = owner かどうかを security definer で確認。';

-- ============================================================
-- 2) mod_promote_member — member → admin
-- ============================================================
-- owner だけが呼び出せる。target が member 以外 (owner / admin / 非メンバー)
-- は exception。自分自身の昇格もブロック (owner が自分を admin にする意味なし)。
create or replace function public.mod_promote_member(
  target_community_id uuid,
  target_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_role text;
begin
  if not public.is_community_owner(target_community_id) then
    raise exception 'owner only';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot promote yourself';
  end if;

  select role into current_role from public.community_members
  where community_id = target_community_id and user_id = target_user_id;

  if current_role is null then
    raise exception 'user is not a member';
  end if;
  if current_role = 'owner' then
    raise exception 'cannot change owner role';
  end if;
  if current_role = 'admin' then
    raise exception 'already admin';
  end if;

  update public.community_members
  set role = 'admin'
  where community_id = target_community_id and user_id = target_user_id;

  insert into public.mod_action_logs (
    community_id, mod_user_id, target_user_id, action
  ) values (
    target_community_id, auth.uid(), target_user_id, 'promote'
  );
end;
$$;

comment on function public.mod_promote_member(uuid, uuid) is
  'owner が member を admin に昇格。owner のみ実行可。';

-- ============================================================
-- 3) mod_demote_member — admin → member
-- ============================================================
-- owner だけが呼び出せる。target が admin 以外 (owner / member / 非メンバー)
-- は exception。owner は降格不可 (community に owner が居なくなるため)。
create or replace function public.mod_demote_member(
  target_community_id uuid,
  target_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_role text;
begin
  if not public.is_community_owner(target_community_id) then
    raise exception 'owner only';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot demote yourself';
  end if;

  select role into current_role from public.community_members
  where community_id = target_community_id and user_id = target_user_id;

  if current_role is null then
    raise exception 'user is not a member';
  end if;
  if current_role = 'owner' then
    raise exception 'cannot demote owner';
  end if;
  if current_role = 'member' then
    raise exception 'already member';
  end if;

  update public.community_members
  set role = 'member'
  where community_id = target_community_id and user_id = target_user_id;

  insert into public.mod_action_logs (
    community_id, mod_user_id, target_user_id, action
  ) values (
    target_community_id, auth.uid(), target_user_id, 'demote'
  );
end;
$$;

comment on function public.mod_demote_member(uuid, uuid) is
  'owner が admin を member に降格。owner のみ実行可、owner は降格不可。';

-- ============================================================
-- 4) GRANT
-- ============================================================
grant execute on function public.is_community_owner(uuid) to authenticated;
grant execute on function public.mod_promote_member(uuid, uuid) to authenticated;
grant execute on function public.mod_demote_member(uuid, uuid) to authenticated;
