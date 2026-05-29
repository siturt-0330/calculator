-- ============================================================
-- 0099_fix_duplicate_likes_trigger.sql
-- ------------------------------------------------------------
-- 症状: いいねを 1 回押すと likes_count が +2 され、取り消すと -2 される。
-- 真因: public.likes に同じ関数 public.update_likes_count() を呼ぶトリガが
--       2 本存在していた:
--         - likes_count_trigger  (0001_schema.sql 由来)
--         - likes_trg            (complete_schema.sql 由来)
--       INSERT/DELETE のたびに両方が発火し、posts.likes_count と
--       profiles.like_received_count が 2 倍に増減していた。
-- 対策:
--   1. 両方のトリガを drop し、canonical な 1 本だけを作り直す
--      (どちらか一方しか無い環境でも idempotent に動くよう if exists)。
--   2. 過去の二重計上で drift したカウンタを likes 実数から再計算して整合。
-- 注意: 既存 migration の編集は禁止 (idempotency 崩壊) のため新規 file で対応。
--       update_likes_count() の関数本体は 0001 / complete_schema で同一なので
--       関数自体は触らず、トリガの重複だけを解消する。
-- ============================================================

-- 1) 重複トリガを解消し canonical な 1 本に統一 -----------------------
drop trigger if exists likes_count_trigger on public.likes;
drop trigger if exists likes_trg on public.likes;

create trigger likes_count_trigger
  after insert or delete on public.likes
  for each row execute procedure public.update_likes_count();

-- 2) drift したカウンタを likes 実数から再計算 -----------------------
-- posts.likes_count = その投稿への likes 実数に合わせる
update public.posts p
set likes_count = coalesce(c.cnt, 0)
from (
  select post_id, count(*)::int as cnt
  from public.likes
  group by post_id
) c
where p.id = c.post_id
  and p.likes_count is distinct from coalesce(c.cnt, 0);

-- likes が 1 件も無い投稿で likes_count が 0 以外なら 0 へ戻す
update public.posts p
set likes_count = 0
where p.likes_count <> 0
  and not exists (select 1 from public.likes l where l.post_id = p.id);

-- profiles.like_received_count は guard_profile_update_trg (migration 0036) が
-- 直接 UPDATE を禁止しているため (SQL Editor は auth.uid() = NULL = 非 admin 扱い)、
-- 0075 と同じく一時的に trigger を disable してから再計算し、最後に enable で戻す。
alter table public.profiles disable trigger guard_profile_update_trg;

-- profiles.like_received_count = その user の全投稿が受け取った likes 実数
update public.profiles pr
set like_received_count = coalesce(x.cnt, 0)
from (
  select po.author_id as uid, count(*)::int as cnt
  from public.likes li
  join public.posts po on po.id = li.post_id
  group by po.author_id
) x
where pr.id = x.uid
  and pr.like_received_count is distinct from coalesce(x.cnt, 0);

-- 受け取り 0 の user で like_received_count が 0 以外なら 0 へ戻す
update public.profiles pr
set like_received_count = 0
where pr.like_received_count <> 0
  and not exists (
    select 1
    from public.likes li
    join public.posts po on po.id = li.post_id
    where po.author_id = pr.id
  );

-- guard trigger を再 enable (0075 と同じ後始末)。途中で失敗しても
-- trigger が disable のまま残らないよう、再計算 UPDATE はすべて上で完了済み。
alter table public.profiles enable trigger guard_profile_update_trg;
