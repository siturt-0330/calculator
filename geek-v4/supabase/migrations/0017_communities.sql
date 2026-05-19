-- ============================================================
-- 0017: コミュニティ機能 (YouTube 登録チャンネル風)
-- ============================================================
-- 設計:
--   - communities: コミュニティ本体
--   - community_members: 所属メンバー (role: owner/admin/member)
--   - community_join_requests: 許可制への参加申請
--   - community_tags: タグ (M:N — graph 共用)
--   - community_posts: コミュニティ内のポスト (タイムライン)
--
-- 可視性 (visibility):
--   - 'open'    : 誰でも参加可、誰でも検索可
--   - 'request' : 検索可だが参加には許可必要 (closed - request)
--   - 'invite'  : 検索結果に出ない、招待 / 直接 URL のみ
--
-- 権限:
--   - 作成: 任意の authed user (作成者は owner として members に入る)
--   - update name/description/icon/tags: 任意の member (要件: アイコンはメンバー誰でも)
--   - delete: owner のみ
--   - 投稿: member のみ
-- ============================================================

-- ============================================================
-- communities
-- ============================================================
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 40),
  description text default '' check (length(description) <= 500),
  icon_emoji text not null default '👥' check (length(icon_emoji) between 1 and 8),
  icon_color text not null default '#7C6AF7' check (icon_color ~ '^#[0-9A-Fa-f]{6}$'),
  visibility text not null default 'open' check (visibility in ('open', 'request', 'invite')),
  member_count integer not null default 0,
  post_count integer not null default 0,
  last_post_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists communities_created_at_idx on public.communities(created_at desc);
create index if not exists communities_last_post_at_idx on public.communities(last_post_at desc nulls last);
create index if not exists communities_visibility_idx on public.communities(visibility);
create index if not exists communities_name_idx on public.communities(lower(name));

-- ============================================================
-- community_members
-- ============================================================
create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists community_members_user_idx on public.community_members(user_id, joined_at desc);
create index if not exists community_members_community_idx on public.community_members(community_id);

-- ============================================================
-- community_join_requests
-- ============================================================
create table if not exists public.community_join_requests (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text default '' check (length(message) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists community_join_requests_user_idx on public.community_join_requests(user_id);
create index if not exists community_join_requests_community_status_idx on public.community_join_requests(community_id, status);

-- ============================================================
-- community_tags
-- ============================================================
create table if not exists public.community_tags (
  community_id uuid not null references public.communities(id) on delete cascade,
  tag text not null check (length(tag) between 1 and 40),
  primary key (community_id, tag)
);

create index if not exists community_tags_tag_idx on public.community_tags(tag);

-- ============================================================
-- community_posts
-- ============================================================
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  image_url text,
  created_at timestamptz not null default now()
);

create index if not exists community_posts_community_created_idx on public.community_posts(community_id, created_at desc);
create index if not exists community_posts_author_idx on public.community_posts(author_id);

-- ============================================================
-- カウンタ更新 trigger
-- ============================================================
create or replace function public.handle_community_member_change()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.communities set member_count = member_count + 1 where id = new.community_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.communities set member_count = greatest(member_count - 1, 0) where id = old.community_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists on_community_member_change on public.community_members;
create trigger on_community_member_change
  after insert or delete on public.community_members
  for each row execute procedure public.handle_community_member_change();

create or replace function public.handle_community_post_change()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.communities
      set post_count = post_count + 1, last_post_at = new.created_at
      where id = new.community_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.communities set post_count = greatest(post_count - 1, 0) where id = old.community_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists on_community_post_change on public.community_posts;
create trigger on_community_post_change
  after insert or delete on public.community_posts
  for each row execute procedure public.handle_community_post_change();

-- ============================================================
-- 作成時に owner を自動追加する trigger
-- ============================================================
create or replace function public.handle_new_community()
returns trigger language plpgsql security definer as $$
begin
  insert into public.community_members(community_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (community_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_community_created on public.communities;
create trigger on_community_created
  after insert on public.communities
  for each row execute procedure public.handle_new_community();

-- ============================================================
-- RLS
-- ============================================================
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_join_requests enable row level security;
alter table public.community_tags enable row level security;
alter table public.community_posts enable row level security;

-- helper: 自分が member かどうか
create or replace function public.is_community_member(c_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.community_members
    where community_id = c_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_community_owner(c_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.community_members
    where community_id = c_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- ----- communities -----
drop policy if exists "communities_select" on public.communities;
create policy "communities_select" on public.communities for select using (
  visibility in ('open', 'request')
  or public.is_community_member(id)
);

drop policy if exists "communities_insert" on public.communities;
create policy "communities_insert" on public.communities for insert with check (auth.uid() = created_by);

drop policy if exists "communities_update" on public.communities;
create policy "communities_update" on public.communities for update using (public.is_community_member(id));

drop policy if exists "communities_delete" on public.communities;
create policy "communities_delete" on public.communities for delete using (public.is_community_owner(id));

-- ----- community_members -----
drop policy if exists "community_members_select" on public.community_members;
create policy "community_members_select" on public.community_members for select using (
  -- 自分の所属レコードは見える + open / request の community のメンバーは見える
  user_id = auth.uid()
  or community_id in (
    select id from public.communities where visibility in ('open', 'request')
  )
  or public.is_community_member(community_id)
);

drop policy if exists "community_members_insert" on public.community_members;
create policy "community_members_insert" on public.community_members for insert with check (
  -- 自分自身を open community に追加する場合のみ direct INSERT 可
  -- request / invite community への追加は owner 経由
  user_id = auth.uid() and (
    community_id in (select id from public.communities where visibility = 'open')
    or public.is_community_owner(community_id)
  )
  -- owner が他人を追加する場合
  or public.is_community_owner(community_id)
);

drop policy if exists "community_members_delete" on public.community_members;
create policy "community_members_delete" on public.community_members for delete using (
  user_id = auth.uid() or public.is_community_owner(community_id)
);

-- ----- community_join_requests -----
drop policy if exists "community_join_requests_select" on public.community_join_requests;
create policy "community_join_requests_select" on public.community_join_requests for select using (
  user_id = auth.uid() or public.is_community_owner(community_id)
);

drop policy if exists "community_join_requests_insert" on public.community_join_requests;
create policy "community_join_requests_insert" on public.community_join_requests for insert with check (
  user_id = auth.uid()
  and community_id in (select id from public.communities where visibility = 'request')
);

drop policy if exists "community_join_requests_update" on public.community_join_requests;
create policy "community_join_requests_update" on public.community_join_requests for update using (
  public.is_community_owner(community_id)
);

drop policy if exists "community_join_requests_delete" on public.community_join_requests;
create policy "community_join_requests_delete" on public.community_join_requests for delete using (
  user_id = auth.uid() or public.is_community_owner(community_id)
);

-- ----- community_tags -----
drop policy if exists "community_tags_select" on public.community_tags;
create policy "community_tags_select" on public.community_tags for select using (
  community_id in (select id from public.communities)  -- communities の RLS で絞られる
);

drop policy if exists "community_tags_insert" on public.community_tags;
create policy "community_tags_insert" on public.community_tags for insert with check (
  public.is_community_member(community_id)
);

drop policy if exists "community_tags_delete" on public.community_tags;
create policy "community_tags_delete" on public.community_tags for delete using (
  public.is_community_member(community_id)
);

-- ----- community_posts -----
drop policy if exists "community_posts_select" on public.community_posts;
create policy "community_posts_select" on public.community_posts for select using (
  -- open community の post は誰でも見える、それ以外は member のみ
  community_id in (select id from public.communities where visibility = 'open')
  or public.is_community_member(community_id)
);

drop policy if exists "community_posts_insert" on public.community_posts;
create policy "community_posts_insert" on public.community_posts for insert with check (
  author_id = auth.uid() and public.is_community_member(community_id)
);

drop policy if exists "community_posts_delete" on public.community_posts;
create policy "community_posts_delete" on public.community_posts for delete using (
  author_id = auth.uid() or public.is_community_owner(community_id)
);

-- ============================================================
-- helper function: 招待制で参加する RPC (招待コード経由)
-- ============================================================
create or replace function public.join_community_by_id(c_id uuid)
returns void language plpgsql security definer as $$
declare
  v_visibility text;
begin
  select visibility into v_visibility from public.communities where id = c_id;
  if v_visibility is null then
    raise exception 'community not found';
  end if;
  if v_visibility = 'open' then
    insert into public.community_members(community_id, user_id, role)
    values (c_id, auth.uid(), 'member')
    on conflict (community_id, user_id) do nothing;
  elsif v_visibility = 'invite' then
    -- 招待コード経由なら入れる (URL シェアモデル)
    insert into public.community_members(community_id, user_id, role)
    values (c_id, auth.uid(), 'member')
    on conflict (community_id, user_id) do nothing;
  else
    raise exception 'this community requires approval — use request_join_community instead';
  end if;
end;
$$;
