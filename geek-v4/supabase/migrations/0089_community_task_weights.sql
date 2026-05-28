-- ============================================================
-- 0089_community_task_weights.sql — Community 別 ranking weight override (MergeRec 近似)
-- ============================================================
-- 目的:
--   "MergeRec" の核心 = 人気 community のシグナル知識を、データが薄い不調 community
--   へ転移して底上げする。本 migration では SQL レイヤでその近似として:
--     - base lambda (0088 の active profile) からの delta / boost factor を
--       community 単位で持つ "override" table を導入する。
--     - 直近 30 日の post が少ない community を抽出する view を提供。
--     - admin が view の対象に対し recency / viewed_boost を一括底上げできる
--       RPC を提供する (= MergeRec の "弱 community に強 community の挙動を移植").
--
-- 前提 (0088 で確立されている想定):
--   - public.ranking_weight_profiles (id uuid pk, ..., active boolean)
--   - public.ranking_weights (profile_id uuid fk, signal_key text, lambda numeric,
--       primary key (profile_id, signal_key))
--   - public.communities (0017 で確認) — id uuid, name text, member_count int,
--     post_count int, last_post_at timestamptz
--   - public.community_posts (0017) — community_id uuid, created_at timestamptz
--
-- 設計判断:
--   * すべて create [or replace] / drop ... if exists で冪等。
--   * 既存 0088 の RPC を信頼せず、本 migration の RPC は active profile の
--     ranking_weights を直接 join して "再計算" する (依存縮減)。
--   * SECURITY DEFINER は search_path = pg_catalog, public で lockdown
--     (0085 / 0087 と同じスタイル — search_path injection 対策)。
--   * RLS: community_weight_overrides は誰でも read (透明性確保) / admin のみ write。
--   * final_lambda = (base_lambda + lambda_delta) * boost_factor で合成。
--     boost_factor の default は 1.0 で「delta だけ効かせる」が標準運用。
--   * 0088 が未適用な環境でも本 migration が落ちないよう、依存 table の
--     存在を to_regclass で先に検査し、不在なら NOTICE を出して skip する。
--   * communities table は 0017 で確認済 (member_count / post_count あり)。
--
-- MergeRec の「底上げ」運用:
--   1. auto_boost_low_traffic_communities() を admin が cron / 手動で呼ぶ
--   2. 直近 30 日 post < 20 の community に対し recency / viewed_boost に
--      +0.3 の delta を upsert (= 新着 + 既読排除を強める = 露出機会を増やす)
--   3. ユーザー側 get_community_ranking_weights(community_id) で最終 lambda
--      が取れるようになり、フィード / 検索 ranking で per-community に
--      適用できる
-- ============================================================

-- ============================================================
-- 0. 前提 table 存在チェック (0088 が未適用なら NOTICE して exit)
-- ============================================================
do $$
begin
  if to_regclass('public.ranking_weight_profiles') is null
     or to_regclass('public.ranking_weights') is null then
    raise notice '0089 skipped: 0088_ranking_weights は未適用です (ranking_weight_profiles / ranking_weights が無い)';
    return;
  end if;
  if to_regclass('public.communities') is null then
    raise notice '0089 skipped: communities table が存在しません (0017 が未適用)';
    return;
  end if;
end$$;

-- ============================================================
-- 1. community_weight_overrides — table
-- ============================================================
-- community ごとに base 重みからの差分 (lambda_delta) と乗数 (boost_factor) を
-- 保持する。両方適用される: final = (base + delta) * factor。
-- 例:
--   tech 板で text_relevance を強める  → lambda_delta = +0.4, boost_factor = 1.0
--   地域板で recency を弱める          → lambda_delta = -0.2, boost_factor = 1.0
--   不調 community を底上げ            → lambda_delta = +0.3, boost_factor = 1.0
-- ============================================================
create table if not exists public.community_weight_overrides (
  community_id  uuid    not null references public.communities(id) on delete cascade,
  signal_key    text    not null check (length(signal_key) between 1 and 60),
  lambda_delta  numeric not null default 0,
  boost_factor  numeric not null default 1.0 check (boost_factor >= 0),
  rationale     text    default '' check (length(coalesce(rationale, '')) <= 500),
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (community_id, signal_key)
);

create index if not exists community_weight_overrides_signal_idx
  on public.community_weight_overrides(signal_key)
  where active;

create index if not exists community_weight_overrides_active_idx
  on public.community_weight_overrides(community_id)
  where active;

comment on table public.community_weight_overrides is
  'community 別の ranking 重み差分: final_lambda = (base_lambda + lambda_delta) * boost_factor';

-- ============================================================
-- 2. RLS
-- ============================================================
-- 誰でも read 可 (透明性 / クライアント側で why-this-result 表示用)、
-- 書き込みは admin のみ。
-- ============================================================
alter table public.community_weight_overrides enable row level security;

drop policy if exists "community_weight_overrides_select" on public.community_weight_overrides;
create policy "community_weight_overrides_select"
  on public.community_weight_overrides
  for select
  using (true);

drop policy if exists "community_weight_overrides_admin_write" on public.community_weight_overrides;
create policy "community_weight_overrides_admin_write"
  on public.community_weight_overrides
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.community_weight_overrides to anon, authenticated;

-- ============================================================
-- 3. low_traffic_communities — view
-- ============================================================
-- 直近 30 日 で post_count < 20 の community を抽出。
-- - id, name, post_count (直近 30 日), days_since_last_post を返す。
-- - community_posts.created_at を集計 (post_count は cache カラムを
--   そのまま使うと「直近 30 日」が反映されないため再集計)。
-- - 完全に空の community も拾う (left join + coalesce)。
-- - admin が auto_boost_low_traffic_communities() を呼ぶ前に対象を
--   目視確認できるよう view を残す。
-- ============================================================
drop view if exists public.low_traffic_communities cascade;
create or replace view public.low_traffic_communities as
select
  c.id,
  c.name,
  coalesce(
    (
      select count(*)::int
      from public.community_posts cp
      where cp.community_id = c.id
        and cp.created_at > now() - interval '30 days'
    ),
    0
  ) as post_count,
  case
    when c.last_post_at is null then null
    else extract(day from (now() - c.last_post_at))::int
  end as days_since_last_post
from public.communities c
where coalesce(
  (
    select count(*)::int
    from public.community_posts cp
    where cp.community_id = c.id
      and cp.created_at > now() - interval '30 days'
  ),
  0
) < 20;

comment on view public.low_traffic_communities is
  '直近 30 日の post 数が 20 未満の不調 community 一覧 (MergeRec 底上げ対象)';

-- 注: view は communities の RLS を invoker 権限で評価するため、
-- 一般ユーザーには open / 加入済の community しか見えない。
-- admin は profiles_admin_all (0027) / communities 側 admin policy で全件見える。
grant select on public.low_traffic_communities to anon, authenticated;

-- ============================================================
-- 4. RPC: get_community_ranking_weights(p_community_id uuid)
-- ============================================================
-- ある community に対する「最終 lambda」一覧を返す。
-- - base = ranking_weight_profiles.active = true な profile の
--   ranking_weights を全件 (signal_key, lambda) として読み出す
-- - p_community_id が null なら base のみ (override 無し)
-- - override (active=true) があれば final = (base + delta) * factor
-- - override にしか無い signal_key (base 未定義) は base=0 として扱い、
--   結果として final = (0 + delta) * factor で返す (新規シグナル投入余地)
--
-- 0088 の RPC は呼ばない (= "0088 の RPC を信頼せず再計算" 要件)。
-- SECURITY DEFINER + search_path lockdown。
-- ============================================================
drop function if exists public.get_community_ranking_weights(uuid);
create or replace function public.get_community_ranking_weights(p_community_id uuid default null)
returns table (
  signal_key text,
  lambda     numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile_id uuid;
begin
  -- active profile を 1 件選ぶ (複数 active があれば最新を採用)
  select rp.id into v_profile_id
  from public.ranking_weight_profiles rp
  where rp.active = true
  order by rp.id desc
  limit 1;

  if v_profile_id is null then
    -- profile が一つも active で無ければ空集合
    return;
  end if;

  if p_community_id is null then
    -- override なしの base 重みのみ
    return query
    select rw.signal_key::text, rw.lambda::numeric
    from public.ranking_weights rw
    where rw.profile_id = v_profile_id;
    return;
  end if;

  -- base ∪ override の full outer join 相当を実現:
  -- base + override 両方ある signal_key は (base + delta) * factor
  -- base のみある signal_key は base * 1.0 (active override 無し)
  -- override のみある signal_key は (0 + delta) * factor
  return query
  with base as (
    select rw.signal_key::text as signal_key, rw.lambda::numeric as lambda
    from public.ranking_weights rw
    where rw.profile_id = v_profile_id
  ),
  ov as (
    select
      cwo.signal_key::text   as signal_key,
      cwo.lambda_delta::numeric as lambda_delta,
      cwo.boost_factor::numeric as boost_factor
    from public.community_weight_overrides cwo
    where cwo.community_id = p_community_id
      and cwo.active = true
  ),
  merged as (
    select
      coalesce(b.signal_key, ov.signal_key) as signal_key,
      ((coalesce(b.lambda, 0) + coalesce(ov.lambda_delta, 0)) * coalesce(ov.boost_factor, 1.0))::numeric as lambda
    from base b
    full outer join ov on ov.signal_key = b.signal_key
  )
  select m.signal_key, m.lambda from merged m;
end;
$$;

revoke all on function public.get_community_ranking_weights(uuid) from public;
grant execute on function public.get_community_ranking_weights(uuid) to anon, authenticated;

comment on function public.get_community_ranking_weights(uuid) is
  'community_id に対する最終 ranking 重み (base + override) を返す。null なら base のみ';

-- ============================================================
-- 5. RPC: auto_boost_low_traffic_communities() — admin only
-- ============================================================
-- low_traffic_communities view の各 community に対し、
--   - recency      に +0.3 の delta
--   - viewed_boost に +0.3 の delta
-- を upsert する (boost_factor は 1.0 維持)。
-- MergeRec の核: 「不調 community を、人気 community で学習済の重みパターンで
-- 底上げする」を SQL 近似で実現する一括処理。
-- admin check: is_admin() = false なら exception。
-- 戻り値: 対象になった community 数。
-- ============================================================
drop function if exists public.auto_boost_low_traffic_communities();
create or replace function public.auto_boost_low_traffic_communities()
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
  r record;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  for r in
    select ltc.id as community_id from public.low_traffic_communities ltc
  loop
    -- recency boost
    insert into public.community_weight_overrides (community_id, signal_key, lambda_delta, boost_factor, rationale, active)
    values (r.community_id, 'recency', 0.3, 1.0, 'auto: low_traffic_community boost (MergeRec)', true)
    on conflict (community_id, signal_key) do update
      set lambda_delta = excluded.lambda_delta,
          boost_factor = excluded.boost_factor,
          rationale    = excluded.rationale,
          active       = true,
          updated_at   = now();

    -- viewed_boost (= 既読排除を強める = 新着の露出機会増)
    insert into public.community_weight_overrides (community_id, signal_key, lambda_delta, boost_factor, rationale, active)
    values (r.community_id, 'viewed_boost', 0.3, 1.0, 'auto: low_traffic_community boost (MergeRec)', true)
    on conflict (community_id, signal_key) do update
      set lambda_delta = excluded.lambda_delta,
          boost_factor = excluded.boost_factor,
          rationale    = excluded.rationale,
          active       = true,
          updated_at   = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.auto_boost_low_traffic_communities() from public;
grant execute on function public.auto_boost_low_traffic_communities() to authenticated;

comment on function public.auto_boost_low_traffic_communities() is
  'admin: low_traffic_communities の各 community に recency / viewed_boost +0.3 を upsert';

-- ============================================================
-- 6. seed: 仮の community が無いなら skip
-- ============================================================
-- 実 community が存在するときだけ seed を入れる。
-- 既存 community を 1 件選び、もし「tech」「テック」「開発」を含む名前
-- なら text_relevance を強化する override を入れる (= 「tech 板は本文一致重視」).
-- 衝突したら active を true に戻すだけ (rationale 上書き)。
-- ============================================================
insert into public.community_weight_overrides (community_id, signal_key, lambda_delta, boost_factor, rationale, active)
select c.id, 'text_relevance', 0.4, 1.0, 'seed: tech 系板は本文一致を強化', true
from public.communities c
where (lower(c.name) like '%tech%'
       or c.name like '%テック%'
       or c.name like '%開発%')
  and exists (select 1 from public.communities limit 1)
on conflict (community_id, signal_key) do update
  set lambda_delta = excluded.lambda_delta,
      boost_factor = excluded.boost_factor,
      rationale    = excluded.rationale,
      active       = true,
      updated_at   = now();

-- 地域板 (「地域」「ローカル」「local」を含む名前) は recency を弱める
insert into public.community_weight_overrides (community_id, signal_key, lambda_delta, boost_factor, rationale, active)
select c.id, 'recency', -0.2, 1.0, 'seed: 地域板は recency を弱め (時系列より定着情報)', true
from public.communities c
where (lower(c.name) like '%local%'
       or c.name like '%地域%'
       or c.name like '%ローカル%')
  and exists (select 1 from public.communities limit 1)
on conflict (community_id, signal_key) do update
  set lambda_delta = excluded.lambda_delta,
      boost_factor = excluded.boost_factor,
      rationale    = excluded.rationale,
      active       = true,
      updated_at   = now();

-- ============================================================
-- 7. ANALYZE
-- ============================================================
analyze public.community_weight_overrides;

-- ============================================================
-- 完了通知
-- ============================================================
select '0089_community_task_weights 完了 — community_weight_overrides table + low_traffic_communities view + get_community_ranking_weights / auto_boost_low_traffic_communities RPCs (MergeRec 近似)' as note;
