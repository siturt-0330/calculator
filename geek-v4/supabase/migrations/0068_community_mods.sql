-- ============================================================
-- 0068: コミュニティ管理人 (mod) 機能
-- ============================================================
-- 設計:
--   community_members.role が 'owner' / 'admin' のユーザーは mod として
--   そのコミュニティ内で以下の操作が出来る:
--     1) 投稿 (posts) の削除
--     2) コメント (comments) / BBS 返信 (bbs_replies) の削除
--     3) メンバーのキック (community_members から除外)
--     4) メンバーの BAN (再参加不可)
--
-- 既存設計の注意点:
--   - posts は community_id 列を持たない (post_communities 中間テーブル 0023)
--   - bbs_threads.community_id は直接列として存在 (0023)
--   - community_members の INSERT は 0036 で 2 つに split
--     ("community_members_insert_self_open" + "community_members_insert_by_owner")
--   - admin bypass policy ("posts_admin_all" 等) は別途存在 (0027) — 触らない
--
-- 全 statement は idempotent (drop policy if exists / create or replace function /
-- create table if not exists / on conflict do nothing 等)。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) community_bans: BAN リスト (キック+再参加禁止)
-- ============================================================
create table if not exists public.community_bans (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  banned_by uuid not null references auth.users(id),
  reason text,
  banned_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists community_bans_user_idx
  on public.community_bans(user_id);

alter table public.community_bans enable row level security;

-- mod だけが SELECT 可 + 自分が BAN されてるかは見える
drop policy if exists "community_bans_mod_read" on public.community_bans;
create policy "community_bans_mod_read" on public.community_bans
  for select using (
    exists (
      select 1 from public.community_members m
      where m.community_id = community_bans.community_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
    or user_id = auth.uid()
  );

-- mod だけが INSERT 可
drop policy if exists "community_bans_mod_insert" on public.community_bans;
create policy "community_bans_mod_insert" on public.community_bans
  for insert with check (
    exists (
      select 1 from public.community_members m
      where m.community_id = community_bans.community_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- mod だけが DELETE 可 (= unban)
drop policy if exists "community_bans_mod_delete" on public.community_bans;
create policy "community_bans_mod_delete" on public.community_bans
  for delete using (
    exists (
      select 1 from public.community_members m
      where m.community_id = community_bans.community_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- 2) mod_action_logs: mod の操作履歴 (audit log)
-- ============================================================
-- 「誰が誰に何をした」を全部残す。target は post / comment / bbs_reply / user の
-- どれか 1 つ (null 可 — action による)。
create table if not exists public.mod_action_logs (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  mod_user_id uuid not null references auth.users(id),
  target_user_id uuid references auth.users(id),
  target_post_id uuid references public.posts(id) on delete set null,
  target_comment_id uuid references public.comments(id) on delete set null,
  target_bbs_reply_id uuid references public.bbs_replies(id) on delete set null,
  action text not null check (action in (
    'delete_post', 'delete_comment', 'delete_bbs_reply',
    'kick', 'ban', 'unban', 'promote', 'demote'
  )),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists mod_action_logs_community_idx
  on public.mod_action_logs(community_id, created_at desc);

alter table public.mod_action_logs enable row level security;

-- mod だけが log を読める
drop policy if exists "mod_action_logs_mod_read" on public.mod_action_logs;
create policy "mod_action_logs_mod_read" on public.mod_action_logs
  for select using (
    exists (
      select 1 from public.community_members m
      where m.community_id = mod_action_logs.community_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- mod 自身が自分の action として log を書き込める
drop policy if exists "mod_action_logs_mod_insert" on public.mod_action_logs;
create policy "mod_action_logs_mod_insert" on public.mod_action_logs
  for insert with check (
    mod_user_id = auth.uid()
    and exists (
      select 1 from public.community_members m
      where m.community_id = mod_action_logs.community_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- 3) is_community_mod helper function (owner or admin)
-- ============================================================
-- 既存 is_community_owner / is_community_member (0017) と同じ書式に揃える。
-- RLS policy から呼ぶ前提なので stable + security definer + search_path 固定。
create or replace function public.is_community_mod(target_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.community_members
    where community_id = target_community_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

comment on function public.is_community_mod(uuid) is
  'mod (owner or admin) 判定。community_members.role を見る security definer 関数。';

-- ============================================================
-- 4) posts.delete に mod 削除権限を追加
-- ============================================================
-- posts は community_id 列を持たないため、post_communities 中間テーブル経由で
-- そのポストがリンクされている community のいずれかで自分が mod かを確認。
-- 既存ポリシー (posts_delete / posts_delete_self) は両方とも auth.uid() = author_id
-- だったので、これを 1 本に統合する。
-- admin bypass policy (posts_admin_all, 0027) はそのまま残るので
-- platform admin はこれまで通り何でも削除可。
drop policy if exists "posts_delete" on public.posts;
drop policy if exists "posts_delete_self" on public.posts;
create policy "posts_delete" on public.posts
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from public.post_communities pc
      where pc.post_id = posts.id
        and public.is_community_mod(pc.community_id)
    )
  );

-- ============================================================
-- 5) comments.delete に mod 削除権限を追加
-- ============================================================
-- comments は post_id を持つ → posts.post_communities 経由で community を逆引き。
-- 既存ポリシー (comments_delete / comments_delete_self) は両方とも自著のみ。
drop policy if exists "comments_delete" on public.comments;
drop policy if exists "comments_delete_self" on public.comments;
create policy "comments_delete" on public.comments
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from public.post_communities pc
      where pc.post_id = comments.post_id
        and public.is_community_mod(pc.community_id)
    )
  );

-- ============================================================
-- 6) bbs_replies.delete に mod 削除権限を追加
-- ============================================================
-- bbs_threads.community_id は直接列 (0023) なので逆引きが単純。
-- community_id が null (= 全体スレ) の場合は mod 削除権限なし → author のみ。
drop policy if exists "bbs_replies_delete" on public.bbs_replies;
drop policy if exists "bbs_replies_delete_self" on public.bbs_replies;
create policy "bbs_replies_delete" on public.bbs_replies
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from public.bbs_threads t
      where t.id = bbs_replies.thread_id
        and t.community_id is not null
        and public.is_community_mod(t.community_id)
    )
  );

-- ============================================================
-- 7) community_members.delete に mod キック権限を追加
-- ============================================================
-- 既存 (0017): user_id = auth.uid() or is_community_owner(community_id)
-- 拡張: mod (= owner / admin) もキック可。
-- 自分自身は退会扱いで OK (RPC 側では「自分は kick できない」guard を入れる)。
drop policy if exists "community_members_delete" on public.community_members;
create policy "community_members_delete" on public.community_members
  for delete using (
    user_id = auth.uid()
    or public.is_community_mod(community_id)
  );

-- ============================================================
-- 8) community_members.insert に BAN チェックを追加
-- ============================================================
-- 既存 (0036) は 2 つに split されている:
--   - community_members_insert_self_open : open community への self join
--   - community_members_insert_by_owner  : owner が他人を追加
-- どちらにも「community_bans に該当行がない」条件を AND で追加する。
do $$
begin
  if to_regclass('public.community_members') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip section 8: community_members / communities not found';
    return;
  end if;

  execute 'drop policy if exists "community_members_insert" on public.community_members';
  execute 'drop policy if exists "community_members_insert_self_open" on public.community_members';
  execute 'drop policy if exists "community_members_insert_by_owner" on public.community_members';

  execute $sql$
    create policy "community_members_insert_self_open" on public.community_members
      for insert with check (
        user_id = auth.uid()
        and community_id in (
          select id from public.communities where visibility = 'open'
        )
        and not exists (
          select 1 from public.community_bans b
          where b.community_id = community_members.community_id
            and b.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy "community_members_insert_by_owner" on public.community_members
      for insert with check (
        public.is_community_owner(community_id)
        and not exists (
          select 1 from public.community_bans b
          where b.community_id = community_members.community_id
            and b.user_id = community_members.user_id
        )
      )
  $sql$;
end $$;

-- ============================================================
-- 9) mod 専用 RPC: mod_kick_member
-- ============================================================
-- 「キック」= community_members から削除 + log 記録。BAN はしない (再参加可)。
-- security definer で実行し、最初に mod チェック + 自分は kick できない guard。
create or replace function public.mod_kick_member(
  target_community_id uuid,
  target_user_id uuid,
  reason text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_community_mod(target_community_id) then
    raise exception 'mod only';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot kick yourself';
  end if;

  delete from public.community_members
  where community_id = target_community_id and user_id = target_user_id;

  insert into public.mod_action_logs (
    community_id, mod_user_id, target_user_id, action, reason
  ) values (
    target_community_id, auth.uid(), target_user_id, 'kick', reason
  );
end;
$$;

-- ============================================================
-- 10) mod 専用 RPC: mod_ban_member (= kick + ban)
-- ============================================================
-- メンバー削除 + community_bans 記録 + log。再参加は community_members_insert_*
-- ポリシーの NOT EXISTS チェックで阻止される。
create or replace function public.mod_ban_member(
  target_community_id uuid,
  target_user_id uuid,
  reason text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_community_mod(target_community_id) then
    raise exception 'mod only';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot ban yourself';
  end if;

  delete from public.community_members
  where community_id = target_community_id and user_id = target_user_id;

  insert into public.community_bans (community_id, user_id, banned_by, reason)
  values (target_community_id, target_user_id, auth.uid(), reason)
  on conflict (community_id, user_id) do update
    set banned_by = excluded.banned_by,
        reason = excluded.reason,
        banned_at = now();

  insert into public.mod_action_logs (
    community_id, mod_user_id, target_user_id, action, reason
  ) values (
    target_community_id, auth.uid(), target_user_id, 'ban', reason
  );
end;
$$;

-- ============================================================
-- 11) mod 専用 RPC: mod_unban_member
-- ============================================================
create or replace function public.mod_unban_member(
  target_community_id uuid,
  target_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_community_mod(target_community_id) then
    raise exception 'mod only';
  end if;

  delete from public.community_bans
  where community_id = target_community_id and user_id = target_user_id;

  insert into public.mod_action_logs (
    community_id, mod_user_id, target_user_id, action
  ) values (
    target_community_id, auth.uid(), target_user_id, 'unban'
  );
end;
$$;

-- ============================================================
-- 12) GRANT
-- ============================================================
grant execute on function public.is_community_mod(uuid) to authenticated;
grant execute on function public.mod_kick_member(uuid, uuid, text) to authenticated;
grant execute on function public.mod_ban_member(uuid, uuid, text) to authenticated;
grant execute on function public.mod_unban_member(uuid, uuid) to authenticated;
