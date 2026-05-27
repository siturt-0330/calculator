-- 0058: hot_score を Reddit 風 generated column に置換
-- ============================================================
-- 既存実装 (0005_reddit_like.sql) は votes テーブル変更時に trigger
-- (update_post_score) で hot_score を更新していたが:
--   - votes は 0005 以降ほぼ未使用 (likes / concerns に置換済)
--   - score (votes 合算) と likes_count / concern_count が divergent
--   - hot_score が trigger 任せで stale になりやすい
--
-- 本 migration では Reddit 4.2 章の "Hot ranking" 公式に揃え、
-- likes_count - concern_count を s (= upvotes - downvotes)、
-- created_at を t として generated column で常に最新値を保持する。
--
-- 式:
--   s     = likes_count - concern_count
--   t     = extract(epoch from created_at) - GEEK_LAUNCH_EPOCH
--   score = log10(max(|s|, 1)) + sign(s) * t / 28800
--
--   - 28800 秒 = 8 時間。日本市場の "夕方〜深夜" ピークに 1 桁の score
--     差を与える分解能で調整 (Reddit は 45000=12.5h、日本は活動帯が
--     短いので時間軸を絞った)。
--   - GEEK_LAUNCH_EPOCH = 1715817600 (2024-05-16 UTC) — Geek launch 想定。
--     epoch 値が大きすぎると double precision の精度が落ちるので原点を
--     ずらす慣習 (Reddit も同じ手法)。
--
-- generated column にすることで:
--   - trigger 不要 — update_post_score を完全に置換できる
--   - 常に最新の likes_count / concern_count を反映 (stale 問題が消える)
--   - DDL のみで apply 可能 — backfill SQL が不要
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) 旧 trigger + function を drop
-- ----------------------------------------------------------------
-- 0005 の update_post_score trigger は votes 経由で hot_score を書き換える
-- ので、generated column に切り替える前に取り外す。trigger / function 共に
-- IF EXISTS で idempotent (既に削除済 / 別環境で未作成でも安全)。
drop trigger if exists votes_trg on public.votes;
drop function if exists public.update_post_score() cascade;

-- ----------------------------------------------------------------
-- 2) 既存 hot_score 列を drop
-- ----------------------------------------------------------------
-- generated column は同名の non-generated column と共存できないので、
-- 一度 drop してから addColumn する。依存 index (posts_hot_idx) も
-- 一緒に消える (cascade)。
-- 注: 既存 hot_score の値は 0005 の formula で書き込まれていたため
--     drop しても整合性に影響なし。次の add column で再計算される。
alter table public.posts drop column if exists hot_score cascade;

-- ----------------------------------------------------------------
-- 3) 新 hot_score を generated column として add
-- ----------------------------------------------------------------
-- log(numeric, numeric) は base 10 の対数。greatest(...,1) で |s|=0 のとき
-- log10(0)=-Inf を回避。sign(s) は -1/0/+1 のいずれかなので、s=0 のときは
-- score = log10(1) + 0 * t = 0 となり時刻に依存しない (Reddit と同挙動)。
alter table public.posts
  add column if not exists hot_score double precision
  generated always as (
    (log(greatest(abs(likes_count - concern_count), 1)::numeric, 10::numeric))::double precision
    + sign((likes_count - concern_count)::double precision)
      * (extract(epoch from created_at) - 1715817600) / 28800.0
  ) stored;

-- ----------------------------------------------------------------
-- 4) hot_score 降順 + created_at 降順の index を貼る
-- ----------------------------------------------------------------
-- sort='hot' クエリは "hot_score desc, created_at desc" で order by するので、
-- 複合 index にして range scan を回避。created_at desc を tie-breaker と
-- して入れることで、同 score の post でも安定した順序になる。
create index if not exists posts_hot_score_idx
  on public.posts (hot_score desc, created_at desc);
