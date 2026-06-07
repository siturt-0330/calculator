-- ============================================================================
-- 0124_post_link_previews — リンクプレビュー cache テーブル (統合・idempotent)
-- ----------------------------------------------------------------------------
-- 統合元: 0010(基本テーブル/index/RLS) + 0020(cache poisoning 方針) +
--         0036(inserter_id / 長さ CHECK / 所有者ベース write policy)
-- 用途   : og-fetch Edge Function が取得した OG メタ情報のキャッシュ。
-- 経緯   : prod に本テーブルが存在しなかった (REST 404 PGRST205) ため作り直す。
--          → リンクプレビュー機能 (X 風カード) が動かなかった真因。
--
-- 設計方針:
--   - すべて冪等 (IF NOT EXISTS / duplicate_object skip)。何度流しても安全。
--   - image_url は og-image プロキシの署名 URL (元 URL を encode して内包=長い)
--     を格納するため CHECK 長さ上限を 2048 に拡張 (0036 は 800 だった)。
--   - RLS: select=全員 / insert・update=inserter_id = auth.uid()。
--     ★ og-fetch は service_role で upsert するので RLS をバイパスする。
--       client からの書き込みは廃止済 (lib/api/linkPreview.ts)。
-- ============================================================================

-- 1. テーブル本体
create table if not exists public.post_link_previews (
  url         text primary key,                                   -- 正規化済み元 URL (PK)
  title       text,
  description text,
  image_url   text,                                               -- og-image 署名 URL (長い)
  site_name   text,
  fetched_at  timestamptz not null default now(),
  inserter_id uuid references auth.users(id) on delete set null   -- cache poisoning 追跡用
);

-- 既存テーブルがある環境向けに不足列を後付け (0010 だけ適用済みのケース)
alter table public.post_link_previews add column if not exists title       text;
alter table public.post_link_previews add column if not exists description text;
alter table public.post_link_previews add column if not exists image_url   text;
alter table public.post_link_previews add column if not exists site_name   text;
alter table public.post_link_previews add column if not exists fetched_at  timestamptz not null default now();
alter table public.post_link_previews add column if not exists inserter_id uuid references auth.users(id) on delete set null;

-- 2. サイズ CHECK 制約 (cache poisoning / ストレージ肥大対策)。
--    ★ image_url は og-image 署名 URL のため 2048 に拡張 (他は 0036 踏襲)。
do $$
begin
  begin
    alter table public.post_link_previews
      add constraint plp_title_len     check (title       is null or length(title)       <= 300);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.post_link_previews
      add constraint plp_desc_len      check (description is null or length(description) <= 800);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.post_link_previews
      add constraint plp_image_url_len check (image_url   is null or length(image_url)   <= 2048);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.post_link_previews
      add constraint plp_site_name_len check (site_name   is null or length(site_name)   <= 100);
  exception when duplicate_object then null;
  end;
end $$;

-- 3. index (fetched_at: 古いキャッシュの掃除 / 鮮度ソート用)
create index if not exists post_link_previews_fetched_idx
  on public.post_link_previews (fetched_at);

-- 4. RLS
--    select : 全員可 / insert・update : inserter_id = auth.uid() (service_role はバイパス)
--    delete policy は付けない (掃除は service_role / admin が RLS バイパスで実施)。
alter table public.post_link_previews enable row level security;

drop policy if exists "plp_read"   on public.post_link_previews;
drop policy if exists "plp_insert" on public.post_link_previews;
drop policy if exists "plp_update" on public.post_link_previews;
drop policy if exists "plp_delete" on public.post_link_previews;  -- 0020 由来の admin delete があれば撤去

create policy "plp_read" on public.post_link_previews
  for select using (true);

create policy "plp_insert" on public.post_link_previews
  for insert with check (inserter_id = auth.uid());

create policy "plp_update" on public.post_link_previews
  for update using (inserter_id = auth.uid()) with check (inserter_id = auth.uid());

select 'post_link_previews 統合 SQL 完了: table + columns + size checks(image_url<=2048) + fetched index + RLS' as result;
