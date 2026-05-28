-- ============================================================
-- 0095_search_engagement_log.sql — 検索エンゲージメントログ + 集計 view
-- ============================================================
-- 目的:
--   オフライン eval (検索品質測定) のための (query, post, signal) 三つ組の
--   イベントログを蓄積し、view で集計しやすくする。
--   AdaMerging (0088) の supervision signal にもなる。
--
--   既存の user_search_history (0086) は (query, clicked_post_id) のみで、
--   impression / dwell / vote / share まで載っていない。column 追加は禁止
--   (既存 migration 編集禁止 / idempotency 崩壊) なので、別 table を新設する。
--
-- このマイグレーションで追加するもの:
--   1. search_engagement_log          — (user, query, post, action) のイベントログ
--   2. search_quality_daily (view)    — day x ab_group で CTR / MRR / mean_pos を集計
--   3. post_engagement_rollup (view)  — post 単位の累積エンゲージメント
--   4. log_search_engagement RPC      — イベント投入 (rate limit + auth gate)
--   5. get_search_quality_metrics RPC — admin が日次品質を引く
--
-- スキーマ前提 (既存 migration 編集禁止):
--   posts.id                  uuid                              (0001)
--   auth.users(id)            Supabase Auth
--   public.user_ab_assignment (user_id, ab_group)              (0088)
--   public.current_user_is_admin()                              (0020)
--
-- 設計判断:
--   * すべて create [or replace] / if not exists / drop ... if exists で冪等。
--   * INSERT は anon/authenticated から revoke して RPC 経由のみにする
--     (rate limit + auth.uid() の強制を保証するため)。
--   * SECURITY DEFINER の関数は search_path = pg_catalog, public で lockdown
--     (0083 / 0085 / 0086 / 0088 と同じスタイル)。
--   * RLS: search_engagement_log は self read OK / admin で全 read。
--   * action は固定 enum 相当 (check 制約) — impression/click/dwell/
--     like/comment/save/share/concern。
--   * rate limit: 同じ (user, query, post, action) を 1 秒以内に再 log
--     しない (誤連打 / 二重発火対策)。
--   * view 側は SECURITY INVOKER 相当 (普通の view) で読む。RPC は admin gate。
-- ============================================================

-- ============================================================
-- 1. search_engagement_log — イベントログ table
-- ============================================================
create table if not exists public.search_engagement_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  query_text text not null check (length(query_text) between 1 and 200),
  post_id uuid references public.posts(id) on delete set null,
  position_in_results int check (position_in_results is null or position_in_results >= 1),
  action text not null check (action in (
    'impression', 'click', 'dwell', 'like', 'comment', 'save', 'share', 'concern'
  )),
  dwell_ms int check (dwell_ms is null or dwell_ms >= 0),
  rank_signals jsonb,
  ab_group text,
  created_at timestamptz not null default now()
);

comment on table public.search_engagement_log is
  '検索エンゲージメントの (query, post, signal, action) 三つ組ログ。オフライン eval / CTR / MRR / AdaMerging の supervision に使う';

-- ============================================================
-- 2. インデックス
-- ============================================================
-- ユーザー別タイムライン (self read で必要)
create index if not exists ix_search_engagement_user_created
  on public.search_engagement_log(user_id, created_at desc);

-- クエリ別タイムライン (query 単位の集計用)
create index if not exists ix_search_engagement_query_created
  on public.search_engagement_log(query_text, created_at desc);

-- 各 post のエンゲージメント集計用
create index if not exists ix_search_engagement_post_action
  on public.search_engagement_log(post_id, action)
  where post_id is not null;

-- A/B group 別集計用
create index if not exists ix_search_engagement_ab_action
  on public.search_engagement_log(ab_group, action)
  where ab_group is not null;

-- ============================================================
-- 3. RLS
-- ============================================================
alter table public.search_engagement_log enable row level security;

-- self read: 自分のログだけ見える
drop policy if exists sel_self_read on public.search_engagement_log;
create policy sel_self_read on public.search_engagement_log
  for select
  using (auth.uid() = user_id);

-- admin read: 全件可視
drop policy if exists sel_admin_read on public.search_engagement_log;
create policy sel_admin_read on public.search_engagement_log
  for select
  using (public.current_user_is_admin());

-- 直 insert は禁止 — RPC 経由のみ (rate limit + auth gate のため)
revoke insert on public.search_engagement_log from anon;
revoke insert on public.search_engagement_log from authenticated;
revoke insert on public.search_engagement_log from public;

-- update / delete も基本禁止 (admin だけ delete 可能にしたい場合は別 policy)
revoke update on public.search_engagement_log from anon;
revoke update on public.search_engagement_log from authenticated;
revoke update on public.search_engagement_log from public;

-- ============================================================
-- 4. search_quality_daily — 日次品質 view
-- ============================================================
-- day x ab_group で:
--   impressions / clicks / ctr (= clicks/impressions)
--   mean_position (clicked post の平均位置)
--   mrr (= mean(1/position) for clicked)
--   distinct_users / distinct_queries
-- ============================================================
drop view if exists public.search_quality_daily cascade;
create or replace view public.search_quality_daily as
with base as (
  select
    date_trunc('day', created_at)::date as day,
    coalesce(ab_group, 'unknown')       as ab_group,
    action,
    user_id,
    query_text,
    position_in_results
  from public.search_engagement_log
)
select
  b.day,
  b.ab_group,
  count(*) filter (where b.action = 'impression')                              as impressions,
  count(*) filter (where b.action = 'click')                                   as clicks,
  case
    when count(*) filter (where b.action = 'impression') > 0
      then (count(*) filter (where b.action = 'click'))::numeric
         / (count(*) filter (where b.action = 'impression'))::numeric
    else 0
  end                                                                          as ctr,
  avg(b.position_in_results) filter (
    where b.action = 'click' and b.position_in_results is not null
  )                                                                            as mean_position,
  avg(1.0 / b.position_in_results) filter (
    where b.action = 'click' and b.position_in_results is not null
                              and b.position_in_results > 0
  )                                                                            as mrr,
  count(distinct b.user_id)    filter (where b.user_id is not null)            as distinct_users,
  count(distinct b.query_text)                                                 as distinct_queries
from base b
group by b.day, b.ab_group;

comment on view public.search_quality_daily is
  '日次 × ab_group の検索品質メトリクス (impressions / clicks / CTR / mean_position / MRR / distinct_users / distinct_queries)';

-- ============================================================
-- 5. post_engagement_rollup — post 単位の累積エンゲージメント view
-- ============================================================
-- post_id 単位で各 action の累積 + engagement_rate (= 反応系 / impression)
-- ============================================================
drop view if exists public.post_engagement_rollup cascade;
create or replace view public.post_engagement_rollup as
select
  s.post_id,
  count(*) filter (where s.action = 'impression')                  as impression_count,
  count(*) filter (where s.action = 'click')                       as click_count,
  coalesce(
    sum(s.dwell_ms) filter (where s.action = 'dwell' and s.dwell_ms is not null),
    0
  )::bigint                                                        as dwell_total_ms,
  count(*) filter (where s.action = 'like')                        as like_count,
  count(*) filter (where s.action = 'share')                       as share_count,
  count(*) filter (where s.action = 'concern')                     as concern_count,
  case
    when count(*) filter (where s.action = 'impression') > 0 then
      (
        count(*) filter (where s.action in ('click','like','save','share','comment','dwell'))
      )::numeric
      /
      (count(*) filter (where s.action = 'impression'))::numeric
    else 0
  end                                                              as engagement_rate
from public.search_engagement_log s
where s.post_id is not null
group by s.post_id;

comment on view public.post_engagement_rollup is
  'post 単位の累積エンゲージメント (impression/click/dwell_total/like/share/concern + engagement_rate)';

-- ============================================================
-- 6. log_search_engagement — イベント投入 RPC
-- ============================================================
-- p_query        : クエリ文字列 (必須)
-- p_post_id      : 対象 post (null も許す — query 全体への impression など)
-- p_position     : 検索結果での 1-based 位置
-- p_action       : 8 種類のいずれか (check 制約あり)
-- p_dwell_ms     : dwell 時の滞在 ms (action='dwell' 以外は null 推奨)
-- p_rank_signals : その時点での signal jsonb (debug 用)
--
-- 動作:
--   * auth.uid() が null なら no-op (anon は記録しない)
--   * action が許可リスト外なら raise exception
--   * ab_group は user_ab_assignment (0088) から取得
--   * rate limit: 同じ (user, query, post, action) を 1 秒以内に再 log しない
-- ============================================================
drop function if exists public.log_search_engagement(text, uuid, int, text, int, jsonb);
create or replace function public.log_search_engagement(
  p_query        text,
  p_post_id      uuid,
  p_position     int,
  p_action       text,
  p_dwell_ms     int default null,
  p_rank_signals jsonb default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid       uuid := auth.uid();
  v_q         text;
  v_ab_group  text;
  v_last_at   timestamptz;
begin
  -- 1) auth gate — anon は no-op
  if v_uid is null then
    return;
  end if;

  -- 2) query validation
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;
  v_q := left(trim(p_query), 200);

  -- 3) action validation (check 制約と一致させる — 早期エラーで明示)
  if p_action is null or p_action not in (
    'impression', 'click', 'dwell', 'like', 'comment', 'save', 'share', 'concern'
  ) then
    raise exception 'log_search_engagement: invalid action %', p_action
      using errcode = '22023';
  end if;

  -- 4) position validation (1-based) — null は許可
  if p_position is not null and p_position < 1 then
    raise exception 'log_search_engagement: position_in_results must be >= 1'
      using errcode = '22023';
  end if;

  -- 5) dwell_ms validation — null OK
  if p_dwell_ms is not null and p_dwell_ms < 0 then
    raise exception 'log_search_engagement: dwell_ms must be >= 0'
      using errcode = '22023';
  end if;

  -- 6) ab_group lookup (0088) — 未割当なら null のまま入れる
  select ab_group into v_ab_group
    from public.user_ab_assignment
   where user_id = v_uid;

  -- 7) rate limit: 同じ (user, query, post, action) を 1 秒以内に再 log しない
  --    null post_id 同士の比較は is not distinct from で扱う
  select created_at into v_last_at
    from public.search_engagement_log
   where user_id = v_uid
     and query_text = v_q
     and post_id is not distinct from p_post_id
     and action = p_action
   order by created_at desc
   limit 1;

  if v_last_at is not null and v_last_at > now() - interval '1 second' then
    return;
  end if;

  -- 8) insert
  insert into public.search_engagement_log(
    user_id, query_text, post_id, position_in_results, action,
    dwell_ms, rank_signals, ab_group
  ) values (
    v_uid, v_q, p_post_id, p_position, p_action,
    p_dwell_ms, p_rank_signals, v_ab_group
  );
end;
$$;

revoke all on function public.log_search_engagement(text, uuid, int, text, int, jsonb) from public;
grant execute on function public.log_search_engagement(text, uuid, int, text, int, jsonb) to authenticated;

-- ============================================================
-- 7. get_search_quality_metrics — admin 用 集計取得 RPC
-- ============================================================
-- 戻り値 jsonb { ctr, mrr, mean_position, impressions, clicks,
--                distinct_users, distinct_queries, days }
-- 集計対象: search_quality_daily を指定 ab_group / 直近 N 日分で集約。
-- p_ab_group は null OK (= 全 group をまとめて集計)。
-- ============================================================
drop function if exists public.get_search_quality_metrics(text, int);
create or replace function public.get_search_quality_metrics(
  p_ab_group text,
  p_days     int default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_days int := greatest(coalesce(p_days, 7), 1);
  v_from date := (now() at time zone 'utc')::date - (v_days - 1);
  v_impressions bigint := 0;
  v_clicks      bigint := 0;
  v_ctr         numeric := 0;
  v_mrr         numeric := 0;
  v_mean_pos    numeric := 0;
  v_d_users     bigint := 0;
  v_d_queries   bigint := 0;
begin
  -- admin gate
  if not public.current_user_is_admin() then
    raise exception 'get_search_quality_metrics: forbidden (admin only)'
      using errcode = '42501';
  end if;

  -- ab_group フィルタ込みで search_quality_daily を集約。
  --   * impressions / clicks は単純 sum
  --   * ctr = sum(clicks) / sum(impressions) で再計算 (日平均ではない)
  --   * mrr / mean_position は impressions 件数で加重平均は厳密じゃないので
  --     ここでは日次値の単純平均 (= 日次の平均を平均) で近似する。
  --   * distinct_users / distinct_queries は view 内で日毎 distinct 済なので
  --     最大値を出すと「ある 1 日のピーク」、sum すると「日合算」になる。
  --     ここでは sum (= 日合計の用途を素直に出す) を採用。
  select
    coalesce(sum(impressions), 0),
    coalesce(sum(clicks), 0),
    coalesce(avg(mrr), 0),
    coalesce(avg(mean_position), 0),
    coalesce(sum(distinct_users), 0),
    coalesce(sum(distinct_queries), 0)
  into
    v_impressions, v_clicks, v_mrr, v_mean_pos, v_d_users, v_d_queries
  from public.search_quality_daily q
  where q.day >= v_from
    and (p_ab_group is null or q.ab_group = p_ab_group);

  if v_impressions > 0 then
    v_ctr := v_clicks::numeric / v_impressions::numeric;
  else
    v_ctr := 0;
  end if;

  return jsonb_build_object(
    'ab_group',         coalesce(p_ab_group, 'ALL'),
    'days',             v_days,
    'from_date',        v_from,
    'impressions',      v_impressions,
    'clicks',           v_clicks,
    'ctr',              v_ctr,
    'mrr',              v_mrr,
    'mean_position',    v_mean_pos,
    'distinct_users',   v_d_users,
    'distinct_queries', v_d_queries
  );
end;
$$;

revoke all on function public.get_search_quality_metrics(text, int) from public;
grant execute on function public.get_search_quality_metrics(text, int) to authenticated;

-- ============================================================
-- 8. ANALYZE (planner に新 stats を読ませる)
-- ============================================================
analyze public.search_engagement_log;

-- ============================================================
-- 9. 完了通知
-- ============================================================
select '0095_search_engagement_log 完了 — search_engagement_log + search_quality_daily / post_engagement_rollup views + log_search_engagement / get_search_quality_metrics RPC' as note;
