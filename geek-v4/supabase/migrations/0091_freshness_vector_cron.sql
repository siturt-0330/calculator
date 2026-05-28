-- ============================================================
-- 0091_freshness_vector_cron.sql — 鮮度 (freshness) 継続マージ + cron
-- ============================================================
-- 目的:
--   時事ネタ / スポーツ実況 など「直近の盛り上がり」を ranking に反映する
--   ための freshness_score を post 単位で継続更新する仕組みを導入する。
--
--   既存の post_quality_score (0087) の engagement_velocity は
--   "24h 以内なら likes_count / 10 を 0..1 cap" の 1 軸シンプル計算で、
--   24h を超えた post はすべて 0.5 neutral になる仕様。
--   それでは「7 日前の事件で今も伸びている」みたいな post を boost できない。
--
--   このマイグレーションで以下を導入:
--     1. post_freshness_score (materialized view) — 過去 7 日 post の鮮度
--     2. refresh_post_freshness() RPC — MV を CONCURRENTLY 再計算 (admin only)
--     3. pg_cron job (毎時 15 分) — 拡張がある環境のみ自動登録
--     4. freshness_global_stats table — 直近 refresh の統計 (1 行運用)
--     5. get_post_freshness(p_post_id) RPC — 0097 v4 RPC から参照される
--
-- スキーマ前提 (確認済 — 既存 migration 編集禁止):
--   posts.id           uuid                          (0001)
--   posts.created_at   timestamptz                   (0001)
--   posts.likes_count  integer not null default 0    (0001)
--   likes              table (user_id, post_id) PK   (0001)
--   post_quality_score view (engagement_velocity col) (0087)
--   pg_cron extension は managed 環境のみ確保される可能性あり (0074 で導入試行)
--
-- 設計判断:
--   * すべて create [or replace] / if not exists / drop ... if exists で冪等。
--   * pg_cron が無い環境 (self-hosted など) でも migration が落ちないように
--     do $$ ... exception when others $$ で握る。Edge function 経由で
--     1h 毎に refresh_post_freshness() を call する fallback を comment で明示。
--   * REFRESH MATERIALIZED VIEW CONCURRENTLY を使う前提なので、
--     post_id に UNIQUE INDEX を必ず張る。
--   * 過去 7 日以内の post のみを対象にし、refresh コストを定数化する。
--     より古い post は freshness=0 を呼び出し側で fallback する想定。
--   * RPC はすべて SECURITY DEFINER + search_path lockdown
--     (PostgreSQL search_path 注入対策 — 0083 / 0085 / 0087 と同スタイル)。
--   * refresh_post_freshness は重い処理なので admin (public.is_admin())
--     経由のみ実行可とし、サービスからは直接呼ばない。cron / Edge 専用。
--
-- freshness_score の式:
--   * 24h 以内 (created_at > now() - 24h):
--       velocity_24h = least(likes_count / 20.0, 1.0)      ※ 20 likes で 1.0
--       freshness_score = velocity_24h
--   * 24h 〜 7 day:
--       hours_alive       = extract(epoch from now() - created_at)/3600
--       sustained         = likes_count / hours_alive       (= 1h あたり like)
--       sustained_norm    = least(sustained / 0.5, 1.0)    ※ 0.5 likes/h で 1.0
--       decay             = exp(-hours_alive / 168.0)      ※ 7d で 1/e ≒ 0.37
--       freshness_score   = sustained_norm * decay
--   * 7 日超: MV に含めない (= get_post_freshness は 0 を返す)
-- ============================================================

-- ============================================================
-- 0. 前提 extension (pg_cron は環境依存なので別ブロックで try)
-- ============================================================
-- pg_cron は 0050 / 0074 で create extension 済みの環境が多いが、
-- self-hosted では未提供のことがある。create extension は do block で握る。
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  -- managed でない環境では権限不足 / 未提供で落ちる。fallback として
  -- Edge function から refresh_post_freshness() を直接 cron で呼ぶ運用にする。
  raise notice 'pg_cron extension is unavailable; refresh_post_freshness() must be invoked via Edge function (hourly).';
end $$;

-- ============================================================
-- 1. post_freshness_score — materialized view
-- ============================================================
-- 過去 7 日以内の post のみを対象に、24h 以内 / それ以降で別の式を使い
-- freshness_score を 0..1 で算出する。
-- ============================================================
drop materialized view if exists public.post_freshness_score cascade;
create materialized view public.post_freshness_score as
with src as (
  select
    p.id           as post_id,
    p.created_at,
    coalesce(p.likes_count, 0)::numeric as likes_count,
    -- 経過時間 (時間単位)。0 除算回避のため最低 0.0167h (=1 分) を underflow としてクランプ。
    greatest(
      extract(epoch from (now() - p.created_at)) / 3600.0,
      0.0167
    )::numeric as hours_since_post
  from public.posts p
  where p.created_at > now() - interval '7 days'
)
select
  s.post_id,
  s.created_at,
  s.hours_since_post,

  -- velocity_24h: 24h 以内なら likes_count を 20 で正規化 (0..1)、それ以外 0
  -- snapshot 性質上 "24h 中の delta" は持てないので、likes_count 全体を proxy にする。
  case
    when s.hours_since_post <= 24.0 then
      least(s.likes_count / 20.0, 1.0)
    else
      0.0
  end::numeric as velocity_24h,

  -- sustained_engagement: 24h 経過後の累積 likes / 経過時間 (= 1h あたり likes)
  -- 24h 以内では 0 とする (= まだ "sustained" と判定しない)。
  case
    when s.hours_since_post > 24.0 then
      s.likes_count / s.hours_since_post
    else
      0.0
  end::numeric as sustained_engagement,

  -- freshness_score: 24h 以内 = velocity_24h、24h 超 = sustained_norm * decay
  --   sustained_norm = least(sustained / 0.5, 1.0)
  --   decay = exp(-hours_since_post / 168.0)  -- 7d で 1/e ≒ 0.37
  case
    when s.hours_since_post <= 24.0 then
      least(s.likes_count / 20.0, 1.0)
    else
      least(
        (s.likes_count / s.hours_since_post) / 0.5,
        1.0
      ) * exp(-s.hours_since_post / 168.0)
  end::numeric as freshness_score
from src s;

comment on materialized view public.post_freshness_score is
  '過去 7 日以内の post の鮮度スコア (0..1)。24h 以内は velocity_24h、24h 超は sustained_engagement * decay。毎時 cron で refresh。';

-- ============================================================
-- 2. INDEX — CONCURRENTLY refresh に必須の UNIQUE index + sort 用
-- ============================================================
-- CONCURRENTLY REFRESH には UNIQUE INDEX が 1 本以上必要。
create unique index if not exists post_freshness_score_post_id_uidx
  on public.post_freshness_score (post_id);

-- 上位 N 件取得 (時事ネタフィード) を高速化する DESC index
create index if not exists post_freshness_score_score_desc_idx
  on public.post_freshness_score (freshness_score desc);

-- 表示権限 — invoker の posts RLS は通らないが、freshness_score 自体は
-- public 情報 (likes_count と created_at の派生) なので read を全員に開放。
grant select on public.post_freshness_score to anon, authenticated;

-- ============================================================
-- 3. freshness_global_stats — 単一行 stats table
-- ============================================================
-- 直近 refresh のメタ情報を保持。frontend / 監視で見たいときに使う。
-- id = 1 固定の単一行運用 (UPSERT で更新)。
-- ============================================================
create table if not exists public.freshness_global_stats (
  id smallint primary key default 1
    check (id = 1),  -- 多重行禁止
  last_refreshed_at timestamptz,
  posts_included int not null default 0,
  mean_freshness numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- 初期行 (idempotent)
insert into public.freshness_global_stats (id, last_refreshed_at, posts_included, mean_freshness)
values (1, null, 0, 0)
on conflict (id) do nothing;

-- 読み取りは公開、書き込みは admin / SECURITY DEFINER 経由のみ
alter table public.freshness_global_stats enable row level security;

drop policy if exists "freshness_global_stats_read" on public.freshness_global_stats;
create policy "freshness_global_stats_read" on public.freshness_global_stats
  for select using (true);

-- 直接 INSERT / UPDATE / DELETE は誰にも許さない (RPC 経由のみ)
revoke insert, update, delete on public.freshness_global_stats from anon;
revoke insert, update, delete on public.freshness_global_stats from authenticated;
revoke insert, update, delete on public.freshness_global_stats from public;

grant select on public.freshness_global_stats to anon, authenticated;

-- ============================================================
-- 4. refresh_post_freshness() — admin 限定 RPC
-- ============================================================
-- 重い処理。サービスから呼ばない。cron / admin / Edge function のみ。
-- ============================================================
drop function if exists public.refresh_post_freshness();
create or replace function public.refresh_post_freshness()
returns table (
  refreshed_at timestamptz,
  posts_included int,
  mean_freshness numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count int := 0;
  v_mean  numeric := 0;
  v_now   timestamptz := now();
begin
  -- 認可: admin 以外 (cron / service_role を除く) からは拒否。
  -- pg_cron は cron user で実行され auth.uid() が null なので、明示的に許可する。
  -- auth.uid() が null の場合 (= cron / service_role) も通す。
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'refresh_post_freshness: admin only';
  end if;

  -- CONCURRENTLY は UNIQUE INDEX が必要 — post_freshness_score_post_id_uidx で OK。
  -- ただし初回 (MV が空) は CONCURRENTLY が使えないので、通常 refresh にフォールバック。
  begin
    refresh materialized view concurrently public.post_freshness_score;
  exception when others then
    refresh materialized view public.post_freshness_score;
  end;

  -- 統計を更新
  select
    count(*)::int,
    coalesce(avg(freshness_score), 0)::numeric
  into v_count, v_mean
  from public.post_freshness_score;

  update public.freshness_global_stats
  set
    last_refreshed_at = v_now,
    posts_included    = v_count,
    mean_freshness    = v_mean,
    updated_at        = v_now
  where id = 1;

  return query select v_now, v_count, v_mean;
end;
$$;

revoke all on function public.refresh_post_freshness() from public;
-- 直接 authenticated には付与しない (= admin / cron / Edge のみ)
grant execute on function public.refresh_post_freshness() to authenticated;

comment on function public.refresh_post_freshness() is
  '過去 7 日 post の freshness_score MV を CONCURRENTLY refresh + freshness_global_stats を更新。admin or pg_cron 専用。pg_cron が無い環境では Edge function (hourly) から呼ぶこと。';

-- ============================================================
-- 5. get_post_freshness(p_post_id) — 単一 post の freshness 取得
-- ============================================================
-- 0097 v4 search RPC や個別 post 表示用。MV に無い post (= 7 日超) は 0 を返す。
-- ============================================================
drop function if exists public.get_post_freshness(uuid);
create or replace function public.get_post_freshness(p_post_id uuid)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select freshness_score from public.post_freshness_score where post_id = p_post_id),
    0
  )::numeric;
$$;

revoke all on function public.get_post_freshness(uuid) from public;
grant execute on function public.get_post_freshness(uuid) to anon, authenticated;

comment on function public.get_post_freshness(uuid) is
  '指定 post の freshness_score (0..1) を返す。7 日超 / MV 未集計の post は 0。';

-- ============================================================
-- 6. pg_cron job — 毎時 15 分に refresh
-- ============================================================
-- pg_cron が無い環境では失敗するので do block で握る。
-- 拡張が無い場合: Edge function を 1h 毎に schedule して
--                 refresh_post_freshness() を呼ぶ運用にする。
-- ============================================================
do $$
begin
  -- 既存 job があれば unschedule (羃等化のため)
  begin
    perform cron.unschedule('refresh-post-freshness');
  exception when others then
    null;  -- job が無いだけなので無視
  end;

  -- 毎時 15 分に refresh
  perform cron.schedule(
    'refresh-post-freshness',
    '15 * * * *',
    $cron$select public.refresh_post_freshness();$cron$
  );
exception when others then
  -- pg_cron extension が無い / cron schema 参照不可 → 静かに諦める
  raise notice 'pg_cron job registration skipped (extension unavailable). Use Edge function to call refresh_post_freshness() hourly.';
end $$;

-- ============================================================
-- 7. 初回 refresh — MV が空のまま 1 時間放置されないように
-- ============================================================
-- CONCURRENTLY は MV が空のとき使えないため、初回は通常 refresh で。
do $$
begin
  refresh materialized view public.post_freshness_score;

  -- 統計も初回更新
  update public.freshness_global_stats
  set
    last_refreshed_at = now(),
    posts_included    = (select count(*)::int from public.post_freshness_score),
    mean_freshness    = (select coalesce(avg(freshness_score), 0)::numeric from public.post_freshness_score),
    updated_at        = now()
  where id = 1;
exception when others then
  -- posts が空 等の理由で失敗しても migration 自体は止めない
  raise notice 'Initial refresh of post_freshness_score failed (safe to ignore on empty DB): %', sqlerrm;
end $$;

-- ============================================================
-- 8. ANALYZE
-- ============================================================
-- planner に freshness MV / stats table の統計を認識させる。
analyze public.posts;
analyze public.likes;
analyze public.freshness_global_stats;
-- MV は analyze 可能
analyze public.post_freshness_score;

select '0091_freshness_vector_cron 完了 — post_freshness_score MV + refresh_post_freshness / get_post_freshness RPC + pg_cron job (15 * * * *) 登録' as note;
