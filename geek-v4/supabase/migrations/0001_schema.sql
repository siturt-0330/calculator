-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Users table (extends auth.users)
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

-- Tags table (hierarchical)
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text unique not null check(length(name) between 1 and 30),
  parent_id uuid references public.tags(id),
  post_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Posts table (anonymous)
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete cascade not null,
  content text not null check(length(content) between 1 and 1000),
  is_anonymous boolean not null default true,
  media_urls text[] not null default '{}',
  media_blurhashes text[] not null default '{}',
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  saves_count integer not null default 0,
  trust_score_at_post integer not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Post tags junction
create table public.post_tags (
  post_id uuid references public.posts(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  primary key (post_id, tag_id)
);

-- Likes table
create table public.likes (
  user_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- Saves table
create table public.saves (
  user_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- Comments table (on posts)
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete cascade,
  content text not null check(length(content) between 1 and 500),
  avatar_color text not null default '#7C6AF7',
  created_at timestamptz not null default now()
);

-- BBS threads
create table public.threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete cascade,
  title text not null check(length(title) between 1 and 50),
  body text not null check(length(body) between 10 and 2000),
  avatar_color text not null default '#7C6AF7',
  replies_count integer not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- BBS replies
create table public.replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.threads(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete cascade,
  content text not null check(length(content) between 1 and 1000),
  avatar_color text not null default '#7C6AF7',
  created_at timestamptz not null default now()
);

-- Notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check(type in ('like','comment','follow','reply','event')),
  title text not null,
  body text not null,
  read boolean not null default false,
  data jsonb,
  created_at timestamptz not null default now()
);

-- User tag preferences
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

-- Reports
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

-- RLS Policies
alter table public.profiles enable row level security;
alter table public.tags enable row level security;
alter table public.posts enable row level security;
alter table public.post_tags enable row level security;
alter table public.likes enable row level security;
alter table public.saves enable row level security;
alter table public.comments enable row level security;
alter table public.threads enable row level security;
alter table public.replies enable row level security;
alter table public.notifications enable row level security;
alter table public.user_liked_tags enable row level security;
alter table public.user_blocked_tags enable row level security;
alter table public.reports enable row level security;

-- Profiles: users can read all profiles, only update own
create policy "profiles_read" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Tags: anyone can read
create policy "tags_read" on public.tags for select using (true);
create policy "tags_insert" on public.tags for insert with check (auth.uid() is not null);

-- Posts: anyone can read
create policy "posts_read" on public.posts for select using (true);
create policy "posts_insert" on public.posts for insert with check (auth.uid() = author_id);
create policy "posts_update" on public.posts for update using (auth.uid() = author_id);
create policy "posts_delete" on public.posts for delete using (auth.uid() = author_id);

-- Post tags: readable by all, writable by post owner
create policy "post_tags_read" on public.post_tags for select using (true);
create policy "post_tags_insert" on public.post_tags for insert with check (
  exists (select 1 from public.posts where id = post_id and author_id = auth.uid())
);

-- Likes
create policy "likes_read" on public.likes for select using (true);
create policy "likes_insert" on public.likes for insert with check (auth.uid() = user_id);
create policy "likes_delete" on public.likes for delete using (auth.uid() = user_id);

-- Saves
create policy "saves_read" on public.saves for select using (auth.uid() = user_id);
create policy "saves_insert" on public.saves for insert with check (auth.uid() = user_id);
create policy "saves_delete" on public.saves for delete using (auth.uid() = user_id);

-- Comments
create policy "comments_read" on public.comments for select using (true);
create policy "comments_insert" on public.comments for insert with check (auth.uid() = author_id);

-- Threads
create policy "threads_read" on public.threads for select using (true);
create policy "threads_insert" on public.threads for insert with check (auth.uid() = author_id);

-- Replies
create policy "replies_read" on public.replies for select using (true);
create policy "replies_insert" on public.replies for insert with check (auth.uid() = author_id);

-- Notifications: only own
create policy "notifications_own" on public.notifications for all using (auth.uid() = user_id);

-- User tag prefs: only own
create policy "user_liked_tags_own" on public.user_liked_tags for all using (auth.uid() = user_id);
create policy "user_blocked_tags_own" on public.user_blocked_tags for all using (auth.uid() = user_id);

-- Reports
create policy "reports_insert" on public.reports for insert with check (auth.uid() = reporter_id);

-- Indexes
create index posts_created_at_idx on public.posts(created_at desc);
create index posts_author_idx on public.posts(author_id);
create index post_tags_tag_idx on public.post_tags(tag_id);
create index comments_post_idx on public.comments(post_id, created_at);
create index threads_created_at_idx on public.threads(created_at desc);
create index replies_thread_idx on public.replies(thread_id, created_at);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- Trigger: auto-create profile on signup
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

-- Trigger: update post counts
create or replace function public.update_likes_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set likes_count = likes_count + 1 where id = NEW.post_id;
    update public.profiles set like_received_count = like_received_count + 1
      where id = (select author_id from public.posts where id = NEW.post_id);
  elsif TG_OP = 'DELETE' then
    update public.posts set likes_count = likes_count - 1 where id = OLD.post_id;
    update public.profiles set like_received_count = like_received_count - 1
      where id = (select author_id from public.posts where id = OLD.post_id);
  end if;
  return null;
end;
$$;
create trigger likes_count_trigger after insert or delete on public.likes
  for each row execute procedure public.update_likes_count();

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
create trigger comments_count_trigger after insert on public.comments
  for each row execute procedure public.update_comments_count();

create or replace function public.update_replies_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.threads set replies_count = replies_count + 1 where id = NEW.thread_id;
  end if;
  return null;
end;
$$;
create trigger replies_count_trigger after insert on public.replies
  for each row execute procedure public.update_replies_count();
