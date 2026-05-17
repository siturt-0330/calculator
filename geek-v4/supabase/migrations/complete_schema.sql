-- ============================================================
-- Geek 完全スキーマ（1本で全部）
-- 何度実行してもOK（既存データは保護）
-- ============================================================

-- ============================================================
-- 1. PROFILES（ユーザープロフィール）
-- ============================================================
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  nickname text not null check(length(nickname) between 1 and 20),
  trust_score integer not null default 50 check(trust_score between 0 and 100),
  post_count integer not null default 0,
  comment_count integer not null default 0,
  like_received_count integer not null default 0,
  onboarded boolean not null default false,
  plan text not null default 'free' check(plan in ('free','pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists account_state text not null default 'healthy'
  check (account_state in ('healthy','caution','restricted','warned','suspended'));
alter table public.profiles add column if not exists concern_received_count integer not null default 0;

alter table public.profiles enable row level security;
drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_read"   on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- ============================================================
-- 2. TAGS（タグ＝コミュニティ）
-- ============================================================
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text unique not null check(length(name) between 1 and 30),
  parent_id uuid references public.tags(id),
  post_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.tags add column if not exists description text;
alter table public.tags add column if not exists banner_color text default '#7C6AF7';
alter table public.tags add column if not exists member_count integer not null default 0;

alter table public.tags enable row level security;
drop policy if exists "tags_read" on public.tags;
drop policy if exists "tags_insert" on public.tags;
create policy "tags_read"   on public.tags for select using (true);
create policy "tags_insert" on public.tags for insert with check (auth.uid() is not null);

-- タググループ
create table if not exists public.tag_groups (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  created_at timestamptz not null default now()
);
alter table public.tag_groups enable row level security;
drop policy if exists "tg_read" on public.tag_groups;
create policy "tg_read" on public.tag_groups for select using (true);

-- タグ関係（同一視・関連・グループ）
create table if not exists public.tag_relations (
  id uuid primary key default gen_random_uuid(),
  tag_a text not null,
  tag_b text not null,
  relation text not null check (relation in ('alias', 'related', 'group_member')),
  group_id uuid references public.tag_groups(id),
  vote_count integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists tr_a_idx on public.tag_relations(tag_a);
create index if not exists tr_b_idx on public.tag_relations(tag_b);
alter table public.tag_relations enable row level security;
drop policy if exists "tr_read" on public.tag_relations;
drop policy if exists "tr_insert" on public.tag_relations;
create policy "tr_read" on public.tag_relations for select using (true);
create policy "tr_insert" on public.tag_relations for insert with check (auth.uid() is not null);

-- ============================================================
-- 3. POSTS（投稿）
-- ============================================================
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  media_urls text[] not null default '{}',
  media_blurhashes text[] not null default '{}',
  tag_names text[] not null default '{}',
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  trust_score_at_post integer not null default 50,
  is_anonymous boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.posts add column if not exists kind text not null default 'opinion'
  check (kind in ('fact', 'opinion', 'joke', 'wip'));
alter table public.posts add column if not exists source_url text;
alter table public.posts add column if not exists max_reach integer;
alter table public.posts add column if not exists concern_count integer not null default 0;
alter table public.posts add column if not exists score integer not null default 0;
alter table public.posts add column if not exists hot_score double precision not null default 0;

create index if not exists posts_created_idx on public.posts(created_at desc);
create index if not exists posts_tags_idx on public.posts using gin(tag_names);

alter table public.posts enable row level security;
drop policy if exists "posts_read" on public.posts;
drop policy if exists "posts_insert" on public.posts;
drop policy if exists "posts_update" on public.posts;
drop policy if exists "posts_delete" on public.posts;
create policy "posts_read"   on public.posts for select using (true);
create policy "posts_insert" on public.posts for insert with check (auth.uid() = author_id);
create policy "posts_update" on public.posts for update using (auth.uid() = author_id);
create policy "posts_delete" on public.posts for delete using (auth.uid() = author_id);

-- ============================================================
-- 4. LIKES（いいね）
-- ============================================================
create table if not exists public.likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.likes enable row level security;
drop policy if exists "likes_read" on public.likes;
drop policy if exists "likes_insert" on public.likes;
drop policy if exists "likes_delete" on public.likes;
create policy "likes_read"   on public.likes for select using (true);
create policy "likes_insert" on public.likes for insert with check (auth.uid() = user_id);
create policy "likes_delete" on public.likes for delete using (auth.uid() = user_id);

-- ============================================================
-- 5. CONCERNS（「気になる」= 低評価ベース信頼）
-- ============================================================
create table if not exists public.concerns (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  reason text not null default 'other' check (reason in ('misinfo','unverified','spam','rude','scam','other')),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.concerns enable row level security;
drop policy if exists "concerns_read" on public.concerns;
drop policy if exists "concerns_insert" on public.concerns;
drop policy if exists "concerns_delete" on public.concerns;
create policy "concerns_read" on public.concerns for select using (true);
create policy "concerns_insert" on public.concerns for insert with check (auth.uid() = user_id);
create policy "concerns_delete" on public.concerns for delete using (auth.uid() = user_id);

-- ============================================================
-- 6. COMMENTS（コメント）
-- ============================================================
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check(length(content) between 1 and 1000),
  avatar_color text not null default '#7C6AF7',
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;
drop policy if exists "comments_read" on public.comments;
drop policy if exists "comments_insert" on public.comments;
drop policy if exists "comments_delete" on public.comments;
create policy "comments_read"   on public.comments for select using (true);
create policy "comments_insert" on public.comments for insert with check (auth.uid() = author_id);
create policy "comments_delete" on public.comments for delete using (auth.uid() = author_id);

-- ============================================================
-- 7. SAVES（保存）
-- ============================================================
create table if not exists public.saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.saves enable row level security;
drop policy if exists "saves_read" on public.saves;
drop policy if exists "saves_insert" on public.saves;
drop policy if exists "saves_delete" on public.saves;
create policy "saves_read"   on public.saves for select using (auth.uid() = user_id);
create policy "saves_insert" on public.saves for insert with check (auth.uid() = user_id);
create policy "saves_delete" on public.saves for delete using (auth.uid() = user_id);

-- ============================================================
-- 8. TAG_SUBSCRIPTIONS（コミュニティ参加）
-- ============================================================
create table if not exists public.tag_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  tag_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tag_name)
);
alter table public.tag_subscriptions enable row level security;
drop policy if exists "ts_read" on public.tag_subscriptions;
drop policy if exists "ts_insert" on public.tag_subscriptions;
drop policy if exists "ts_delete" on public.tag_subscriptions;
create policy "ts_read" on public.tag_subscriptions for select using (true);
create policy "ts_insert" on public.tag_subscriptions for insert with check (auth.uid() = user_id);
create policy "ts_delete" on public.tag_subscriptions for delete using (auth.uid() = user_id);

-- ============================================================
-- 9. BBS（匿名掲示板）
-- ============================================================
create table if not exists public.bbs_threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(title) between 1 and 60),
  category text not null default '雑談',
  replies_count integer not null default 0,
  last_reply_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.bbs_threads enable row level security;
drop policy if exists "bt_read" on public.bbs_threads;
drop policy if exists "bt_insert" on public.bbs_threads;
create policy "bt_read"   on public.bbs_threads for select using (true);
create policy "bt_insert" on public.bbs_threads for insert with check (auth.uid() = author_id);

create table if not exists public.bbs_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.bbs_threads(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check(length(content) between 1 and 500),
  color text not null default '#7C6AF7',
  created_at timestamptz not null default now()
);
alter table public.bbs_replies enable row level security;
drop policy if exists "br_read" on public.bbs_replies;
drop policy if exists "br_insert" on public.bbs_replies;
create policy "br_read"   on public.bbs_replies for select using (true);
create policy "br_insert" on public.bbs_replies for insert with check (auth.uid() = author_id);

-- ============================================================
-- 10. EVENTS（公式カレンダー）
-- ============================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(title) between 1 and 100),
  description text,
  event_date date not null,
  tag_name text,
  location text,
  is_official boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
drop policy if exists "ev_read" on public.events;
create policy "ev_read" on public.events for select using (true);

-- 個人カレンダー
create table if not exists public.personal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 100),
  description text,
  event_date date not null,
  tag_name text,
  location text,
  created_at timestamptz not null default now()
);
alter table public.personal_events enable row level security;
drop policy if exists "pe_read" on public.personal_events;
drop policy if exists "pe_insert" on public.personal_events;
drop policy if exists "pe_update" on public.personal_events;
drop policy if exists "pe_delete" on public.personal_events;
create policy "pe_read"   on public.personal_events for select using (auth.uid() = user_id);
create policy "pe_insert" on public.personal_events for insert with check (auth.uid() = user_id);
create policy "pe_update" on public.personal_events for update using (auth.uid() = user_id);
create policy "pe_delete" on public.personal_events for delete using (auth.uid() = user_id);

-- イベント提案
create table if not exists public.event_proposals (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid references auth.users(id) on delete set null,
  title text not null check (length(title) between 1 and 100),
  description text,
  event_date date not null,
  tag_name text not null,
  location text,
  vote_count integer not null default 0,
  required_votes integer not null default 1,
  promoted_event_id uuid references public.events(id),
  created_at timestamptz not null default now()
);
alter table public.event_proposals enable row level security;
drop policy if exists "ep_read" on public.event_proposals;
drop policy if exists "ep_insert" on public.event_proposals;
create policy "ep_read"   on public.event_proposals for select using (true);
create policy "ep_insert" on public.event_proposals for insert with check (auth.uid() = proposer_id);

-- 提案への投票
create table if not exists public.event_proposal_votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id uuid not null references public.event_proposals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, proposal_id)
);
alter table public.event_proposal_votes enable row level security;
drop policy if exists "epv_read" on public.event_proposal_votes;
drop policy if exists "epv_insert" on public.event_proposal_votes;
drop policy if exists "epv_delete" on public.event_proposal_votes;
create policy "epv_read"   on public.event_proposal_votes for select using (true);
create policy "epv_insert" on public.event_proposal_votes for insert with check (auth.uid() = user_id);
create policy "epv_delete" on public.event_proposal_votes for delete using (auth.uid() = user_id);

-- ============================================================
-- 11. NOTIFICATIONS（通知）
-- ============================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'follow', 'event')),
  tag_name text,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
drop policy if exists "nt_read" on public.notifications;
drop policy if exists "nt_update" on public.notifications;
create policy "nt_read"   on public.notifications for select using (auth.uid() = user_id);
create policy "nt_update" on public.notifications for update using (auth.uid() = user_id);

-- ============================================================
-- 12. REPORTS（通報）
-- ============================================================
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "rp_insert" on public.reports;
create policy "rp_insert" on public.reports for insert with check (auth.uid() = reporter_id);

-- ============================================================
-- TRIGGERS / FUNCTIONS
-- ============================================================

-- サインアップで自動プロフィール作成
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare nick text;
begin
  nick := split_part(new.email, '@', 1);
  if length(nick) < 2 then nick := nick || '_'; end if;
  if length(nick) > 20 then nick := substring(nick, 1, 20); end if;
  insert into public.profiles(id, nickname) values (new.id, nick)
    on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- いいね数 自動更新
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
drop trigger if exists likes_trg on public.likes;
create trigger likes_trg after insert or delete on public.likes
  for each row execute procedure public.update_likes_count();

-- コメント数 自動更新
create or replace function public.update_comments_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update public.posts set comments_count = greatest(comments_count - 1, 0) where id = OLD.post_id;
  end if;
  return null;
end;
$$;
drop trigger if exists comments_trg on public.comments;
create trigger comments_trg after insert or delete on public.comments
  for each row execute procedure public.update_comments_count();

-- BBS返信数・最終返信日時
create or replace function public.update_bbs_reply()
returns trigger language plpgsql as $$
begin
  update public.bbs_threads set
    replies_count = replies_count + 1,
    last_reply_at = NEW.created_at
  where id = NEW.thread_id;
  return null;
end;
$$;
drop trigger if exists bbs_reply_trg on public.bbs_replies;
create trigger bbs_reply_trg after insert on public.bbs_replies
  for each row execute procedure public.update_bbs_reply();

-- 投稿数自動更新（投稿時）
create or replace function public.update_post_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.profiles set post_count = post_count + 1 where id = NEW.author_id;
  elsif TG_OP = 'DELETE' then
    update public.profiles set post_count = greatest(post_count - 1, 0) where id = OLD.author_id;
  end if;
  return null;
end;
$$;
drop trigger if exists post_count_trg on public.posts;
create trigger post_count_trg after insert or delete on public.posts
  for each row execute procedure public.update_post_count();

-- アカウント状態自動算出
create or replace function public.refresh_account_state(p_user uuid)
returns void language plpgsql as $$
declare pcount int; ccount int; ratio float; state text;
begin
  select post_count, concern_received_count into pcount, ccount from public.profiles where id = p_user;
  pcount := coalesce(pcount, 0); ccount := coalesce(ccount, 0);
  if pcount = 0 then ratio := 0; else ratio := ccount::float / pcount::float; end if;
  if ratio >= 1.5 then state := 'warned';
  elsif ratio >= 1.0 then state := 'restricted';
  elsif ratio >= 0.5 then state := 'caution';
  else state := 'healthy';
  end if;
  update public.profiles set account_state = state where id = p_user;
end;
$$;

-- concern_count 自動更新
create or replace function public.update_concern_count()
returns trigger language plpgsql as $$
declare pid uuid; aid uuid;
begin
  if TG_OP = 'INSERT' then pid := NEW.post_id; else pid := OLD.post_id; end if;
  update public.posts set concern_count = (select count(*) from public.concerns where post_id = pid) where id = pid;
  select author_id into aid from public.posts where id = pid;
  if aid is not null then
    update public.profiles set concern_received_count = (
      select count(*) from public.concerns c join public.posts p on c.post_id = p.id where p.author_id = aid
    ) where id = aid;
    perform public.refresh_account_state(aid);
  end if;
  return null;
end;
$$;
drop trigger if exists concern_trg on public.concerns;
create trigger concern_trg after insert or delete on public.concerns
  for each row execute procedure public.update_concern_count();

-- タグ加入者数 自動更新
create or replace function public.update_tag_member_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.tags(name) values (NEW.tag_name) on conflict do nothing;
    update public.tags set member_count = member_count + 1 where name = NEW.tag_name;
  elsif TG_OP = 'DELETE' then
    update public.tags set member_count = greatest(member_count - 1, 0) where name = OLD.tag_name;
  end if;
  return null;
end;
$$;
drop trigger if exists tag_sub_trg on public.tag_subscriptions;
create trigger tag_sub_trg after insert or delete on public.tag_subscriptions
  for each row execute procedure public.update_tag_member_count();

-- 10%同意で提案→公式に昇格
create or replace function public.maybe_promote_proposal()
returns trigger language plpgsql as $$
declare prop record; subs int; threshold int; current_votes int; new_id uuid;
begin
  select * into prop from public.event_proposals
    where id = case when TG_OP = 'DELETE' then OLD.proposal_id else NEW.proposal_id end;
  if prop is null or prop.promoted_event_id is not null then return null; end if;
  select coalesce(member_count, 0) into subs from public.tags where name = prop.tag_name;
  threshold := greatest(ceil(coalesce(subs,0) * 0.1)::int, 1);
  select count(*) into current_votes from public.event_proposal_votes where proposal_id = prop.id;
  update public.event_proposals set vote_count = current_votes, required_votes = threshold where id = prop.id;
  if current_votes >= threshold then
    insert into public.events(title, description, event_date, tag_name, location, is_official)
      values (prop.title, prop.description, prop.event_date, prop.tag_name, prop.location, false)
      returning id into new_id;
    update public.event_proposals set promoted_event_id = new_id where id = prop.id;
  end if;
  return null;
end;
$$;
drop trigger if exists epv_trg on public.event_proposal_votes;
create trigger epv_trg after insert or delete on public.event_proposal_votes
  for each row execute procedure public.maybe_promote_proposal();

-- ============================================================
-- 既存ユーザーへの補完（過去アカウントもプロフィール作成）
-- ============================================================
insert into public.profiles(id, nickname)
select id, split_part(email, '@', 1)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
  and length(split_part(email, '@', 1)) >= 1
on conflict (id) do nothing;
