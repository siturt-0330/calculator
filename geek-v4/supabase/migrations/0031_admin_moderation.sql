-- ============================================================
-- 0031_admin_moderation.sql
-- ============================================================
-- 開発者 admin / CRM tool の基盤:
--   1) admin_messages — 管理者→ユーザーへの直接 DM
--   2) moderation_log — 全モデレーション操作の監査ログ
--   3) admin_reported_posts_v / admin_problem_users_v — concern 集計ビュー
--   4) admin_delete_all_user_posts(uuid) — ユーザーの全投稿を一括削除 RPC
--
-- 全て冪等 (IF NOT EXISTS / drop policy if exists / create or replace)。
-- is_admin() ヘルパは 0027_admin_role.sql で定義済み。
-- ============================================================

-- ============================================================
-- 1. ADMIN MESSAGES — 管理者から個別ユーザーへの DM
-- ============================================================
create table if not exists public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete set null,
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 4000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_messages_recipient_idx
  on public.admin_messages (recipient_id, created_at desc);
create index if not exists admin_messages_unread_idx
  on public.admin_messages (recipient_id) where read_at is null;

alter table public.admin_messages enable row level security;

-- Admin (is_admin = true) だけが任意ユーザー宛に送信可能
drop policy if exists "admin_messages_insert" on public.admin_messages;
create policy "admin_messages_insert" on public.admin_messages for insert
  with check (public.is_admin() and sender_id = auth.uid());

-- 受信者本人 (or admin) だけが SELECT 可能
drop policy if exists "admin_messages_select" on public.admin_messages;
create policy "admin_messages_select" on public.admin_messages for select
  using (recipient_id = auth.uid() or public.is_admin());

-- 受信者は自分のメッセージを既読化 (read_at) のみ UPDATE 可能
drop policy if exists "admin_messages_update" on public.admin_messages;
create policy "admin_messages_update" on public.admin_messages for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Admin だけが送信済みメッセージを削除可能
drop policy if exists "admin_messages_delete" on public.admin_messages;
create policy "admin_messages_delete" on public.admin_messages for delete
  using (public.is_admin());

-- ============================================================
-- 2. MODERATION LOG — 全モデレーション操作の監査ログ
-- ============================================================
do $$ begin
  create type public.moderation_action as enum (
    'suspend_user', 'unsuspend_user', 'delete_post', 'delete_thread',
    'delete_comment', 'send_message', 'reset_account_state', 'note'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.moderation_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete set null,
  action public.moderation_action not null,
  target_type text not null check (target_type in ('user', 'post', 'thread', 'comment')),
  target_id uuid not null,
  reason text default '',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists moderation_log_target_idx
  on public.moderation_log (target_type, target_id, created_at desc);
create index if not exists moderation_log_admin_idx
  on public.moderation_log (admin_id, created_at desc);
create index if not exists moderation_log_created_idx
  on public.moderation_log (created_at desc);

alter table public.moderation_log enable row level security;

drop policy if exists "moderation_log_admin_all" on public.moderation_log;
create policy "moderation_log_admin_all" on public.moderation_log for all
  using (public.is_admin()) with check (public.is_admin() and admin_id = auth.uid());

-- ============================================================
-- 3. REPORTED POSTS VIEW — concern 集計
-- ============================================================
-- 投稿ごとの concern (報告) 集計。重い投稿を一覧で出す用。
-- RLS は base table (posts / concerns) が継承するので追加で view への
-- policy は不要。grant select だけ authenticated に渡す。
create or replace view public.admin_reported_posts_v as
select
  p.id as post_id,
  p.author_id,
  p.content,
  p.visibility,
  p.created_at as post_created_at,
  p.likes_count,
  p.concern_count,
  count(c.user_id) as reports_count,
  max(c.created_at) as last_reported_at
from public.posts p
join public.concerns c on c.post_id = p.id
group by p.id;

grant select on public.admin_reported_posts_v to authenticated;

-- ============================================================
-- 4. PROBLEM USERS VIEW — 累積 concern + 不健全 state ユーザーを抽出
-- ============================================================
create or replace view public.admin_problem_users_v as
select
  pr.id,
  pr.nickname,
  pr.account_state,
  pr.trust_score,
  pr.post_count,
  pr.concern_received_count,
  pr.created_at,
  count(distinct c.post_id) as flagged_posts_count
from public.profiles pr
left join public.posts p on p.author_id = pr.id
left join public.concerns c on c.post_id = p.id
where pr.concern_received_count > 0
   or pr.account_state in ('caution', 'restricted', 'warned', 'suspended')
group by pr.id;

grant select on public.admin_problem_users_v to authenticated;

-- ============================================================
-- 5. BULK DELETE RPC — ユーザーの全投稿を一括削除
-- ============================================================
create or replace function public.admin_delete_all_user_posts(p_user_id uuid)
returns int language plpgsql security definer as $$
declare
  cnt int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  delete from public.posts where author_id = p_user_id;
  get diagnostics cnt = row_count;
  insert into public.moderation_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'delete_post', 'user', p_user_id, 'bulk delete all posts', jsonb_build_object('count', cnt));
  return cnt;
end;
$$;

grant execute on function public.admin_delete_all_user_posts(uuid) to authenticated;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0031_admin_moderation 完了: admin_messages + moderation_log + 2 views + 1 RPC' as result;
