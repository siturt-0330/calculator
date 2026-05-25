-- ============================================================
-- 0046_event_spot_link.sql
-- ------------------------------------------------------------
-- community_events に spot_id を追加し、イベントを spot (会場) と紐付け。
-- 1 spot : N events (ライブ会場で複数公演、聖地で複数イベント等)。
--
-- 既存イベントは spot_id null のまま (location_text のみ持つ場合あり)。
-- 段階的に spot_id 付き event に移行できる設計。
-- ============================================================

alter table public.community_events
  add column if not exists spot_id uuid
    references public.community_spots(id) on delete set null;

-- spot 別の upcoming イベントを取りやすくする index
-- (spot 詳細画面 / spot マップで「この会場の直近イベント」を出す用途)
create index if not exists community_events_spot_starts_idx
  on public.community_events(spot_id, starts_at)
  where spot_id is not null;

-- スポットと event が同一 community に属する整合性を担保 (defensive)
-- RLS は既存 (community_events_select / insert) でカバー済みだが、
-- spot_id 不正混入は CHECK では拾えないので trigger で防御。
create or replace function public.validate_event_spot_community()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spot_community uuid;
begin
  if new.spot_id is null then
    return new;
  end if;

  select community_id into v_spot_community
  from public.community_spots
  where id = new.spot_id;

  if v_spot_community is null then
    raise exception 'SPOT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_spot_community <> new.community_id then
    raise exception 'SPOT_COMMUNITY_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_validate_event_spot on public.community_events;
create trigger tr_validate_event_spot
  before insert or update of spot_id, community_id on public.community_events
  for each row
  execute function public.validate_event_spot_community();

-- ============================================================
-- 確認 (apply 後に手動で実行する用)
-- ============================================================
-- select column_name, data_type, is_nullable from information_schema.columns
-- where table_name = 'community_events' and column_name = 'spot_id';
--
-- 期待: spot_id | uuid | YES
