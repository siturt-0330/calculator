-- ============================================================
-- PERSONAL EVENTS (個人カレンダー)
-- ============================================================
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
create index if not exists personal_events_user_date_idx on public.personal_events(user_id, event_date);
alter table public.personal_events enable row level security;
drop policy if exists "pe_read" on public.personal_events;
drop policy if exists "pe_insert" on public.personal_events;
drop policy if exists "pe_update" on public.personal_events;
drop policy if exists "pe_delete" on public.personal_events;
create policy "pe_read" on public.personal_events for select using (auth.uid() = user_id);
create policy "pe_insert" on public.personal_events for insert with check (auth.uid() = user_id);
create policy "pe_update" on public.personal_events for update using (auth.uid() = user_id);
create policy "pe_delete" on public.personal_events for delete using (auth.uid() = user_id);

-- ============================================================
-- EVENT PROPOSALS (タグへの提案・10%同意で本採用)
-- ============================================================
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
create index if not exists ep_tag_idx on public.event_proposals(tag_name, event_date);
alter table public.event_proposals enable row level security;
drop policy if exists "ep_read" on public.event_proposals;
drop policy if exists "ep_insert" on public.event_proposals;
create policy "ep_read" on public.event_proposals for select using (true);
create policy "ep_insert" on public.event_proposals for insert with check (auth.uid() = proposer_id);

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
create policy "epv_read" on public.event_proposal_votes for select using (true);
create policy "epv_insert" on public.event_proposal_votes for insert with check (auth.uid() = user_id);
create policy "epv_delete" on public.event_proposal_votes for delete using (auth.uid() = user_id);

-- 10%同意でeventsに昇格
create or replace function public.maybe_promote_proposal()
returns trigger language plpgsql as $$
declare
  prop record;
  subs int;
  threshold int;
  current_votes int;
  new_id uuid;
begin
  select * into prop from public.event_proposals
    where id = case when TG_OP = 'DELETE' then OLD.proposal_id else NEW.proposal_id end;
  if prop is null or prop.promoted_event_id is not null then
    return null;
  end if;
  select coalesce(member_count, 0) into subs from public.tags where name = prop.tag_name;
  threshold := greatest(ceil(coalesce(subs,0) * 0.1)::int, 1);
  select count(*) into current_votes from public.event_proposal_votes where proposal_id = prop.id;
  update public.event_proposals
    set vote_count = current_votes, required_votes = threshold
    where id = prop.id;
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
create trigger epv_trg
  after insert or delete on public.event_proposal_votes
  for each row execute procedure public.maybe_promote_proposal();
