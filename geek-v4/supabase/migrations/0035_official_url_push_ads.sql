-- ============================================================
-- 0035: URL verification + push subscriptions + tag-targeted ads
-- ============================================================
-- 4つの後回し機能の DB 基盤
-- (1) 公式申請の URL 所有確認
-- (2) Push 通知購読 (Web Push 用)
-- (3) 公式投稿時の通知 enqueue
-- (4) タグターゲティング広告
-- ============================================================

-- ============================================================
-- (1) 公式申請の URL 所有確認
-- ============================================================
alter table public.official_community_applications
  add column if not exists verification_token text,
  add column if not exists verification_status text default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'failed')),
  add column if not exists verification_attempted_at timestamptz,
  add column if not exists verification_method text
    check (verification_method is null or verification_method in ('well-known', 'meta-tag', 'dns-txt'));

-- 新規申請には自動で verification token を生成 (16 文字の英数記号)
create or replace function public.gen_verification_token()
returns trigger
language plpgsql
as $$
begin
  if new.verification_token is null then
    new.verification_token := 'geek-verify-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  end if;
  return new;
end;
$$;

drop trigger if exists official_apps_gen_token on public.official_community_applications;
create trigger official_apps_gen_token
  before insert on public.official_community_applications
  for each row execute procedure public.gen_verification_token();

-- 既存の申請にも token を埋める (idempotent)
update public.official_community_applications
   set verification_token = 'geek-verify-' || substr(md5(id::text), 1, 16)
 where verification_token is null;

-- admin 用 view を再作成 (verification 関連カラムを追加)
drop view if exists public.admin_pending_official_apps_v;
create or replace view public.admin_pending_official_apps_v as
select
  app.id,
  app.community_id,
  c.name as community_name,
  c.icon_emoji,
  c.icon_color,
  c.member_count,
  c.post_count,
  app.applicant_user_id,
  app.applicant_real_name,
  app.applicant_organization,
  app.applicant_email,
  app.applicant_url,
  app.purpose,
  app.requested_features,
  app.verification_token,
  app.verification_status,
  app.verification_method,
  app.verification_attempted_at,
  app.created_at
from public.official_community_applications app
join public.communities c on c.id = app.community_id
where app.status = 'pending'
order by app.created_at asc;

grant select on public.admin_pending_official_apps_v to authenticated;

-- ============================================================
-- (2) Push 通知購読
-- ============================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,           -- Web Push 鍵
  auth_key text not null,         -- Web Push auth secret
  user_agent text default '',
  platform text not null default 'web' check (platform in ('web', 'ios', 'android')),
  created_at timestamptz not null default now(),
  -- 同じ endpoint は user_id ごとに 1 つだけ (デバイス重複防止)
  unique (user_id, endpoint)
);

create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subs_own" on public.push_subscriptions;
create policy "push_subs_own" on public.push_subscriptions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- (3) 公式投稿時の通知 enqueue
-- ============================================================
-- 公式コミュニティの管理者が community_posts に INSERT したら、
-- そのコミュニティの全メンバーに「お知らせ」通知を作成する。
-- 既存の notifications テーブル (in-app bell) に enqueue。
-- Web Push 配信は edge function (別途実装) からこのキューを読む。

create or replace function public.notify_on_official_community_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community record;
  v_member uuid;
begin
  select id, name, is_official, official_admin_user_id
    into v_community
    from public.communities
   where id = new.community_id;

  -- 公式コミュニティで、投稿者が official admin の場合のみ
  if v_community.is_official is true
     and new.author_id = v_community.official_admin_user_id then
    -- 全メンバーに通知 (投稿者本人は除外)
    insert into public.notifications (user_id, type, tag_name, message)
    select m.user_id,
           'official_post',
           v_community.name,
           '公式コミュニティ「' || v_community.name || '」に新しいお知らせがあります'
      from public.community_members m
     where m.community_id = new.community_id
       and m.user_id <> new.author_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_on_official_community_post on public.community_posts;
create trigger notify_on_official_community_post
  after insert on public.community_posts
  for each row execute procedure public.notify_on_official_community_post();

-- ============================================================
-- (4) タグターゲティング広告
-- ============================================================
-- プライバシー保護のため個人追跡はしない。タグだけで配信する。
-- 既存の Tag Affinity (useSearchSignalsStore.tagFreq) を使い、
-- ユーザーが興味を持っているタグと広告のターゲットタグの cosine 類似度で
-- マッチングする (フィード組み立て時に行う)。
-- ============================================================

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  advertiser_name text not null check (length(advertiser_name) between 1 and 80),
  -- 表示要素
  headline text not null check (length(headline) between 1 and 80),
  body text not null check (length(body) between 1 and 280),
  image_url text check (image_url is null or image_url ~ '^https?://'),
  click_url text not null check (click_url ~ '^https?://'),
  cta_label text not null default '詳しく見る' check (length(cta_label) between 1 and 20),
  -- ターゲティング
  target_tags text[] not null default '{}'::text[],   -- 興味タグ
  exclude_tags text[] not null default '{}'::text[],  -- 除外タグ (例: 競合の話題)
  -- 配信制御
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  daily_budget_yen integer default 0 check (daily_budget_yen >= 0),
  -- メタ
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ads_active_idx on public.ads(status, starts_at, ends_at)
  where status = 'active';
create index if not exists ads_target_tags_idx on public.ads using gin(target_tags);

alter table public.ads enable row level security;

-- 全 authed user が active な広告を見られる (フィード組み込み用)
drop policy if exists "ads_select_active" on public.ads;
create policy "ads_select_active" on public.ads for select using (
  status = 'active'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

-- admin だけが書き込める
drop policy if exists "ads_admin_write" on public.ads;
create policy "ads_admin_write" on public.ads for all
  using (public.is_admin())
  with check (public.is_admin());

-- インプレッション / クリック ログ (匿名化された集計用)
create table if not exists public.ad_events (
  id bigserial primary key,
  ad_id uuid not null references public.ads(id) on delete cascade,
  event_type text not null check (event_type in ('impression', 'click', 'dismiss')),
  -- user_id は集計用にだけ保存 (1人が何回見たか) — 個人追跡には使わない
  user_id uuid references auth.users(id) on delete set null,
  feed_position integer,    -- フィード何番目に出たか (CTR 分析用)
  matched_tags text[] default '{}'::text[],   -- 配信時にマッチしたタグ
  created_at timestamptz not null default now()
);

create index if not exists ad_events_ad_idx on public.ad_events(ad_id, created_at desc);
create index if not exists ad_events_user_idx on public.ad_events(user_id, created_at desc);

alter table public.ad_events enable row level security;

drop policy if exists "ad_events_insert_own" on public.ad_events;
create policy "ad_events_insert_own" on public.ad_events for insert
  with check (user_id = auth.uid() or user_id is null);

drop policy if exists "ad_events_admin_select" on public.ad_events;
create policy "ad_events_admin_select" on public.ad_events for select
  using (public.is_admin());

-- フィード組み立て用 RPC: ユーザーの興味タグから、ターゲティング条件に合う ads を返す
create or replace function public.fetch_targeted_ads(
  p_interest_tags text[],
  p_exclude_tags text[] default '{}'::text[],
  p_limit int default 3
)
returns table (
  id uuid,
  advertiser_name text,
  headline text,
  body text,
  image_url text,
  click_url text,
  cta_label text,
  target_tags text[],
  match_score real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.advertiser_name,
    a.headline,
    a.body,
    a.image_url,
    a.click_url,
    a.cta_label,
    a.target_tags,
    -- マッチスコア: ターゲットタグと興味タグの交差数
    -- (PostgreSQL の text[] には & 演算子が無いので、unnest + INTERSECT で計算)
    (
      select count(*)::real
        from unnest(a.target_tags) as t
       where t = any(p_interest_tags)
    )
      + (case when a.target_tags = '{}'::text[] then 0.1 else 0 end) -- 全配信は薄く
    as match_score
  from public.ads a
  where a.status = 'active'
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at is null or a.ends_at > now())
    -- 除外タグ: 広告側 exclude にユーザー興味タグが入ってればスキップ
    and not (a.exclude_tags && p_interest_tags)
    -- ユーザーの除外タグ (ブロック等) もスキップ
    and not (a.target_tags && p_exclude_tags)
    -- ターゲット指定があるなら、ユーザー興味と交差していることを要求
    and (a.target_tags = '{}'::text[] or a.target_tags && p_interest_tags)
  order by match_score desc, random()
  limit p_limit;
$$;

grant execute on function public.fetch_targeted_ads(text[], text[], int) to authenticated;
