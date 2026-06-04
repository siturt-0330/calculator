-- ============================================================
-- 0119_traffic_source_and_ads.sql
-- ============================================================
-- 広告の流入元別配信の前提となる 2 つを用意する:
--   (a) user_acquisition — ユーザーの流入元(traffic source / utm)。本人+admin限定。
--   (b) ads の抽象化列 — source_type / priority / target_traffic_sources / network_code。
--
-- 設計根拠: docs/ADMIN_CONSOLE.md §5.5 / §5.6 / §6.5
--
-- ★ 設計判断の変更(ADMIN_CONSOLE.md §8.11 に追記):
--   当初案は profiles に traffic_source 列を足す予定だったが、既存 profiles_read は
--   `using(true)`(全員読取可)で **列単位のプライバシー保護ができない**。
--   そこで流入元は別テーブル user_acquisition に分離し、RLS で本人+admin限定にする。
--   profiles_read を変えずに済む(既存破壊なし)、かつ機微情報を確実に保護できる。
--   → 指示書§6「対立時は安全性・プライバシーを優先」に沿う判断。
--
-- 冪等: create table if not exists / add column if not exists / drop policy if exists。
-- 本番は SQL editor で手動適用前提。未適用でも client は流入元無し(=全員配信)に degrade。
-- ============================================================

-- ------------------------------------------------------------
-- (a) user_acquisition — 流入元 (本人+admin限定)
-- ------------------------------------------------------------
-- signup 時に 1 回だけ記録する。以降は不変(改ざん防止のため UPDATE policy を作らない)。
create table if not exists public.user_acquisition (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  traffic_source text check (traffic_source in
                   ('google_ads','app_store','play_store','organic','referral','other')),
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  acquired_at   timestamptz not null default now()
);

create index if not exists user_acquisition_source_idx
  on public.user_acquisition (traffic_source);

alter table public.user_acquisition enable row level security;

-- 本人だけが自分の流入元を INSERT 可 (signup 直後の 1 回)
drop policy if exists "ua_self_insert" on public.user_acquisition;
create policy "ua_self_insert" on public.user_acquisition for insert
  with check (user_id = auth.uid());

-- 本人 or admin だけが SELECT 可 (一般公開しない = 機微情報)
drop policy if exists "ua_self_or_admin_select" on public.user_acquisition;
create policy "ua_self_or_admin_select" on public.user_acquisition for select
  using (user_id = auth.uid() or public.is_admin());

-- UPDATE / DELETE policy は作らない:
--   流入元は記録時固定 (改ざん防止)。アカウント削除時は FK cascade で消える。

-- ------------------------------------------------------------
-- (b) ads 抽象化列 — 広告ソース / 優先度 / 流入元ターゲティング
-- ------------------------------------------------------------
-- 外部調査 §6.5: Google Ad Manager の priority ティアを縮小移植。
--   sponsorship(直販/保証) > standard > network(外部) > house(自社/フォールバック)。
--   priority は数値で小さいほど優先 (GAM: Sponsorship=4 .. House=16)。
alter table public.ads
  add column if not exists source_type text not null default 'house'
    check (source_type in ('house','network','sponsorship'));

alter table public.ads
  add column if not exists priority int not null default 16;  -- House=16 相当 (最低優先=フォールバック)

alter table public.ads
  add column if not exists target_traffic_sources text[] not null default '{}';  -- 空=全流入元

alter table public.ads
  add column if not exists network_code text;  -- 外部ネットワーク識別 (admob 等。将来拡張)

-- 流入元ターゲティング検索用 (GIN)
create index if not exists ads_target_traffic_sources_idx
  on public.ads using gin (target_traffic_sources);
create index if not exists ads_priority_idx
  on public.ads (priority);

-- ------------------------------------------------------------
-- 完了マーカー
-- ------------------------------------------------------------
select '0119_traffic_source_and_ads 完了: user_acquisition(本人/admin限定) + ads抽象化列(source_type/priority/target_traffic_sources/network_code)' as result;
