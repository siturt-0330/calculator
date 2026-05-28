-- ============================================================
-- 0071_trending_cron.sql — mv_trending_tags の自動 refresh
-- ============================================================
-- Audit G#7: MV (mv_trending_tags) は 0028 で定義済みだが、REFRESH は
-- 手動 schedule に丸投げ ("採用に踏み切れていないので一旦は CREATE のみ"
-- とコメントで保留) されていた。
-- 結果、3 つの hook (useFeed / useTagSearchV3 / lib/api/trending) が
-- per-session で posts table を直接 aggregate していた:
--   .from('posts').select('tag_names').gte('created_at', now()-24h).limit(...)
-- これは:
--   - クライアント側 CPU を 1 session ごとに浪費
--   - posts table の 24h 分を毎回 read (RLS 評価込みで重い)
--   - 結果が session 間で共有されない
--
-- このマイグレーションで pg_cron に 5 分毎の refresh を登録し、
-- 3 hook を MV 経由読み込みに切り替える土台を作る (hook 側変更は同 PR で別途)。
--
-- 安全性:
--   - 0028 で mv_trending_tags_tag_idx (UNIQUE) が既に存在するため、
--     CONCURRENTLY refresh は問題なく動く。
--   - pg_cron extension は Supabase の managed Postgres で標準提供 (既存
--     0050 で create extension if not exists pg_cron が既に発火している
--     可能性が高いが、idempotent なので重複作成は no-op)。
--   - cron.schedule は同名 job が既に存在しても idempotent ではないため、
--     unschedule → schedule の順で羃等化する。
-- ============================================================

create extension if not exists pg_cron;

-- 既存 job があれば unschedule (羃等化のため)
-- cron.unschedule は存在しない job を渡すと例外を投げるので、do block で握る。
do $$
begin
  perform cron.unschedule('refresh-trending');
exception when others then
  -- job が無いだけなので無視
  null;
end $$;

-- 5 分ごとに mv_trending_tags を CONCURRENTLY refresh
-- (CONCURRENTLY は MV unique index 必須 — 0028 の mv_trending_tags_tag_idx で OK)
select cron.schedule(
  'refresh-trending',
  '*/5 * * * *',
  $$refresh materialized view concurrently public.mv_trending_tags$$
);

-- 初回 refresh — 登録だけしてもデータが入らないと最初の 5 分間 MV が空のままなので、
-- migration 適用時点で 1 回 refresh しておく。
-- (CONCURRENTLY は MV が空のときは使えないので、初回は通常 refresh で。)
do $$
begin
  refresh materialized view public.mv_trending_tags;
exception when others then
  -- posts が空 等、何らかの理由で失敗しても migration は止めない
  null;
end $$;

select '0071_trending_cron 完了: refresh-trending cron job 登録 (*/5 min)' as result;
