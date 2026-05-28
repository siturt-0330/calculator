-- ============================================================
-- 0070: 通知 preference 細分化 (Push / In-app 各々独立 toggle)
-- ============================================================
-- 既存仕様:
--   - settings.notify* (zustand) でクライアント側にユーザー設定を保持
--     していたが、デバイス間で同期できず、Push 配信ロジック (Edge Fn)
--     からも参照できなかった。
--
-- 本 migration:
--   1. user_id × category を PK とする notification_preferences テーブルを追加
--   2. 各カテゴリは push (端末通知) と inapp (アプリ内通知一覧) を独立に
--      ON/OFF できる (== 「Push 切りたいけど通知一覧には残したい」を実現)
--   3. RLS: 自分のレコードのみ select/insert/update/delete 可能
--   4. RPC get_notification_preferences(): 未設定カテゴリも default true で
--      埋めて 11 行返す (クライアント側で merge が不要)
--
-- カテゴリ key (固定):
--   'like', 'comment', 'reply', 'mention', 'follow',
--   'friend_request', 'friend_accept', 'official_post',
--   'event', 'mod_action', 'system'
--
-- security definer + search_path 固定 (auth.uid() の値を信頼)。
-- 全 statement は idempotent (create table if not exists / create or replace)。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) notification_preferences テーブル
-- ============================================================
create table if not exists public.notification_preferences (
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- カテゴリ key:
  -- 'like', 'comment', 'reply', 'mention', 'follow',
  -- 'friend_request', 'friend_accept', 'official_post',
  -- 'event', 'mod_action', 'system'
  category   text not null,
  push       boolean not null default true,
  inapp      boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

create index if not exists notification_preferences_user_idx
  on public.notification_preferences(user_id);

-- ============================================================
-- 2) RLS — 自分のレコードのみアクセス可能
-- ============================================================
alter table public.notification_preferences enable row level security;

-- 既存ポリシーがあれば削除して作り直す (idempotency)
drop policy if exists "notification_prefs_own_all" on public.notification_preferences;

create policy "notification_prefs_own_all" on public.notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- 3) get_notification_preferences() RPC
-- ============================================================
-- 未設定カテゴリは default true で埋めて返す。クライアントが
-- 11 行揃った state を直接受け取れる (merge 不要)。
--
-- security definer + search_path = public, pg_catalog で安全に固定。
-- ============================================================
create or replace function public.get_notification_preferences()
returns table (category text, push boolean, inapp boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with categories as (
    select unnest(array[
      'like', 'comment', 'reply', 'mention', 'follow',
      'friend_request', 'friend_accept', 'official_post',
      'event', 'mod_action', 'system'
    ]) as cat
  )
  select
    c.cat as category,
    coalesce(p.push, true) as push,
    coalesce(p.inapp, true) as inapp
  from categories c
  left join public.notification_preferences p
    on p.category = c.cat and p.user_id = auth.uid()
  order by c.cat;
$$;

grant execute on function public.get_notification_preferences() to authenticated;
