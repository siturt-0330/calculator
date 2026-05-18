-- ============================================================
-- 0013: 投票機能 / ブックマークコレクション / 保存検索 / バッジ / コンテンツ警告
-- ============================================================

-- ============================================================
-- 1. CONTENT WARNINGS on posts
-- ============================================================
alter table public.posts add column if not exists content_warning text;
alter table public.posts add column if not exists cw_category text
  check (cw_category in ('spoiler','nsfw','violence','sensitive','none') or cw_category is null);

create index if not exists posts_cw_category_idx on public.posts(cw_category) where cw_category is not null;

-- ============================================================
-- 2. POLLS
-- ============================================================
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  question text not null check (length(question) between 1 and 200),
  expires_at timestamptz,
  multi_select boolean not null default false,
  is_anonymous boolean not null default true,
  total_votes integer not null default 0,
  created_at timestamptz not null default now(),
  unique (post_id)
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null check (length(label) between 1 and 80),
  ordinal integer not null,
  vote_count integer not null default 0
);

create index if not exists poll_options_poll_idx on public.poll_options(poll_id, ordinal);

create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, user_id)
);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "polls_read"   on public.polls;
drop policy if exists "polls_insert" on public.polls;
drop policy if exists "po_read"      on public.poll_options;
drop policy if exists "po_insert"    on public.poll_options;
drop policy if exists "pv_read"      on public.poll_votes;
drop policy if exists "pv_insert"    on public.poll_votes;
drop policy if exists "pv_delete"    on public.poll_votes;

create policy "polls_read"   on public.polls for select using (true);
create policy "polls_insert" on public.polls for insert with check (
  exists (select 1 from public.posts where id = post_id and author_id = auth.uid())
);
create policy "po_read"   on public.poll_options for select using (true);
create policy "po_insert" on public.poll_options for insert with check (
  exists (select 1 from public.polls pl join public.posts p on pl.post_id = p.id
          where pl.id = poll_id and p.author_id = auth.uid())
);
create policy "pv_read"   on public.poll_votes for select using (true);
create policy "pv_insert" on public.poll_votes for insert with check (auth.uid() = user_id);
create policy "pv_delete" on public.poll_votes for delete using (auth.uid() = user_id);

-- vote_count を自動更新
create or replace function public.update_poll_vote_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.poll_options
      set vote_count = vote_count + 1
      where id = NEW.option_id;
    update public.polls
      set total_votes = total_votes + 1
      where id = NEW.poll_id;
  elsif TG_OP = 'DELETE' then
    update public.poll_options
      set vote_count = greatest(vote_count - 1, 0)
      where id = OLD.option_id;
    update public.polls
      set total_votes = greatest(total_votes - 1, 0)
      where id = OLD.poll_id;
  end if;
  return null;
end;
$$;

drop trigger if exists poll_votes_count_trigger on public.poll_votes;
create trigger poll_votes_count_trigger
  after insert or delete on public.poll_votes
  for each row execute procedure public.update_poll_vote_count();

-- ============================================================
-- 3. BOOKMARK COLLECTIONS
--    saves テーブルにコレクション機能を拡張
-- ============================================================
create table if not exists public.bookmark_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  emoji text default '📂',
  is_public boolean not null default false,
  bookmark_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists bookmark_collections_user_idx on public.bookmark_collections(user_id);

-- saves に collection_id 追加 (オプショナル: 未指定なら「未分類」)
alter table public.saves add column if not exists collection_id uuid references public.bookmark_collections(id) on delete set null;

alter table public.bookmark_collections enable row level security;
drop policy if exists "bc_read"   on public.bookmark_collections;
drop policy if exists "bc_insert" on public.bookmark_collections;
drop policy if exists "bc_update" on public.bookmark_collections;
drop policy if exists "bc_delete" on public.bookmark_collections;

create policy "bc_read"   on public.bookmark_collections for select using (is_public or auth.uid() = user_id);
create policy "bc_insert" on public.bookmark_collections for insert with check (auth.uid() = user_id);
create policy "bc_update" on public.bookmark_collections for update using (auth.uid() = user_id);
create policy "bc_delete" on public.bookmark_collections for delete using (auth.uid() = user_id);

-- bookmark_count を自動更新
create or replace function public.update_bookmark_collection_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' and NEW.collection_id is not null then
    update public.bookmark_collections
      set bookmark_count = bookmark_count + 1
      where id = NEW.collection_id;
  elsif TG_OP = 'DELETE' and OLD.collection_id is not null then
    update public.bookmark_collections
      set bookmark_count = greatest(bookmark_count - 1, 0)
      where id = OLD.collection_id;
  elsif TG_OP = 'UPDATE' then
    if OLD.collection_id is not null and OLD.collection_id <> NEW.collection_id then
      update public.bookmark_collections
        set bookmark_count = greatest(bookmark_count - 1, 0)
        where id = OLD.collection_id;
    end if;
    if NEW.collection_id is not null and (OLD.collection_id is null or OLD.collection_id <> NEW.collection_id) then
      update public.bookmark_collections
        set bookmark_count = bookmark_count + 1
        where id = NEW.collection_id;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists saves_collection_trg on public.saves;
create trigger saves_collection_trg
  after insert or update or delete on public.saves
  for each row execute procedure public.update_bookmark_collection_count();

-- ============================================================
-- 4. SAVED SEARCHES
-- ============================================================
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  query text not null check (length(query) between 1 and 200),
  label text,
  notify_new_results boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, query)
);

create index if not exists saved_searches_user_idx on public.saved_searches(user_id, created_at desc);

alter table public.saved_searches enable row level security;
drop policy if exists "ss_read"   on public.saved_searches;
drop policy if exists "ss_insert" on public.saved_searches;
drop policy if exists "ss_update" on public.saved_searches;
drop policy if exists "ss_delete" on public.saved_searches;
create policy "ss_read"   on public.saved_searches for select using (auth.uid() = user_id);
create policy "ss_insert" on public.saved_searches for insert with check (auth.uid() = user_id);
create policy "ss_update" on public.saved_searches for update using (auth.uid() = user_id);
create policy "ss_delete" on public.saved_searches for delete using (auth.uid() = user_id);

-- ============================================================
-- 5. BADGES
-- ============================================================
create table if not exists public.badge_definitions (
  code text primary key,                              -- 'first_post', 'realtime_pioneer' 等
  name text not null,
  description text not null,
  emoji text not null,
  tier text not null default 'bronze' check (tier in ('bronze','silver','gold','rainbow')),
  is_secret boolean not null default false
);

create table if not exists public.user_badges (
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_code text not null references public.badge_definitions(code) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_code)
);

create index if not exists user_badges_user_idx on public.user_badges(user_id);

alter table public.badge_definitions enable row level security;
alter table public.user_badges enable row level security;
drop policy if exists "bd_read" on public.badge_definitions;
drop policy if exists "ub_read" on public.user_badges;
drop policy if exists "ub_insert" on public.user_badges;
create policy "bd_read"   on public.badge_definitions for select using (true);
create policy "ub_read"   on public.user_badges for select using (true);
create policy "ub_insert" on public.user_badges for insert with check (auth.uid() = user_id);

-- 初期バッジ定義
insert into public.badge_definitions (code, name, description, emoji, tier) values
  ('first_post',         '初投稿',            '初めて投稿した',                       '🎉', 'bronze'),
  ('first_comment',      '初コメント',        '初めてコメントを書いた',                '💬', 'bronze'),
  ('first_reaction',     '初リアクション',     '初めてテキストスタンプを送った',          '🪶', 'bronze'),
  ('first_bbs_reply',    '初スレ参戦',         '初めて掲示板に返信した',                '📣', 'bronze'),
  ('liker_10',           '応援家',             '10件いいねをした',                     '💛', 'bronze'),
  ('liker_100',          '愛されし応援家',     '100件いいねをした',                    '💖', 'silver'),
  ('poster_10',          '常連',              '10件投稿した',                         '📝', 'silver'),
  ('poster_100',         '生粋のGeek',        '100件投稿した',                        '👑', 'gold'),
  ('liked_received_50',  '響くひと',          '50いいねを受け取った',                 '✨', 'silver'),
  ('liked_received_500', '伝説の発信者',       '500いいねを受け取った',                 '🌟', 'gold'),
  ('reaction_collector', '共感の灯台',         'スタンプを30人から受け取った',           '🕯️', 'silver'),
  ('tag_curator',        'タグキュレーター',   '他人の投稿に10件タグを追加した',          '🏷️', 'silver'),
  ('safe_harbor',        '安全の番人',         '低信頼投稿を5件「気になる」した',         '🛡️', 'silver'),
  ('community_builder',  'コミュニティ・ビルダー','5つの異なるタグで投稿した',         '🌍', 'gold'),
  ('night_owl',          '夜更かし',           '深夜0-4時に投稿した',                  '🦉', 'bronze'),
  ('early_bird',         '朝活',               '朝5-8時に投稿した',                   '🌅', 'bronze'),
  ('week_streak',        '一週間皆勤',         '7日連続で投稿した',                    '🔥', 'silver'),
  ('month_streak',       '月間皆勤',           '30日連続で投稿した',                   '🏆', 'gold'),
  ('rainbow',            '虹色',              '全部位のバッジを獲得 (隠しバッジ)',       '🌈', 'rainbow')
on conflict (code) do update set
  name = excluded.name, description = excluded.description, emoji = excluded.emoji, tier = excluded.tier;

-- バッジ自動付与: 主要イベントで判定
create or replace function public.maybe_grant_badge(p_user_id uuid, p_code text)
returns void language plpgsql security definer as $$
begin
  insert into public.user_badges(user_id, badge_code)
  values (p_user_id, p_code)
  on conflict do nothing;
end;
$$;

create or replace function public.check_badges_on_post()
returns trigger language plpgsql security definer as $$
declare
  pc int;
  tags_count int;
  hr int;
begin
  -- first_post / poster_10 / poster_100
  select post_count into pc from public.profiles where id = NEW.author_id;
  perform public.maybe_grant_badge(NEW.author_id, 'first_post');
  if pc >= 10 then perform public.maybe_grant_badge(NEW.author_id, 'poster_10'); end if;
  if pc >= 100 then perform public.maybe_grant_badge(NEW.author_id, 'poster_100'); end if;

  -- night_owl / early_bird
  hr := extract(hour from NEW.created_at at time zone 'Asia/Tokyo');
  if hr >= 0 and hr < 4 then perform public.maybe_grant_badge(NEW.author_id, 'night_owl'); end if;
  if hr >= 5 and hr < 8 then perform public.maybe_grant_badge(NEW.author_id, 'early_bird'); end if;

  -- community_builder: 5つの異なるタグで投稿
  select count(distinct unnested) into tags_count from (
    select unnest(tag_names) as unnested
    from public.posts where author_id = NEW.author_id
  ) t;
  if tags_count >= 5 then perform public.maybe_grant_badge(NEW.author_id, 'community_builder'); end if;
  return null;
end;
$$;

drop trigger if exists badges_on_post on public.posts;
create trigger badges_on_post
  after insert on public.posts
  for each row execute procedure public.check_badges_on_post();

create or replace function public.check_badges_on_comment()
returns trigger language plpgsql security definer as $$
begin
  perform public.maybe_grant_badge(NEW.author_id, 'first_comment');
  return null;
end;
$$;

drop trigger if exists badges_on_comment on public.comments;
create trigger badges_on_comment
  after insert on public.comments
  for each row execute procedure public.check_badges_on_comment();

create or replace function public.check_badges_on_bbs_reply()
returns trigger language plpgsql security definer as $$
begin
  perform public.maybe_grant_badge(NEW.author_id, 'first_bbs_reply');
  return null;
end;
$$;

drop trigger if exists badges_on_bbs_reply on public.bbs_replies;
create trigger badges_on_bbs_reply
  after insert on public.bbs_replies
  for each row execute procedure public.check_badges_on_bbs_reply();

create or replace function public.check_badges_on_reaction()
returns trigger language plpgsql security definer as $$
begin
  perform public.maybe_grant_badge(NEW.user_id, 'first_reaction');
  return null;
end;
$$;

drop trigger if exists badges_on_reaction on public.post_reactions;
create trigger badges_on_reaction
  after insert on public.post_reactions
  for each row execute procedure public.check_badges_on_reaction();

-- ============================================================
-- 6. Realtime publication
-- ============================================================
do $$
declare t text;
begin
  for t in select unnest(array['polls','poll_options','poll_votes','bookmark_collections','saved_searches','badge_definitions','user_badges']) loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
