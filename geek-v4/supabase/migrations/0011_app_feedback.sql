-- ============================================================
-- 0011: APP FEEDBACK
-- アプリ内から「ここを修正したい」を視覚的に集めるテーブル
-- ============================================================

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'other' check (kind in ('bug','ui','typo','suggestion','content','other')),
  message text not null check (length(message) between 1 and 2000),
  route text,                  -- 発生時のルート (例: /post/123)
  user_agent text,
  screen_w integer,
  screen_h integer,
  screenshot_url text,         -- 任意 (将来用)
  status text not null default 'open' check (status in ('open','triaged','in_progress','resolved','wontfix')),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_feedback_status_idx on public.app_feedback(status, created_at desc);
create index if not exists app_feedback_user_idx on public.app_feedback(user_id, created_at desc);

alter table public.app_feedback enable row level security;

drop policy if exists "af_read_self"   on public.app_feedback;
drop policy if exists "af_insert"      on public.app_feedback;
drop policy if exists "af_update_self" on public.app_feedback;
-- ユーザーは自分が出した feedback だけ読める (admin は service_role でアクセス)
create policy "af_read_self"   on public.app_feedback for select using (auth.uid() = user_id);
create policy "af_insert"      on public.app_feedback for insert with check (auth.uid() = user_id);
create policy "af_update_self" on public.app_feedback for update using (auth.uid() = user_id);

-- updated_at 自動更新
create or replace function public.touch_app_feedback()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;
drop trigger if exists app_feedback_touch on public.app_feedback;
create trigger app_feedback_touch
  before update on public.app_feedback
  for each row execute procedure public.touch_app_feedback();

-- Realtime
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.app_feedback';
  exception when duplicate_object then null;
  end;
end $$;

-- 既存 feature_flags に "feedback_fab" 追加
insert into public.feature_flags (name, description, enabled, percentage) values
  ('feedback_fab', 'アプリ内フィードバックボタンを全画面表示', true, 100)
on conflict (name) do update set
  description = excluded.description, enabled = excluded.enabled, percentage = excluded.percentage,
  updated_at = now();
