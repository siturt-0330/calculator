-- ============================================================
-- 0027_admin_role.sql
-- ============================================================
-- 開発者用 admin role を導入。siturt0330@gmail.com の profile に
-- is_admin=true を立てると、RLS をバイパスして全 profiles / posts /
-- bbs_threads を SELECT/UPDATE/DELETE 出来るようになる。
-- service_role キーを client に晒さずに済む。
--
-- 冪等 (何度実行しても OK)。0012 で is_admin カラムは導入済みだが
-- add column if not exists で重複しても安全。
-- 0020 で current_user_is_admin() が定義されている場合も is_admin() は
-- 新規に別名で作成するので衝突しない。
-- ============================================================

-- 1) is_admin column (0012 で導入済みだが冪等性のため再定義)
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 2) helper function: 自分が admin か
create or replace function public.is_admin()
returns boolean language sql stable security definer as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 3) profiles: admin は全 row を SELECT/UPDATE できる
drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles for all using (public.is_admin()) with check (public.is_admin());

-- 4) posts: admin は全 post を SELECT / DELETE / UPDATE できる
drop policy if exists "posts_admin_all" on public.posts;
create policy "posts_admin_all" on public.posts for all using (public.is_admin()) with check (public.is_admin());

-- 5) bbs_threads: admin 全権
drop policy if exists "bbs_threads_admin_all" on public.bbs_threads;
create policy "bbs_threads_admin_all" on public.bbs_threads for all using (public.is_admin()) with check (public.is_admin());

-- 6) communities: admin 全権
drop policy if exists "communities_admin_all" on public.communities;
create policy "communities_admin_all" on public.communities for all using (public.is_admin()) with check (public.is_admin());

-- 7) bootstrap: siturt0330@gmail.com の profile に is_admin=true
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'siturt0330@gmail.com');
