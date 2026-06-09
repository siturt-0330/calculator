-- ============================================================
-- 0139_user_tag_affinity.sql — サーバー側タグ親和性スコア
-- ============================================================
-- YouTube/Instagram Two-Tower レコメンドの「ユーザーベクトル」を
-- Supabase/PostgreSQL で実現する基盤テーブル。
-- クライアントの MMKV タグ履歴を定期同期し、get_for_you_feed RPC の
-- タグ親和性ボーナス計算に使用する。
--
-- 設計:
--   affinity_score: 0〜100、週次で 0.9 倍に減衰 (run_decay_tag_affinity)
--   event_count: 累積イベント数 (参考値)
--   last_event_at: 最終更新 (減衰・クリーンアップ判定に使用)
-- RPC:
--   upsert_tag_affinity(text[], real): タグ親和性を加算
--   get_user_top_tags(int): 上位タグ一覧を返す
-- ★ pg_cron 登録は下部コメント参照
-- ============================================================

create table if not exists public.user_tag_affinity (
  user_id       uuid references auth.users(id) on delete cascade not null,
  tag_name      text not null check (length(tag_name) between 1 and 100),
  affinity_score real not null default 1.0 check (affinity_score >= 0),
  event_count   integer not null default 1 check (event_count >= 0),
  last_event_at timestamptz not null default now(),
  primary key (user_id, tag_name)
);

alter table public.user_tag_affinity enable row level security;

create policy "uta_self_all" on public.user_tag_affinity
  for all using (auth.uid() = user_id);

-- 上位タグ降順クエリ高速化
create index if not exists idx_uta_user_score
  on public.user_tag_affinity (user_id, affinity_score desc);

-- ============================================================
-- upsert_tag_affinity — タグ親和性を加算/作成 (upsert)
-- p_delta: いいね=3.0, 保存=2.0, 長閲覧=1.0, タグクリック=1.5
--           unlike=-2.0, 懸念=-3.0, 非表示=-4.0
-- ============================================================
create or replace function public.upsert_tag_affinity(
  p_tag_names text[],
  p_delta     real default 1.0
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
  if p_tag_names is null or array_length(p_tag_names, 1) is null then return; end if;
  if array_length(p_tag_names, 1) > 50 then
    raise exception 'too many tags (max 50)' using errcode = '22023';
  end if;
  insert into public.user_tag_affinity (user_id, tag_name, affinity_score, event_count, last_event_at)
  select v_uid, t, greatest(p_delta, 0.0), 1, now()
  from unnest(p_tag_names) as t(t)
  where length(t) between 1 and 100
  on conflict (user_id, tag_name) do update
  set affinity_score = least(greatest(user_tag_affinity.affinity_score + p_delta, 0.0), 100.0),
      event_count    = user_tag_affinity.event_count + 1,
      last_event_at  = now();
end;
$$;

grant execute on function public.upsert_tag_affinity(text[], real) to authenticated;

-- 上位タグを返す (for_you_feed の候補選択 + クライアント表示)
create or replace function public.get_user_top_tags(
  p_limit int default 20
)
returns table(tag_name text, affinity_score real)
language sql
security definer
set search_path = public
stable
as $$
  select tag_name, affinity_score
  from public.user_tag_affinity
  where user_id = auth.uid()
  order by affinity_score desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

grant execute on function public.get_user_top_tags(int) to authenticated;

-- ============================================================
-- run_decay_tag_affinity — 週次減衰
-- 7日以上更新のないスコアを 0.9 倍、0.5 未満を削除
-- pg_cron 登録 (Supabase Dashboard → Database → pg_cron):
--   select cron.schedule('decay-tag-affinity', '0 3 * * 1',
--     $$select public.run_decay_tag_affinity()$$);
-- ============================================================
create or replace function public.run_decay_tag_affinity()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_tag_affinity
  set affinity_score = affinity_score * 0.9
  where last_event_at < now() - interval '7 days';

  delete from public.user_tag_affinity
  where affinity_score < 0.5;
end;
$$;

select '0139_user_tag_affinity 完了 — サーバー側タグ親和性 + upsert/top_tags/decay' as note;
