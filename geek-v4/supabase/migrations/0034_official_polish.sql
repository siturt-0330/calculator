-- ============================================================
-- 0034: 公式コミュニティのポリッシュ
-- ============================================================
-- (1) community_spots に is_certified カラムを追加
--     - 公式 admin が追加した聖地は自動で is_certified=true
--     - UI で「公認」バッジを表示できる
-- (2) community_threads (BBS) に source カラムを追加
--     - 公式コミュニティのコメントタブからの投稿を区別する
--     - 今回は読み取り専用情報として残す (UI 用)
-- (3) public.is_official_admin_of(community_id) ヘルパー関数
--     - クライアント側で「自分が公式 admin か」を判定するため
-- ============================================================

-- (1) community_spots: 公認バッジ
alter table public.community_spots
  add column if not exists is_certified boolean not null default false;

create index if not exists community_spots_certified_idx
  on public.community_spots(community_id, is_certified)
  where is_certified = true;

-- 聖地 INSERT 時に、追加者が公式 admin なら自動で certified=true にする trigger
create or replace function public.community_spots_auto_certify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
begin
  select official_admin_user_id into v_admin
    from public.communities
   where id = new.community_id;

  if v_admin is not null and new.created_by = v_admin then
    new.is_certified := true;
  end if;
  return new;
end;
$$;

drop trigger if exists community_spots_auto_certify on public.community_spots;
create trigger community_spots_auto_certify
  before insert on public.community_spots
  for each row execute procedure public.community_spots_auto_certify();

-- (2) 公式 admin 判定ヘルパー
create or replace function public.is_official_admin_of(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.communities
    where id = p_community_id
      and is_official = true
      and official_admin_user_id = auth.uid()
  );
$$;

grant execute on function public.is_official_admin_of(uuid) to authenticated;

-- (3) 公式 admin が「公認」を手動で切り替える RPC
--     (admin が後から公認したくなった場合の手動操作用)
create or replace function public.toggle_spot_certified(
  p_spot_id uuid,
  p_certified boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
begin
  select community_id into v_community_id
    from public.community_spots
   where id = p_spot_id;

  if v_community_id is null then
    raise exception 'SPOT_NOT_FOUND';
  end if;

  if not public.is_official_admin_of(v_community_id) then
    raise exception 'NOT_OFFICIAL_ADMIN';
  end if;

  update public.community_spots set is_certified = p_certified where id = p_spot_id;
end;
$$;

grant execute on function public.toggle_spot_certified(uuid, boolean) to authenticated;
