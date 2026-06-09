-- ============================================================
-- 0140_post_impressions.sql — 閲覧履歴 + コールドスタート追跡
-- ============================================================
-- Instagram の「再閲覧抑制」と「新規投稿への保証露出」を実現。
-- get_for_you_feed RPC が既読投稿を除外し、まだ露出の少ない新投稿に
-- コールドスタートブーストを与えるための基盤テーブル。
--
-- 設計:
--   seen_count > 1 かつ last_seen_at < 3日 の組み合わせ → for-you から除外
--   30日後に自動 TTL 削除 (cleanup_old_impressions)
-- RPC:
--   record_impression_batch(uuid[]): バッチで閲覧記録 (フィードスクロール時)
-- pg_cron 登録 (下部コメント参照)
-- ============================================================

create table if not exists public.post_impressions (
  user_id       uuid references auth.users(id) on delete cascade not null,
  post_id       uuid references public.posts(id) on delete cascade not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen_count    integer not null default 1 check (seen_count >= 1),
  primary key (user_id, post_id)
);

alter table public.post_impressions enable row level security;

create policy "imp_self_all" on public.post_impressions
  for all using (auth.uid() = user_id);

-- コールドスタート判定 (post_id 単位の unique viewer 数集計) 用
create index if not exists idx_impressions_post_id
  on public.post_impressions (post_id);

-- ============================================================
-- record_impression_batch — バッチ閲覧記録
-- フィードで表示された投稿をまとめて送信 (30s または 20件ごと)
-- ============================================================
create or replace function public.record_impression_batch(
  p_post_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if p_post_ids is null or array_length(p_post_ids, 1) is null then return; end if;
  if array_length(p_post_ids, 1) > 100 then
    raise exception 'too many post ids (max 100)' using errcode = '22023';
  end if;
  insert into public.post_impressions (user_id, post_id)
  select v_uid, pid
  from unnest(p_post_ids) as pid(pid)
  on conflict (user_id, post_id) do update
  set last_seen_at = now(),
      seen_count   = post_impressions.seen_count + 1;
end;
$$;

grant execute on function public.record_impression_batch(uuid[]) to authenticated;

-- ============================================================
-- cleanup_old_impressions — TTL クリーンアップ (30日)
-- pg_cron 登録:
--   select cron.schedule('cleanup-impressions', '0 4 * * *',
--     $$select public.cleanup_old_impressions()$$);
-- ============================================================
create or replace function public.cleanup_old_impressions()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.post_impressions
  where last_seen_at < now() - interval '30 days';
$$;

select '0140_post_impressions 完了 — 閲覧履歴 + バッチ記録 + TTL クリーンアップ' as note;
