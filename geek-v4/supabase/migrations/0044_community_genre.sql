-- ============================================================
-- 0044_community_genre.sql
-- ------------------------------------------------------------
-- コミュニティに genre (ジャンル) を追加し、ジャンルごとに表示タブを
-- 切り替えられるようにする。
--
-- 5 genres:
--   - oshi       推し系   (アイドル / VTuber / 声優 / アーティスト)
--                          tabs: ホーム / 検索 / マップ / カレンダー / マイプロフ
--   - creative   作品系   (漫画 / 小説 / アニメ / 映画 / ドラマ / ゲーム)
--                          tabs: ホーム / 掲示板 / マップ
--   - experience 体験系   (サウナ / ラーメン / 旅行 / グルメ / カフェ)
--                          tabs: ホーム / 掲示板 / 検索 / マップ / カレンダー / マイプロフ
--   - discussion 議論系   (政治 / 学問 / ニュース / 雑談)
--                          tabs: ホーム / 掲示板
--   - legacy     旧コミュ用 — migration 時点の既存コミュは全部これに割当
--                          tabs: ホーム / 掲示板 / 聖地 / カレンダー / 投稿 (現状)
--
-- 設計判断:
--   1. check 制約で genre 値を白リスト化 — タイポ/不正値を DB レイヤで弾く
--   2. default を 'legacy' に設定 — 既存 community へ影響ゼロ
--      (既存ユーザーは旧 UI のまま、オーナーは後から別 genre に変更可能)
--   3. NOT NULL とすることで「genre 未設定」状態を不可能に
--   4. (community_id, genre) の複合 index ではなく genre 単体 index で OK
--      → discover / search のジャンル絞り込みで効く
-- ============================================================

alter table public.communities
  add column if not exists genre text not null default 'legacy'
    check (genre in ('oshi', 'creative', 'experience', 'discussion', 'legacy'));

-- discover / ジャンル別フィルター高速化
create index if not exists idx_communities_genre on public.communities (genre);

-- ============================================================
-- 注: 既存 community は全て 'legacy' で初期化される。
-- オーナーが後から genre を変更したい場合は updateCommunity の
-- allowlist に 'genre' を含めるか、admin RPC で行うこと。
-- 本 migration では schema 追加のみで data backfill は行わない。
-- ============================================================
