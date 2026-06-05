-- ============================================================
-- 0120_admin_rbac.sql
-- ============================================================
-- RBAC(ロールベースアクセス制御)を後方互換で段階導入する。
--   既存: profiles.is_admin (boolean 単一)
--   新規: profiles.admin_role ('none'|'viewer'|'moderator'|'admin')
--
-- 設計根拠: docs/ADMIN_CONSOLE.md §5.7 / §8.7
--
-- Phase 1 (本 migration): admin_role 列 + is_admin() を admin_role 基準に後方互換
--   再定義 + is_moderator() 追加 + admin_role の保護。既存 RLS は is_admin() の
--   ままなので admin の挙動は不変(=既存破壊なし)。
-- Phase 2 (将来): 個別 RLS / report_cases を is_moderator() に開放。
--
-- ★ admin_role の改ざん防止:
--   profiles_update policy は本人(auth.uid()=id)に UPDATE を許すため、放置すると
--   ユーザーが自分を admin に昇格できてしまう。guard_profile_update(0105) は
--   admin_role を知らない(新列)。そこで列レベル権限で authenticated/anon から
--   admin_role の UPDATE を revoke し、変更は admin 専用 SECURITY DEFINER RPC
--   set_admin_role() 経由のみに限定する(RPC は owner 権限で revoke を越えて UPDATE 可)。
--
-- 冪等・top-level定義・SQL editor 手動適用前提。
-- ============================================================

-- ------------------------------------------------------------
-- 1) admin_role 列 (既定 'none')
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists admin_role text not null default 'none'
    check (admin_role in ('none','viewer','moderator','admin'));

-- ------------------------------------------------------------
-- 2) 既存 is_admin=true を admin_role='admin' に移送 (再定義前に必須)
-- ------------------------------------------------------------
-- これを先に済ませないと、is_admin() 再定義の瞬間に既存 admin が権限を失う。
update public.profiles
   set admin_role = 'admin'
 where is_admin = true
   and admin_role <> 'admin';

-- ------------------------------------------------------------
-- 3) admin_role の直接 UPDATE を剥奪 (RPC 経由のみに限定)
-- ------------------------------------------------------------
revoke update (admin_role) on public.profiles from anon;
revoke update (admin_role) on public.profiles from authenticated;

-- ------------------------------------------------------------
-- 4) is_admin() を admin_role 基準に後方互換再定義
-- ------------------------------------------------------------
-- 署名(引数なし)は不変なので、これを呼ぶ全 RLS/関数はそのまま動く。
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select admin_role = 'admin' from public.profiles where id = auth.uid()), false);
$fn$;

-- ------------------------------------------------------------
-- 5) is_moderator() 追加 (moderator または admin)
-- ------------------------------------------------------------
create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select admin_role in ('moderator','admin') from public.profiles where id = auth.uid()), false);
$fn$;

-- ------------------------------------------------------------
-- 6) can_view_admin() 追加 (viewer 以上 = admin console 閲覧可)
-- ------------------------------------------------------------
create or replace function public.can_view_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select admin_role in ('viewer','moderator','admin') from public.profiles where id = auth.uid()), false);
$fn$;

-- ------------------------------------------------------------
-- 7) set_admin_role() — admin だけがロールを付与/変更 (監査ログ記録)
-- ------------------------------------------------------------
create or replace function public.set_admin_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  if p_role not in ('none','viewer','moderator','admin') then
    raise exception 'invalid role: %', p_role;
  end if;
  update public.profiles set admin_role = p_role where id = p_user_id;
  if not found then
    raise exception 'user not found: %', p_user_id;
  end if;
  insert into public.moderation_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'note', 'user', p_user_id, 'admin_role changed',
          jsonb_build_object('role', p_role));
end;
$fn$;

-- ------------------------------------------------------------
-- 8) grants
-- ------------------------------------------------------------
grant execute on function public.is_moderator()   to authenticated;
grant execute on function public.can_view_admin()  to authenticated;
grant execute on function public.set_admin_role(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 完了マーカー
-- ------------------------------------------------------------
select '0120_admin_rbac 完了: admin_role + is_admin()後方互換再定義 + is_moderator()/can_view_admin() + set_admin_role() RPC + admin_role UPDATE剥奪' as result;
