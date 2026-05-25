-- ============================================================
-- 0045_spot_simplify_and_wiki.sql
-- ------------------------------------------------------------
-- 聖地 (community_spots) UX 全面改修 (2026-05):
--
-- 1. category 必須化 — 8 値プリセット (ライブ会場 / 聖地(作品) /
--    コラボカフェ / グッズ販売 / 撮影スポット / 神社・寺 / 飲食 / その他)
--    → マップ pin の色分け + リスト絞り込み用
--
-- 2. photo_urls 追加 — text[] で複数写真 (上限 4 枚) 対応
--    既存 photo_url (単数) は残す (旧データ後方互換 / 表示時 fallback)
--    新規登録は photo_urls を使う前提
--
-- 3. wiki 型編集解放 — UPDATE / DELETE を community member 全員に開放
--    旧 RLS:
--      - UPDATE: 無し (= service_role でしか書き換え不可)
--      - DELETE: creator or community owner のみ
--    新 RLS:
--      - UPDATE / DELETE: community member 誰でも
--    Wikipedia 的に集合知で spot 情報を磨いていく方針。
--    荒らし対策は trust_score / 通報で別レイヤ。
--
-- 4. (community_id, category) 複合 index で カテゴリ別絞り込み高速化
-- ============================================================

-- ============================================================
-- 1) category 列を追加 (NOT NULL default 'other')
-- ============================================================
-- 既存 row には自動的に 'other' が当たる (= backward compat)
alter table public.community_spots
  add column if not exists category text not null default 'other'
    check (category in (
      'live_venue',     -- ライブ会場
      'work_setting',   -- 聖地 (作品の舞台)
      'collab_cafe',    -- コラボカフェ
      'goods_shop',     -- グッズ販売
      'photo_spot',     -- 撮影スポット
      'shrine_temple',  -- 神社・寺
      'restaurant',     -- 飲食
      'other'           -- その他
    ));

-- ============================================================
-- 2) photo_urls 列を追加 (text[], 上限 4 枚)
-- ============================================================
-- 旧 photo_url (text, 単数) は残す:
--   - 既存データを壊さない
--   - 新規は photo_urls に保存、表示時は photo_urls || [photo_url] で union
alter table public.community_spots
  add column if not exists photo_urls text[] not null default '{}'
    check (array_length(photo_urls, 1) is null or array_length(photo_urls, 1) <= 4);

-- ============================================================
-- 3) wiki 型 RLS (UPDATE / DELETE を community member 全員へ)
-- ============================================================

-- UPDATE policy 新設 — community member なら誰でも spot を編集可
drop policy if exists "community_spots_update" on public.community_spots;
create policy "community_spots_update" on public.community_spots for update using (
  public.is_community_member(community_id)
) with check (
  public.is_community_member(community_id)
);

-- DELETE policy を community member 全員へ拡張
-- (旧: creator or community owner のみ → wiki 化に伴い緩和)
drop policy if exists "community_spots_delete" on public.community_spots;
create policy "community_spots_delete" on public.community_spots for delete using (
  public.is_community_member(community_id)
);

-- ============================================================
-- 4) インデックス追加 — カテゴリ別フィルタ高速化
-- ============================================================
-- マップ画面で「ライブ会場だけ表示」のようなフィルタリングに効く
create index if not exists community_spots_category_idx
  on public.community_spots(community_id, category);

-- ============================================================
-- 注: is_certified カラムを将来追加する場合は別 migration で。
-- 今回は category + photo_urls + wiki edit の 3 点に絞る。
-- ============================================================
