-- ============================================================
-- 0012: 管理者ロール + フィードバック管理ポリシー
-- ============================================================

-- profiles に is_admin カラム
alter table public.profiles add column if not exists is_admin boolean not null default false;

create index if not exists profiles_is_admin_idx on public.profiles(is_admin) where is_admin = true;

-- ============================================================
-- 管理者専用 RLS ポリシー (app_feedback)
-- 管理者: 全件読み取り可 + status / admin_notes 更新可
-- ============================================================
drop policy if exists "af_admin_read"   on public.app_feedback;
drop policy if exists "af_admin_update" on public.app_feedback;

create policy "af_admin_read" on public.app_feedback
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

create policy "af_admin_update" on public.app_feedback
  for update using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- 同様に管理者は profiles の is_admin を見れる必要がある (自分自身は既に見えるので不要)
-- 管理者は他ユーザーの profiles も見れる (既存 profiles_read = true なのでOK)

-- ============================================================
-- 自分を管理者にする例 (実行時に書き換え)
-- update public.profiles set is_admin = true where id = (select id from auth.users where email = 'your@email.com');
-- ============================================================
