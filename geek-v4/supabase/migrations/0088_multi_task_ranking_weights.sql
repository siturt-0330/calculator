-- ============================================================
-- 0088_multi_task_ranking_weights.sql
--   検索 ranking の「タスク係数 lambda」を運用テーブル化
-- ============================================================
-- 目的:
--   モデルマージにおける AdaMerging の「タスク係数 lambda」を Postgres
--   table で管理し、A/B 群ごとに異なる profile (= signal_key → lambda /
--   threshold の組) を当てて運用次元で近似する。
--
--   * search_posts_v2 / v3 (0085 / 0086) が出している signal
--     (text_relevance / recency / eeat / usability / viewed_boost /
--      history_boost / safety_negation / clickbait_negation / freshness /
--      diversity_penalty) に対する係数を 1 テーブルで一覧可能に。
--   * profile を複数持ち、ab_group → profile の写像で A/B 群ごとに
--     異なる ranking を配信できる。
--   * lambda が負の signal は減点項 (TIES の negation merging に相当)。
--   * threshold 以下の signal magnitude は drop (TIES の sparsification
--     相当)。
--   * is_active = true な profile は常に 1 つだけ (trigger で enforce)。
--
-- このマイグレーションで追加するもの:
--   1. ranking_weight_profiles    — profile 定義
--   2. ranking_weights            — 各 profile の (signal_key, lambda, threshold)
--   3. user_ab_assignment         — user → ab_group の割当
--   4. ab_group_profile_map       — ab_group → profile の写像
--   5. get_active_ranking_weights()                       — 現 user の active 係数を返す RPC
--   6. admin_set_ranking_weight(profile, signal, λ, θ)    — admin 専用 upsert RPC
--   7. seed: default profile + 10 signal の初期 lambda
--
-- 既存スキーマ前提 (確認済、編集禁止):
--   public.profiles(id)             — 0001
--   public.profiles.is_admin        — 0012 / 0027
--   public.current_user_is_admin()  — 0020 (SQL stable security definer)
--   auth.users(id)                  — Supabase Auth
--
-- 設計判断:
--   * すべて create [if not exists] / on conflict ... do update で冪等。
--   * SECURITY DEFINER の関数は search_path = pg_catalog, public で lockdown
--     (0083 / 0085 / 0086 と同じスタイル)。
--   * RLS: 設定 table は誰でも select 可、書き込みは admin (current_user_is_admin())
--     のみ。is_active な profile に関しては public 可視で良い (= 隠す情報ではない、
--     transparency 重視)。
--   * is_active = true の row が常に 1 つだけ — before insert/update trigger で
--     enforce する。割と素朴に「他を false にしてから自分を true にする」方式。
-- ============================================================

-- ============================================================
-- 1. ranking_weight_profiles — profile 定義
-- ============================================================
create table if not exists public.ranking_weight_profiles (
  id           uuid primary key default gen_random_uuid(),
  profile_name text not null unique check (length(profile_name) between 1 and 80),
  description  text,
  is_active    boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists ix_ranking_weight_profiles_active
  on public.ranking_weight_profiles(is_active)
  where is_active = true;

comment on table public.ranking_weight_profiles is
  '検索 ranking のタスク係数 (lambda) を束ねる profile。AdaMerging 風の運用切り替え用。is_active=true は常に 1 つだけ (trigger で enforce)';

alter table public.ranking_weight_profiles enable row level security;

-- read: 誰でも OK (transparency)
drop policy if exists rwp_read_all on public.ranking_weight_profiles;
create policy rwp_read_all on public.ranking_weight_profiles
  for select
  using (true);

-- write: admin のみ
drop policy if exists rwp_admin_write on public.ranking_weight_profiles;
create policy rwp_admin_write on public.ranking_weight_profiles
  for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ============================================================
-- 1-b. is_active = true は常に 1 つだけ trigger
-- ============================================================
-- before insert/update で NEW.is_active=true なら他の row を false にする。
-- 「最後に立てた人が勝つ」semantics。
-- ============================================================
create or replace function public.ranking_weight_profiles_enforce_single_active()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if NEW.is_active is true then
    update public.ranking_weight_profiles
       set is_active = false
     where is_active = true
       and id <> NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_rwp_single_active on public.ranking_weight_profiles;
create trigger trg_rwp_single_active
  before insert or update of is_active on public.ranking_weight_profiles
  for each row
  when (NEW.is_active is true)
  execute function public.ranking_weight_profiles_enforce_single_active();

-- ============================================================
-- 2. ranking_weights — 各 profile の係数本体
-- ============================================================
create table if not exists public.ranking_weights (
  profile_id uuid not null references public.ranking_weight_profiles(id) on delete cascade,
  signal_key text not null check (length(signal_key) between 1 and 64),
  lambda     numeric not null default 1.0,
  active     boolean not null default true,
  threshold  numeric not null default 0,
  notes      text,
  primary key (profile_id, signal_key)
);

create index if not exists ix_ranking_weights_profile_active
  on public.ranking_weights(profile_id)
  where active = true;

comment on table public.ranking_weights is
  'profile ごとの (signal_key, lambda, threshold) の組。lambda は負も可 (負け項)、threshold は TIES-like sparsification の閾値';

alter table public.ranking_weights enable row level security;

-- read: 誰でも OK
drop policy if exists rw_read_all on public.ranking_weights;
create policy rw_read_all on public.ranking_weights
  for select
  using (true);

-- write: admin のみ
drop policy if exists rw_admin_write on public.ranking_weights;
create policy rw_admin_write on public.ranking_weights
  for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ============================================================
-- 3. user_ab_assignment — user → ab_group の割当
-- ============================================================
create table if not exists public.user_ab_assignment (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  ab_group    text not null check (length(ab_group) between 1 and 64),
  assigned_at timestamptz not null default now()
);

create index if not exists ix_user_ab_assignment_group
  on public.user_ab_assignment(ab_group);

comment on table public.user_ab_assignment is
  'user → ab_group の割当。割当の無い user は default 扱い';

alter table public.user_ab_assignment enable row level security;

-- read: 自分の割当だけは見える / admin は全部見える
drop policy if exists uaa_read_self on public.user_ab_assignment;
create policy uaa_read_self on public.user_ab_assignment
  for select
  using (auth.uid() = user_id or public.current_user_is_admin());

-- write: admin のみ (実装は server / RPC 経由を想定 — 直接 update 禁止)
drop policy if exists uaa_admin_write on public.user_ab_assignment;
create policy uaa_admin_write on public.user_ab_assignment
  for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ============================================================
-- 4. ab_group_profile_map — ab_group → profile の写像
-- ============================================================
create table if not exists public.ab_group_profile_map (
  ab_group   text primary key check (length(ab_group) between 1 and 64),
  profile_id uuid not null references public.ranking_weight_profiles(id) on delete cascade
);

comment on table public.ab_group_profile_map is
  'ab_group → ranking_weight_profile の写像。割当外の ab_group は default profile にフォールバック';

alter table public.ab_group_profile_map enable row level security;

-- read: 誰でも OK
drop policy if exists agpm_read_all on public.ab_group_profile_map;
create policy agpm_read_all on public.ab_group_profile_map
  for select
  using (true);

-- write: admin のみ
drop policy if exists agpm_admin_write on public.ab_group_profile_map;
create policy agpm_admin_write on public.ab_group_profile_map
  for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ============================================================
-- 5. get_active_ranking_weights() — RPC
-- ============================================================
-- 戻り値: (signal_key, lambda, threshold) のテーブル
-- 解決順:
--   a) auth.uid() の ab_group を user_ab_assignment から
--   b) ab_group の profile を ab_group_profile_map から
--   c) login していない or 未割当 or map に該当無し → is_active=true profile
--   d) c も無い場合 → profile_name='default' をフォールバック
--   e) active=true な signal だけ返す
-- ============================================================
drop function if exists public.get_active_ranking_weights();
create or replace function public.get_active_ranking_weights()
returns table (
  signal_key text,
  lambda     numeric,
  threshold  numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid        uuid := auth.uid();
  v_ab_group   text;
  v_profile_id uuid;
begin
  -- (a) ab_group
  if v_uid is not null then
    select ab_group
      into v_ab_group
      from public.user_ab_assignment
     where user_id = v_uid;
  end if;

  -- (b) ab_group → profile
  if v_ab_group is not null then
    select profile_id
      into v_profile_id
      from public.ab_group_profile_map
     where ab_group = v_ab_group;
  end if;

  -- (c) fallback: is_active=true profile
  if v_profile_id is null then
    select id
      into v_profile_id
      from public.ranking_weight_profiles
     where is_active = true
     limit 1;
  end if;

  -- (d) fallback of fallback: profile_name='default'
  if v_profile_id is null then
    select id
      into v_profile_id
      from public.ranking_weight_profiles
     where profile_name = 'default'
     limit 1;
  end if;

  if v_profile_id is null then
    return;
  end if;

  -- (e) active signal だけ返す
  return query
  select rw.signal_key, rw.lambda, rw.threshold
    from public.ranking_weights rw
   where rw.profile_id = v_profile_id
     and rw.active = true;
end;
$$;

revoke all on function public.get_active_ranking_weights() from public;
grant execute on function public.get_active_ranking_weights() to anon, authenticated;

-- ============================================================
-- 6. admin_set_ranking_weight(profile_name, signal_key, lambda, threshold)
-- ============================================================
-- admin (current_user_is_admin()) のみ実行可能な upsert。
-- profile_name が存在しなければエラー (= 先に admin が profile を作る前提)。
-- ============================================================
drop function if exists public.admin_set_ranking_weight(text, text, numeric, numeric);
create or replace function public.admin_set_ranking_weight(
  p_profile_name text,
  p_signal_key   text,
  p_lambda       numeric,
  p_threshold    numeric default 0
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile_id uuid;
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_set_ranking_weight: forbidden (admin only)'
      using errcode = '42501';
  end if;

  if p_profile_name is null or length(trim(p_profile_name)) = 0 then
    raise exception 'admin_set_ranking_weight: profile_name must be non-empty'
      using errcode = '22023';
  end if;
  if p_signal_key is null or length(trim(p_signal_key)) = 0 then
    raise exception 'admin_set_ranking_weight: signal_key must be non-empty'
      using errcode = '22023';
  end if;
  if p_lambda is null then
    raise exception 'admin_set_ranking_weight: lambda must be non-null'
      using errcode = '22023';
  end if;

  select id
    into v_profile_id
    from public.ranking_weight_profiles
   where profile_name = p_profile_name;

  if v_profile_id is null then
    raise exception 'admin_set_ranking_weight: profile_name=% not found', p_profile_name
      using errcode = 'P0002';
  end if;

  insert into public.ranking_weights(profile_id, signal_key, lambda, threshold, active)
  values (v_profile_id, p_signal_key, p_lambda, coalesce(p_threshold, 0), true)
  on conflict (profile_id, signal_key) do update
     set lambda    = excluded.lambda,
         threshold = excluded.threshold,
         active    = true;
end;
$$;

revoke all on function public.admin_set_ranking_weight(text, text, numeric, numeric) from public;
grant execute on function public.admin_set_ranking_weight(text, text, numeric, numeric) to authenticated;

-- ============================================================
-- 7. seed — default profile + 初期 lambda
-- ============================================================
-- 初期値方針:
--   text_relevance     1.0   — 主軸
--   recency            1.0   — 新しさ
--   eeat               1.0   — 投稿者の信用 / 評価
--   usability          0.3   — 0087 で導入された新 signal、最初は控えめ
--   viewed_boost       0.2   — personalize: 既読を少し優先
--   history_boost      0.1   — personalize: 過去検索類似を少し優先
--   safety_negation   -0.5   — 安全性違反は減点
--   clickbait_negation -0.3  — クリックベイト傾向は減点
--   freshness          0.2   — 24h 内の engagement velocity を少し加点
--   diversity_penalty -0.4   — 同 author 連続を減点
-- ============================================================
insert into public.ranking_weight_profiles(profile_name, description, is_active)
values (
  'default',
  '初期 default profile。0085-0087 で導入された 10 signal の baseline 重み',
  true
)
on conflict (profile_name) do update
   set description = excluded.description,
       is_active   = true;

-- default profile に 10 signal を upsert
with d as (
  select id from public.ranking_weight_profiles where profile_name = 'default'
)
insert into public.ranking_weights(profile_id, signal_key, lambda, threshold, active, notes)
select d.id, s.signal_key, s.lambda, 0::numeric, true, s.notes
from d, (values
  ('text_relevance',     1.0::numeric, '本文 / タイトルとクエリの一致度 (search_posts_v2)'),
  ('recency',            1.0::numeric, '新しさ (search_posts_v2)'),
  ('eeat',               1.0::numeric, '投稿者の trust + likes ベースの品質 (search_posts_v2)'),
  ('usability',          0.3::numeric, 'Page Experience score (0087)'),
  ('viewed_boost',       0.2::numeric, '既読 post への小ブースト (search_posts_v3)'),
  ('history_boost',      0.1::numeric, '過去検索類似ヒットへの小ブースト (search_posts_v3)'),
  ('safety_negation',   -0.5::numeric, '安全性違反シグナル — 大きく減点'),
  ('clickbait_negation',-0.3::numeric, 'クリックベイト傾向 — 中程度の減点'),
  ('freshness',          0.2::numeric, '24h engagement velocity (0087)'),
  ('diversity_penalty', -0.4::numeric, '同一 author の連続表示への減点 (0086 diversify)')
) as s(signal_key, lambda, notes)
on conflict (profile_id, signal_key) do update
   set lambda    = excluded.lambda,
       threshold = excluded.threshold,
       active    = excluded.active,
       notes     = excluded.notes;

-- ============================================================
-- 8. ANALYZE
-- ============================================================
analyze public.ranking_weight_profiles;
analyze public.ranking_weights;
analyze public.user_ab_assignment;
analyze public.ab_group_profile_map;

-- ============================================================
-- 9. 完了通知
-- ============================================================
select '0088_multi_task_ranking_weights 完了 — ranking_weight_profiles / ranking_weights / user_ab_assignment / ab_group_profile_map + get_active_ranking_weights / admin_set_ranking_weight + default profile (10 signals seeded)' as note;
