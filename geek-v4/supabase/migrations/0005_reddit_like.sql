-- ============================================================
-- VOTES (up/down voting, Reddit-style)
-- ============================================================
create table if not exists public.votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.votes enable row level security;
drop policy if exists "votes_read" on public.votes;
drop policy if exists "votes_insert" on public.votes;
drop policy if exists "votes_update" on public.votes;
drop policy if exists "votes_delete" on public.votes;
create policy "votes_read" on public.votes for select using (true);
create policy "votes_insert" on public.votes for insert with check (auth.uid() = user_id);
create policy "votes_update" on public.votes for update using (auth.uid() = user_id);
create policy "votes_delete" on public.votes for delete using (auth.uid() = user_id);

-- ============================================================
-- POSTS: score + hot_score
-- ============================================================
alter table public.posts add column if not exists score integer not null default 0;
alter table public.posts add column if not exists hot_score double precision not null default 0;

create index if not exists posts_score_idx on public.posts(score desc);
create index if not exists posts_hot_idx on public.posts(hot_score desc);

create or replace function public.update_post_score()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  if TG_OP = 'INSERT' then
    pid := NEW.post_id;
    update public.posts set score = score + NEW.value where id = pid;
  elsif TG_OP = 'UPDATE' then
    pid := NEW.post_id;
    update public.posts set score = score + NEW.value - OLD.value where id = pid;
  elsif TG_OP = 'DELETE' then
    pid := OLD.post_id;
    update public.posts set score = score - OLD.value where id = pid;
  end if;
  update public.posts
  set hot_score = sign(score)::double precision * log(greatest(abs(score), 1)) + extract(epoch from created_at) / 45000.0
  where id = pid;
  return null;
end;
$$;

drop trigger if exists votes_trg on public.votes;
create trigger votes_trg
  after insert or update or delete on public.votes
  for each row execute procedure public.update_post_score();

-- Initialize hot_score on existing posts
update public.posts set hot_score = extract(epoch from created_at) / 45000.0 where hot_score = 0;

-- ============================================================
-- TAG SUBSCRIPTIONS (Reddit-like join community)
-- ============================================================
create table if not exists public.tag_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  tag_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tag_name)
);

create index if not exists tag_sub_tag_idx on public.tag_subscriptions(tag_name);

alter table public.tag_subscriptions enable row level security;
drop policy if exists "tag_sub_read" on public.tag_subscriptions;
drop policy if exists "tag_sub_insert" on public.tag_subscriptions;
drop policy if exists "tag_sub_delete" on public.tag_subscriptions;
create policy "tag_sub_read" on public.tag_subscriptions for select using (true);
create policy "tag_sub_insert" on public.tag_subscriptions for insert with check (auth.uid() = user_id);
create policy "tag_sub_delete" on public.tag_subscriptions for delete using (auth.uid() = user_id);

-- ============================================================
-- TAGS: community fields
-- ============================================================
alter table public.tags add column if not exists description text;
alter table public.tags add column if not exists banner_color text default '#7C6AF7';
alter table public.tags add column if not exists member_count integer not null default 0;

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
create trigger tag_sub_trg
  after insert or delete on public.tag_subscriptions
  for each row execute procedure public.update_tag_member_count();
