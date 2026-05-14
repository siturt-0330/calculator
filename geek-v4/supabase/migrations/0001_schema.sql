-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- PROFILES
-- ============================================================
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  nickname text not null check(length(nickname) between 2 and 20),
  trust_score integer not null default 50 check(trust_score between 0 and 100),
  post_count integer not null default 0,
  comment_count integer not null default 0,
  like_received_count integer not null default 0,
  onboarded boolean not null default false,
  plan text not null default 'free' check(plan in ('free','pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- TAGS
-- ============================================================
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text unique not null check(length(name) between 1 and 30),
  parent_id uuid references public.tags(id),
  post_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- POSTS  (tag_names は非正規化で直接保持 → API と一致)
-- ============================================================
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete cascade not null,
  content text not null check(length(content) between 1 and 1000),
  is_anonymous boolean not null default true,
  media_urls text[] not null default '{}',
  media_blurhashes text[] not null default '{}',
  tag_names text[] not null default '{}',
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  saves_count integer not null default 0,
  trust_score_at_post integer not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- LIKES / SAVES
-- ============================================================
create table public.likes (
  user_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table public.saves (
  user_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- ============================================================
-- POST COMMENTS  (投稿へのコメント)
-- ============================================================
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  content text not null check(length(content) between 1 and 500),
  avatar_color text not null default '#7C6AF7',
  created_at timestamptz not null default now()
);

-- ============================================================
-- BBS THREADS / REPLIES  (テーブル名を API と一致させる)
-- ============================================================
create table public.bbs_threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete cascade not null,
  title text not null check(length(title) between 1 and 50),
  category text not null default '雑談',
  replies_count integer not null default 0,
  last_reply_at timestamptz,
  avatar_color text not null default '#7C6AF7',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bbs_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.bbs_threads(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  content text not null check(length(content) between 1 and 1000),
  color text not null default '#7C6AF7',
  created_at timestamptz not null default now()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check(type in ('like','comment','follow','reply','event')),
  tag_name text,
  message text not null,
  read boolean not null default false,
  data jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- USER TAG PREFERENCES
-- ============================================================
create table public.user_liked_tags (
  user_id uuid references public.profiles(id) on delete cascade,
  tag_name text not null,
  primary key (user_id, tag_name)
);

create table public.user_blocked_tags (
  user_id uuid references public.profiles(id) on delete cascade,
  tag_name text not null,
  primary key (user_id, tag_name)
);

-- ============================================================
-- REPORTS
-- ============================================================
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete cascade not null,
  post_id uuid references public.posts(id) on delete cascade not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.tags enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.saves enable row level security;
alter table public.comments enable row level security;
alter table public.bbs_threads enable row level security;
alter table public.bbs_replies enable row level security;
alter table public.notifications enable row level security;
alter table public.user_liked_tags enable row level security;
alter table public.user_blocked_tags enable row level security;
alter table public.reports enable row level security;

-- Profiles
create policy "profiles_read"   on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Tags
create policy "tags_read"   on public.tags for select using (true);
create policy "tags_insert" on public.tags for insert with check (auth.uid() is not null);

-- Posts
create policy "posts_read"   on public.posts for select using (true);
create policy "posts_insert" on public.posts for insert with check (auth.uid() = author_id);
create policy "posts_update" on public.posts for update using (auth.uid() = author_id);
create policy "posts_delete" on public.posts for delete using (auth.uid() = author_id);

-- Likes
create policy "likes_read"   on public.likes for select using (true);
create policy "likes_insert" on public.likes for insert with check (auth.uid() = user_id);
create policy "likes_delete" on public.likes for delete using (auth.uid() = user_id);

-- Saves
create policy "saves_read"   on public.saves for select using (auth.uid() = user_id);
create policy "saves_insert" on public.saves for insert with check (auth.uid() = user_id);
create policy "saves_delete" on public.saves for delete using (auth.uid() = user_id);

-- Comments
create policy "comments_read"   on public.comments for select using (true);
create policy "comments_insert" on public.comments for insert with check (auth.uid() = author_id);

-- BBS Threads
create policy "bbs_threads_read"   on public.bbs_threads for select using (true);
create policy "bbs_threads_insert" on public.bbs_threads for insert with check (auth.uid() = author_id);

-- BBS Replies
create policy "bbs_replies_read"   on public.bbs_replies for select using (true);
create policy "bbs_replies_insert" on public.bbs_replies for insert with check (auth.uid() = author_id);

-- Notifications
create policy "notifications_own" on public.notifications for all using (auth.uid() = user_id);

-- Tag prefs
create policy "user_liked_tags_own"   on public.user_liked_tags   for all using (auth.uid() = user_id);
create policy "user_blocked_tags_own" on public.user_blocked_tags for all using (auth.uid() = user_id);

-- Reports
create policy "reports_insert" on public.reports for insert with check (auth.uid() = reporter_id);

-- ============================================================
-- INDEXES
-- ============================================================
create index posts_created_at_idx    on public.posts(created_at desc);
create index posts_author_idx        on public.posts(author_id);
create index posts_tag_names_idx     on public.posts using gin(tag_names);
create index comments_post_idx       on public.comments(post_id, created_at);
create index bbs_threads_created_idx on public.bbs_threads(created_at desc);
create index bbs_replies_thread_idx  on public.bbs_replies(thread_id, created_at);
create index notifications_user_idx  on public.notifications(user_id, created_at desc);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- サインアップ時に自動でプロフィール作成
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles(id, nickname)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- いいね数カウント
create or replace function public.update_likes_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set likes_count = likes_count + 1 where id = NEW.post_id;
    update public.profiles set like_received_count = like_received_count + 1
      where id = (select author_id from public.posts where id = NEW.post_id);
  elsif TG_OP = 'DELETE' then
    update public.posts set likes_count = greatest(likes_count - 1, 0) where id = OLD.post_id;
    update public.profiles set like_received_count = greatest(like_received_count - 1, 0)
      where id = (select author_id from public.posts where id = OLD.post_id);
  end if;
  return null;
end;
$$;
create trigger likes_count_trigger
  after insert or delete on public.likes
  for each row execute procedure public.update_likes_count();

-- コメント数カウント
create or replace function public.update_comments_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = NEW.post_id;
    update public.profiles set comment_count = comment_count + 1 where id = NEW.author_id;
  end if;
  return null;
end;
$$;
create trigger comments_count_trigger
  after insert on public.comments
  for each row execute procedure public.update_comments_count();

-- BBS返信数カウント + last_reply_at 更新
create or replace function public.update_bbs_replies_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.bbs_threads
    set replies_count = replies_count + 1,
        last_reply_at = NEW.created_at
    where id = NEW.thread_id;
  end if;
  return null;
end;
$$;
create trigger bbs_replies_count_trigger
  after insert on public.bbs_replies
  for each row execute procedure public.update_bbs_replies_count();
