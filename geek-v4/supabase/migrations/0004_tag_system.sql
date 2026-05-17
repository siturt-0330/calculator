-- ============================================================
-- POST ADDED TAGS (tags added by other users to someone's post)
-- ============================================================
create table if not exists public.post_added_tags (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_name text not null,
  added_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(post_id, tag_name)
);

create index if not exists post_added_tags_post_idx on public.post_added_tags(post_id);

alter table public.post_added_tags enable row level security;

drop policy if exists "post_added_tags_select" on public.post_added_tags;
drop policy if exists "post_added_tags_insert" on public.post_added_tags;
drop policy if exists "post_added_tags_delete" on public.post_added_tags;

create policy "post_added_tags_select" on public.post_added_tags for select using (true);
create policy "post_added_tags_insert" on public.post_added_tags for insert with check (auth.uid() = added_by);
create policy "post_added_tags_delete" on public.post_added_tags for delete using (auth.uid() = added_by);

-- ============================================================
-- TAG RELATIONS (alias / related)
-- alphabetically smaller tag goes in tag_a
-- ============================================================
create table if not exists public.tag_relations (
  id uuid primary key default gen_random_uuid(),
  tag_a text not null,
  tag_b text not null,
  relation_type text not null check (relation_type in ('alias', 'related')),
  votes integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tag_a, tag_b, relation_type),
  check (tag_a < tag_b)
);

create index if not exists tag_relations_a_idx on public.tag_relations(tag_a);
create index if not exists tag_relations_b_idx on public.tag_relations(tag_b);

alter table public.tag_relations enable row level security;

drop policy if exists "tag_relations_select" on public.tag_relations;
drop policy if exists "tag_relations_insert" on public.tag_relations;
create policy "tag_relations_select" on public.tag_relations for select using (true);
create policy "tag_relations_insert" on public.tag_relations for insert with check (auth.uid() = created_by);

-- ============================================================
-- TAG GROUPS (e.g. "指原プロデュース" containing イコラブ・ノイミー・ニアジョイ)
-- ============================================================
create table if not exists public.tag_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check(length(name) between 1 and 50),
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tag_group_members (
  group_id uuid not null references public.tag_groups(id) on delete cascade,
  tag_name text not null,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, tag_name)
);

create index if not exists tag_group_members_tag_idx on public.tag_group_members(tag_name);

alter table public.tag_groups enable row level security;
alter table public.tag_group_members enable row level security;

drop policy if exists "tag_groups_select" on public.tag_groups;
drop policy if exists "tag_groups_insert" on public.tag_groups;
drop policy if exists "tag_group_members_select" on public.tag_group_members;
drop policy if exists "tag_group_members_insert" on public.tag_group_members;

create policy "tag_groups_select" on public.tag_groups for select using (true);
create policy "tag_groups_insert" on public.tag_groups for insert with check (auth.uid() = created_by);
create policy "tag_group_members_select" on public.tag_group_members for select using (true);
create policy "tag_group_members_insert" on public.tag_group_members for insert with check (auth.uid() = added_by);

-- ============================================================
-- EVENTS (for calendar, tied to tags)
-- ============================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(title) between 1 and 100),
  description text,
  event_date date not null,
  tag_name text not null,
  location text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists events_date_idx on public.events(event_date);
create index if not exists events_tag_idx on public.events(tag_name);

alter table public.events enable row level security;

drop policy if exists "events_select" on public.events;
drop policy if exists "events_insert" on public.events;
create policy "events_select" on public.events for select using (true);
create policy "events_insert" on public.events for insert with check (auth.uid() = created_by);
