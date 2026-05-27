-- 0058: hot_score を Reddit 風 trigger 計算に置換 (immutable 制約回避版)
-- ============================================================
-- 既存実装 (0005_reddit_like.sql) は votes テーブル変更時に trigger
-- (update_post_score) で hot_score を更新していたが:
--   - votes は 0005 以降ほぼ未使用 (likes / concerns に置換済)
--   - score (votes 合算) と likes_count / concern_count が divergent
--   - hot_score が trigger 任せで stale になりやすい
--
-- 本 migration では Reddit 4.2 章の "Hot ranking" 公式に揃え、
-- likes_count - concern_count を s (= upvotes - downvotes)、
-- created_at を t として保持する。
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
-- 設計判断: なぜ generated column ではなく trigger 計算か
--   PostgreSQL の generated stored column は計算式に IMMUTABLE 関数しか
--   使えない。extract(epoch from timestamptz) は内部的には決定的だが
--   PostgreSQL のカタログ上は STABLE 扱いのため、generated column で
--   使うと 42P17 "generation expression is not immutable" エラーになる。
--   trigger ベースなら STABLE 関数も自由に使えるので、Reddit 流の式を
--   そのまま実装できる。挙動上は generated と同等 (likes/concerns 更新
--   のたびに再計算される)。
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) 旧 trigger + function を drop
-- ----------------------------------------------------------------
-- 0005 の update_post_score trigger は votes 経由で hot_score を書き換える
-- ので、新方式に切り替える前に取り外す。trigger / function 共に
-- IF EXISTS で idempotent (既に削除済 / 別環境で未作成でも安全)。
drop trigger if exists votes_trg on public.votes;
drop function if exists public.update_post_score() cascade;

-- ----------------------------------------------------------------
-- 2) 既存 hot_score 列を drop (generated 試行が partial に残ってる
--    可能性も含めて完全リセット)
-- ----------------------------------------------------------------
alter table public.posts drop column if exists hot_score cascade;

-- ----------------------------------------------------------------
-- 3) 通常の double precision 列として hot_score を add
-- ----------------------------------------------------------------
-- NOT NULL DEFAULT 0 で既存 row も即座に 0 埋め。直後の backfill で
-- 全行に対して正しい値を書き込む。
alter table public.posts
  add column if not exists hot_score double precision not null default 0;

-- ----------------------------------------------------------------
-- 4) Hot score 計算 trigger function
-- ----------------------------------------------------------------
-- BEFORE INSERT/UPDATE で NEW.hot_score を上書きする pattern。
-- extract(epoch) は STABLE だが、trigger 内では問題なし。
-- log(10::numeric, x::numeric) は base 10 対数。greatest(...,1) で
-- |s|=0 のとき log10(0)=-Inf を回避。
create or replace function public.compute_post_hot_score()
returns trigger language plpgsql as $$
declare
  s_val bigint;
  t_val double precision;
  log_part double precision;
  sign_part double precision;
begin
  s_val := coalesce(NEW.likes_count, 0) - coalesce(NEW.concern_count, 0);
  t_val := (extract(epoch from NEW.created_at) - 1715817600) / 28800.0;
  log_part := log(10::numeric, greatest(abs(s_val), 1)::numeric)::double precision;
  -- sign(0) = 0 なので s=0 のとき時刻寄与なしで log_part = 0 → hot_score = 0
  sign_part := sign(s_val::double precision);
  NEW.hot_score := log_part + sign_part * t_val;
  return NEW;
end;
$$;

-- ----------------------------------------------------------------
-- 5) trigger を attach (likes_count / concern_count / created_at 変動時)
-- ----------------------------------------------------------------
-- INSERT 時は無条件で計算 (列指定は UPDATE OF にしか効かないため)。
-- UPDATE 時は likes_count / concern_count / created_at が変わったときだけ。
-- created_at は通常変えないが、安全マージンとして含めておく。
drop trigger if exists trg_compute_post_hot_score on public.posts;
create trigger trg_compute_post_hot_score
  before insert or update of likes_count, concern_count, created_at
  on public.posts
  for each row execute function public.compute_post_hot_score();

-- ----------------------------------------------------------------
-- 6) 既存 row を backfill
-- ----------------------------------------------------------------
-- ADD COLUMN DEFAULT 0 で全行 0 になっているので、ここで一度 UPDATE して
-- 正しい hot_score を埋める。WHERE 句で「まだ計算されていない行」だけ
-- 対象にして、reapply 時の不要な書き換えを減らす (idempotent 化)。
-- updated_at trigger があれば発火するので、列リストは limit したいが
-- 列構成不明なので一旦 hot_score だけ書き換える。
update public.posts
set hot_score = (
  log(10::numeric, greatest(abs(coalesce(likes_count,0) - coalesce(concern_count,0)), 1)::numeric)::double precision
  + sign((coalesce(likes_count,0) - coalesce(concern_count,0))::double precision)
    * (extract(epoch from created_at) - 1715817600) / 28800.0
)
where hot_score = 0
  and (coalesce(likes_count,0) <> 0 or coalesce(concern_count,0) <> 0
       or created_at > timestamptz '2024-05-16 00:00:00+00');

-- ----------------------------------------------------------------
-- 7) hot_score 降順 + created_at 降順の index を貼る
-- ----------------------------------------------------------------
-- sort='hot' クエリは "hot_score desc, created_at desc" で order by するので、
-- 複合 index にして range scan を回避。created_at desc を tie-breaker と
-- して入れることで、同 score の post でも安定した順序になる。
create index if not exists posts_hot_score_idx
  on public.posts (hot_score desc, created_at desc);
