-- ============================================================
-- POSTS: 投稿カテゴリ・出典・拡散リミット・気になる数
-- ============================================================
alter table public.posts add column if not exists kind text not null default 'opinion'
  check (kind in ('fact', 'opinion', 'joke', 'wip'));
alter table public.posts add column if not exists source_url text;
alter table public.posts add column if not exists max_reach integer; -- null = unlimited
alter table public.posts add column if not exists concern_count integer not null default 0;

-- ============================================================
-- CONCERNS (「気になる」= 低評価ベースの信頼スコア)
-- ============================================================
create table if not exists public.concerns (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  reason text not null default 'other' check (reason in ('misinfo', 'unverified', 'spam', 'rude', 'scam', 'other')),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.concerns enable row level security;
drop policy if exists "c_read" on public.concerns;
drop policy if exists "c_insert" on public.concerns;
drop policy if exists "c_delete" on public.concerns;
create policy "c_read" on public.concerns for select using (true);
create policy "c_insert" on public.concerns for insert with check (auth.uid() = user_id);
create policy "c_delete" on public.concerns for delete using (auth.uid() = user_id);

-- concern_count を自動更新
create or replace function public.update_concern_count()
returns trigger language plpgsql as $$
declare
  pid uuid;
  aid uuid;
begin
  if TG_OP = 'INSERT' then
    pid := NEW.post_id;
  else
    pid := OLD.post_id;
  end if;
  update public.posts
    set concern_count = (select count(*) from public.concerns where post_id = pid)
    where id = pid;
  -- 投稿主のアカウント状態更新
  select author_id into aid from public.posts where id = pid;
  if aid is not null then
    update public.profiles set concern_received_count = (
      select count(*) from public.concerns c
      join public.posts p on c.post_id = p.id
      where p.author_id = aid
    ) where id = aid;
    perform public.refresh_account_state(aid);
  end if;
  return null;
end;
$$;

drop trigger if exists concern_trg on public.concerns;
create trigger concern_trg
  after insert or delete on public.concerns
  for each row execute procedure public.update_concern_count();

-- ============================================================
-- PROFILES: 段階的アカウント状態
-- ============================================================
alter table public.profiles add column if not exists account_state text not null default 'healthy'
  check (account_state in ('healthy', 'caution', 'restricted', 'warned', 'suspended'));
alter table public.profiles add column if not exists concern_received_count integer not null default 0;

-- アカウント状態を「気になる」数 vs 投稿数で自動算出
create or replace function public.refresh_account_state(p_user uuid)
returns void language plpgsql as $$
declare
  pcount int;
  ccount int;
  ratio float;
  state text;
begin
  select post_count, concern_received_count into pcount, ccount
    from public.profiles where id = p_user;
  pcount := coalesce(pcount, 0);
  ccount := coalesce(ccount, 0);
  if pcount = 0 then
    ratio := 0;
  else
    ratio := ccount::float / pcount::float;
  end if;
  if ratio >= 1.5 then state := 'warned';
  elsif ratio >= 1.0 then state := 'restricted';
  elsif ratio >= 0.5 then state := 'caution';
  else state := 'healthy';
  end if;
  update public.profiles set account_state = state where id = p_user;
end;
$$;
