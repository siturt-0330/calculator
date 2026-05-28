-- ============================================================
-- 0071_perf_trgm_indices.sql — slow search の根治
-- ============================================================
-- Audit G#4 で検出: posts.content / bbs_threads.title の ILIKE %...%
-- が GIN/btree いずれの index にも乗らず、毎回全表 scan していた。
-- (lib/api/admin.ts L57, L204 / app/search.tsx L112 で active hot path)
--
-- 対策: pg_trgm 拡張を使い、対象カラムに対して trgm GIN index を追加。
-- これで `ilike '%xxx%'` が index range scan へ落ちる。
--
-- 設計判断:
--   1) CONCURRENTLY を使い、本番 hot table の write を lock しない
--      ※ CONCURRENTLY は transaction 内で使えないため BEGIN/COMMIT で
--        包まない (0028 と同じスタイル — 個別 statement のまま流す)。
--   2) IF NOT EXISTS で冪等。再実行しても安全 (drop は一切しない)。
--   3) pg_trgm は他の trgm index 同様 idempotent に CREATE EXTENSION。
--   4) bbs_threads.body は schema に存在しないので対象外。
--   5) comments.content は現状 ILIKE 検索の hot path には未使用だが、
--      Audit G の要求リストに含まれており、将来コメント検索を実装
--      した際に再 migration を増やさず済むよう先回りで作る。
--      cost は GIN trgm index 1 個分のディスクのみ。
--
-- 注: CONCURRENTLY を伴う CREATE INDEX が途中で失敗すると INVALID 状態の
-- index が残ることがある。ANALYZE / index 一覧で `indisvalid = false`
-- を検出したら DROP INDEX して再実行する。
-- ============================================================

create extension if not exists pg_trgm;

-- ============================================================
-- posts.content — admin posts 検索 / reported posts 検索の hot path
-- (lib/api/admin.ts L57, L204)
-- ============================================================
create index concurrently if not exists posts_content_trgm_idx
  on public.posts using gin (content gin_trgm_ops);

-- ============================================================
-- bbs_threads.title — グローバル検索画面の BBS タブ
-- (app/search.tsx L112)
-- ============================================================
create index concurrently if not exists bbs_threads_title_trgm_idx
  on public.bbs_threads using gin (title gin_trgm_ops);

-- ============================================================
-- comments.content — 将来のコメント検索用 (現状 hot path には未配置)
-- Audit G#4 の要求リスト記載項目。
-- ============================================================
create index concurrently if not exists comments_content_trgm_idx
  on public.comments using gin (content gin_trgm_ops);

-- ============================================================
-- 統計情報更新 — planner が新 index を選ぶには ANALYZE が必要
-- ============================================================
analyze public.posts;
analyze public.bbs_threads;
analyze public.comments;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0071_perf_trgm_indices 完了: 3 trgm GIN indices + pg_trgm' as result;
