-- ============================================================
-- 0143_user_blocks.sql — ユーザーブロック (匿名ユーザー対応)
-- ============================================================
-- 匿名投稿でも pseudonym_id (0116) を使って「この匿名ユーザーを
-- ブロックする」が実現できる。pseudonym_id は投稿ごとに
-- 一定期間内は同一ユーザーに同じ値が割り当てられる。
--
-- blocker_id: ブロックしたユーザー (auth.uid())
-- blocked_pseudonym_id: ブロック対象の pseudonym_id
-- reason: 'spam' | 'harassment' | 'other' (参考値)
-- ============================================================

create table if not exists public.user_blocks (
  blocker_id           uuid references auth.users(id) on delete cascade not null,
  blocked_pseudonym_id text not null check (length(blocked_pseudonym_id) between 1 and 100),
  reason               text check (reason in ('spam', 'harassment', 'other')),
  created_at           timestamptz not null default now(),
  primary key (blocker_id, blocked_pseudonym_id)
);

alter table public.user_blocks enable row level security;

create policy "blocks_self_all" on public.user_blocks
  for all using (auth.uid() = blocker_id);

create index if not exists idx_blocks_blocker
  on public.user_blocks (blocker_id);

-- ブロック追加 RPC
create or replace function public.block_pseudonym(
  p_pseudonym_id text,
  p_reason       text default 'other'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if p_pseudonym_id is null or length(trim(p_pseudonym_id)) = 0 then return; end if;
  insert into public.user_blocks (blocker_id, blocked_pseudonym_id, reason)
  values (auth.uid(), p_pseudonym_id, p_reason)
  on conflict (blocker_id, blocked_pseudonym_id) do nothing;
end;
$$;

grant execute on function public.block_pseudonym(text, text) to authenticated;

-- ブロック解除 RPC
create or replace function public.unblock_pseudonym(
  p_pseudonym_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_blocks
  where blocker_id = auth.uid()
    and blocked_pseudonym_id = p_pseudonym_id;
end;
$$;

grant execute on function public.unblock_pseudonym(text) to authenticated;

-- ブロック済み pseudonym_id 一覧を返す
create or replace function public.get_blocked_pseudonyms()
returns table(blocked_pseudonym_id text, reason text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select blocked_pseudonym_id, reason, created_at
  from public.user_blocks
  where blocker_id = auth.uid()
  order by created_at desc;
$$;

grant execute on function public.get_blocked_pseudonyms() to authenticated;

select '0143_user_blocks 完了 — 匿名ユーザーブロック (pseudonym_id ベース)' as note;
