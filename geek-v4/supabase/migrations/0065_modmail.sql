-- ============================================================
-- 0065_modmail.sql
-- ============================================================
-- Modmail (運営問い合わせ structured channel) を導入。
--
-- 仕様 (Reddit ガイド #12 / Reddit 6.5 章):
--   user ↔ admin の双方向問い合わせスレッド。BAN 異議申立 / ルール質問 /
--   バグ報告 / 機能要望 等のカテゴリで分類。state は new → in_progress →
--   archived の単方向遷移。
--
-- 既存 admin_messages (0031) は一方向通知 (admin → user) 専用なので、
--   modmail とは完全に別物として並走させる。modmail のメッセージは
--   thread に紐づき、ユーザー側も admin 側も発言可能。
--
-- テーブル:
--   support_threads  — スレッド本体 (subject / category / state / counters)
--   support_messages — スレッド内メッセージ (author 本人 or admin)
--
-- RLS:
--   - スレッド: 本人 OR admin のみ表示・操作可能
--   - メッセージ: 同上 (thread の所有関係を経由してチェック)
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) enum types
-- ============================================================
-- Postgres は `create type if not exists` をサポートしないので、
-- 0031 / 0051 / 0052 と同じ「exception when duplicate_object」イディオムで包む。
do $$ begin
  create type public.support_thread_state as enum ('new', 'in_progress', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.support_thread_category as enum (
    'account_appeal', -- BAN 異議申立
    'rule_question', -- ルール質問
    'community_question', -- コミュ運営質問
    'bug_report', -- バグ報告
    'feature_request', -- 機能要望
    'other' -- その他
  );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 2) tables
-- ============================================================
create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (length(subject) between 1 and 100),
  category public.support_thread_category not null,
  state public.support_thread_state not null default 'new',
  -- 関連リソース (BAN 異議申立等で post_id を参照する場合)
  related_post_id uuid references public.posts(id) on delete set null,
  -- 統計
  message_count int not null default 0,
  last_message_at timestamptz not null default now(),
  unread_count_for_user int not null default 0,
  unread_count_for_admin int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  is_admin_reply boolean not null default false,
  content text not null check (length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3) indexes
-- ============================================================
-- user 一覧: 自分のスレッドを last_message_at desc
create index if not exists support_threads_user_idx
  on public.support_threads(user_id, last_message_at desc);

-- admin 一覧: 未対応 (state != 'archived') を last_message_at desc
-- 部分 index にして size を抑える
create index if not exists support_threads_state_idx
  on public.support_threads(state, last_message_at desc)
  where state != 'archived';

-- スレッド詳細: thread 内メッセージを created_at asc
create index if not exists support_messages_thread_idx
  on public.support_messages(thread_id, created_at);

-- ============================================================
-- 4) RLS
-- ============================================================
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

-- スレッド: 本人 OR admin
drop policy if exists "support_threads_own" on public.support_threads;
create policy "support_threads_own" on public.support_threads
  for all using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- メッセージ SELECT: thread の所有関係を経由
drop policy if exists "support_messages_thread_visible" on public.support_messages;
create policy "support_messages_thread_visible" on public.support_messages
  for select using (
    exists (
      select 1 from public.support_threads t
      where t.id = support_messages.thread_id
        and (
          t.user_id = auth.uid()
          or exists (
            select 1 from public.profiles
            where id = auth.uid() and is_admin = true
          )
        )
    )
  );

-- メッセージ INSERT: スレッド主 (user) or admin だけが投稿可能
drop policy if exists "support_messages_insert" on public.support_messages;
create policy "support_messages_insert" on public.support_messages
  for insert with check (
    exists (
      select 1 from public.support_threads t
      where t.id = thread_id
        and (
          t.user_id = auth.uid()
          or exists (
            select 1 from public.profiles
            where id = auth.uid() and is_admin = true
          )
        )
    )
    and auth.uid() = author_id
  );

-- ============================================================
-- 5) trigger: メッセージ insert 時に thread の counter を更新
-- ============================================================
-- - is_admin_reply=true:
--     message_count++, last_message_at=now,
--     unread_count_for_user++, state='new'→'in_progress'
-- - is_admin_reply=false (= user 投稿):
--     message_count++, last_message_at=now,
--     unread_count_for_admin++
create or replace function public.update_support_thread_stats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if NEW.is_admin_reply then
    update public.support_threads
      set message_count = message_count + 1,
          last_message_at = NEW.created_at,
          unread_count_for_user = unread_count_for_user + 1,
          state = case when state = 'new' then 'in_progress' else state end
      where id = NEW.thread_id;
  else
    update public.support_threads
      set message_count = message_count + 1,
          last_message_at = NEW.created_at,
          unread_count_for_admin = unread_count_for_admin + 1
      where id = NEW.thread_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_support_thread_stats on public.support_messages;
create trigger trg_support_thread_stats
  after insert on public.support_messages
  for each row execute function public.update_support_thread_stats();

comment on table public.support_threads is
  'Modmail スレッド: user ↔ admin の双方向問い合わせ。category で分類、state で進行管理。';
comment on table public.support_messages is
  'Modmail メッセージ: support_threads に紐づく投稿。is_admin_reply で発言主を区別。';

select '0065_modmail 完了' as result;
