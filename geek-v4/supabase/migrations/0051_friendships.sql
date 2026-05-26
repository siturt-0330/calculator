-- ============================================================
-- 0051_friendships.sql
-- ============================================================
-- 友達追加機能 (Phase 1 — 招待リンク方式のみ):
--   - friendship_status enum
--   - friendships table (互恵承認制) + RLS
--   - friend_invites table (検索 UI なし → リンクで友達追加) + RLS
--   - accept_friend_invite(code_in text) RPC (security definer)
--   - friendships を realtime publication に追加
--
-- spec: docs/MYPAGE_ALBUMS_SPEC.md § 2
-- ============================================================

-- 友達ステータス
create type friendship_status as enum ('pending', 'accepted', 'blocked');

-- 友達関係 (互恵承認制)
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);
create index friendships_requester_idx on public.friendships (requester_id, status);
create index friendships_recipient_idx on public.friendships (recipient_id, status);

alter table public.friendships enable row level security;
create policy "friendships select own" on public.friendships
  for select using (auth.uid() in (requester_id, recipient_id));
create policy "friendships insert by requester" on public.friendships
  for insert with check (auth.uid() = requester_id);
create policy "friendships update by recipient" on public.friendships
  for update using (auth.uid() = recipient_id);
create policy "friendships delete by either" on public.friendships
  for delete using (auth.uid() in (requester_id, recipient_id));

-- 招待リンク (検索なし → リンクで友達追加)
create table public.friend_invites (
  code text primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  used_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz
);
create index friend_invites_created_by_idx on public.friend_invites (created_by);

alter table public.friend_invites enable row level security;
create policy "friend_invites select own" on public.friend_invites
  for select using (auth.uid() in (created_by, used_by));
create policy "friend_invites insert own" on public.friend_invites
  for insert with check (auth.uid() = created_by);
-- 受諾は accept_friend_invite RPC のみ (security definer で安全に更新)
create policy "friend_invites delete own" on public.friend_invites
  for delete using (auth.uid() = created_by);

-- 招待受諾 RPC
create or replace function public.accept_friend_invite(code_in text)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  inv record;
  fid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
  select * into inv from public.friend_invites
    where code = code_in
      and used_by is null
      and expires_at > now()
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', '招待コードが無効または期限切れです');
  end if;
  if inv.created_by = uid then
    return jsonb_build_object('ok', false, 'error', '自分の招待コードは使えません');
  end if;
  if exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = inv.created_by and recipient_id = uid)
        or (requester_id = uid and recipient_id = inv.created_by))
  ) then
    return jsonb_build_object('ok', false, 'error', 'すでに友達です');
  end if;
  select id into fid from public.friendships
    where (requester_id = inv.created_by and recipient_id = uid)
       or (requester_id = uid and recipient_id = inv.created_by);
  if fid is not null then
    update public.friendships
      set status = 'accepted', accepted_at = now()
      where id = fid;
  else
    insert into public.friendships (requester_id, recipient_id, status, accepted_at)
      values (uid, inv.created_by, 'accepted', now())
      returning id into fid;
  end if;
  update public.friend_invites
    set used_by = uid, used_at = now()
    where code = code_in;
  return jsonb_build_object('ok', true, 'friendship_id', fid);
end;
$$;
grant execute on function public.accept_friend_invite(text) to authenticated;

-- realtime
alter publication supabase_realtime add table public.friendships;

-- end of 0051_friendships.sql
