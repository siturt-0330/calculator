-- ============================================================
-- 0019: コミュニティ機能のセキュリティ強化
-- ============================================================
-- 発覚した脆弱性:
--   (1) join_community_by_id() RPC が invite 制コミュニティに対して、
--       UUID を知っている任意のユーザーを参加させる状態だった。
--       「完全招待制」の趣旨に反する。
--   (2) communities_update RLS が member 全員に name / visibility /
--       description の編集権を与えていた。要件は「アイコンは誰でも変更可」
--       なのに、それ以上の編集権まで与えていた。
--   (3) アイコン画像の Storage path は <community_id>/... なので、
--       community_id を知る非メンバーは GET で参照できてしまう (public bucket)。
--       現状の要件 (アイコンは公開) では OK だが、明示しておく。
-- ============================================================

-- ============================================================
-- (1) Invite Token system
-- ============================================================
create table if not exists public.community_invites (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  token text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  max_uses integer,   -- null = unlimited
  uses integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists community_invites_community_idx on public.community_invites(community_id);
create index if not exists community_invites_token_idx on public.community_invites(token);

alter table public.community_invites enable row level security;

-- Member だけが自分のコミュニティの invite を SELECT/INSERT/DELETE できる
drop policy if exists "community_invites_select" on public.community_invites;
create policy "community_invites_select" on public.community_invites for select using (
  public.is_community_member(community_id)
);
drop policy if exists "community_invites_insert" on public.community_invites;
create policy "community_invites_insert" on public.community_invites for insert with check (
  public.is_community_member(community_id) and created_by = auth.uid()
);
drop policy if exists "community_invites_delete" on public.community_invites;
create policy "community_invites_delete" on public.community_invites for delete using (
  public.is_community_owner(community_id) or created_by = auth.uid()
);

-- token 経由で参加する RPC
create or replace function public.join_community_by_invite(invite_token text)
returns uuid language plpgsql security definer as $$
declare
  v_community_id uuid;
  v_max_uses integer;
  v_uses integer;
  v_expires_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select community_id, max_uses, uses, expires_at
    into v_community_id, v_max_uses, v_uses, v_expires_at
    from public.community_invites
    where token = invite_token;

  if v_community_id is null then
    raise exception 'invalid invite';
  end if;
  if v_expires_at is not null and v_expires_at < now() then
    raise exception 'invite expired';
  end if;
  if v_max_uses is not null and v_uses >= v_max_uses then
    raise exception 'invite usage limit reached';
  end if;

  insert into public.community_members(community_id, user_id, role)
  values (v_community_id, auth.uid(), 'member')
  on conflict (community_id, user_id) do nothing;

  update public.community_invites set uses = uses + 1 where token = invite_token;
  return v_community_id;
end;
$$;

-- ============================================================
-- (2) join_community_by_id を open 専用に絞る (invite を許さない)
-- ============================================================
create or replace function public.join_community_by_id(c_id uuid)
returns void language plpgsql security definer as $$
declare
  v_visibility text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select visibility into v_visibility from public.communities where id = c_id;
  if v_visibility is null then
    raise exception 'community not found';
  end if;
  if v_visibility = 'open' then
    insert into public.community_members(community_id, user_id, role)
    values (c_id, auth.uid(), 'member')
    on conflict (community_id, user_id) do nothing;
  elsif v_visibility = 'invite' then
    raise exception 'invite-only community — use join_community_by_invite(token) instead';
  else
    raise exception 'this community requires approval — use request_join_community instead';
  end if;
end;
$$;

-- ============================================================
-- (3) communities_update RLS を分割
--     - icon_url / icon_emoji / icon_color: member 誰でも可
--     - name / description / visibility / その他: owner / admin のみ
--
-- PostgreSQL の RLS では「特定カラムの UPDATE だけ許可」がそのまま書けない
-- (UPDATE は行単位の権限) ので、column-level GRANT + per-column RLS check で
-- 実装する。シンプルにする為に、UPDATE policy を 2 種類用意する:
--   - member は icon_* だけを書き換える権利を持つ (column GRANT で制限)
--   - owner / admin は全カラムを書き換えられる
-- ============================================================

drop policy if exists "communities_update" on public.communities;

-- helper: 自分が owner / admin か
create or replace function public.is_community_admin(c_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.community_members
    where community_id = c_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

-- 全カラム UPDATE 可能 (owner/admin 用)
create policy "communities_update_admin" on public.communities for update using (
  public.is_community_admin(id)
);

-- アイコン関連のみ UPDATE 可能 (member 用)
-- 行レベルでは「member であれば許可」を出すが、name 等を書き換えたら trigger で
-- reject する。
create policy "communities_update_icon_only" on public.communities for update using (
  public.is_community_member(id) and not public.is_community_admin(id)
);

-- column-level: name/description/visibility は owner/admin だけが変更できる
create or replace function public.guard_community_update()
returns trigger language plpgsql security definer as $$
begin
  -- owner/admin なら全部 OK
  if public.is_community_admin(new.id) then
    return new;
  end if;
  -- それ以外 (= 一般 member) は name / description / visibility / created_by を
  -- 変えてはいけない
  if new.name is distinct from old.name then
    raise exception 'only owner/admin can change name';
  end if;
  if new.description is distinct from old.description then
    raise exception 'only owner/admin can change description';
  end if;
  if new.visibility is distinct from old.visibility then
    raise exception 'only owner/admin can change visibility';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable';
  end if;
  if new.member_count is distinct from old.member_count then
    raise exception 'member_count is maintained by trigger';
  end if;
  if new.post_count is distinct from old.post_count then
    raise exception 'post_count is maintained by trigger';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_community_update_trg on public.communities;
create trigger guard_community_update_trg
  before update on public.communities
  for each row execute procedure public.guard_community_update();
