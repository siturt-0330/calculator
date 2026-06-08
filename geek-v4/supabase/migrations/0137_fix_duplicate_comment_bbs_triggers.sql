-- ============================================================
-- 0137: コメント / BBS返信 のカウント二重計上を修正 (0099 の comments/bbs 版)
-- ------------------------------------------------------------
-- 症状: コメントを 1 回しただけなのに posts.comments_count が +2 になる
--       (取り消すと挙動が非対称)。BBS 返信も bbs_threads.replies_count が +2。
-- 真因: 0099 で likes は解消したが、同じ「二重トリガ」が comments / bbs_replies に残存:
--   comments:
--     - comments_count_trigger (0001_schema.sql / after insert)         → update_comments_count
--     - comments_trg           (complete_schema.sql / after insert or delete) → update_comments_count
--     INSERT のたびに両方が発火し posts.comments_count が +2 されていた。
--   bbs_replies:
--     - bbs_replies_count_trigger (0001 / after insert)  → update_bbs_replies_count (+1)
--     - bbs_reply_trg             (complete_schema / after insert) → update_bbs_reply (+1)
--     INSERT のたびに両方が発火し bbs_threads.replies_count が +2 されていた。
-- 対策 (0099 と同方針):
--   1. 各テーブルの重複トリガを drop し canonical な 1 本だけにする。
--   2. ★関数本体は触らない。0134 が counter 関数を「ALTER FUNCTION ... SECURITY DEFINER」
--      で硬化済み (本体は 0001/complete_schema で差異があり断定不可のため create or replace
--      しない方針)。ここで create or replace すると DEFINER 化や本体差異を壊すので厳禁。
--   3. 二重計上で drift したカウンタを実数から再計算して整合。
--   ※ comments は関数が TG_OP 判定を持つので after insert or delete で安全 (delete 減算)。
--     bbs の update_bbs_reply は TG_OP 判定が無く常に +1 するため after insert のままにする
--     (insert or delete にすると delete で誤 +1 する)。
-- 注意: 既存 migration の編集は禁止のため新規 file。★本番は Supabase SQL エディタで手動適用。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) comments: 重複トリガを canonical な 1 本に統一 (関数は触らない)
-- ============================================================
drop trigger if exists comments_count_trigger on public.comments;
drop trigger if exists comments_trg on public.comments;
create trigger comments_count_trigger
  after insert or delete on public.comments
  for each row execute procedure public.update_comments_count();

-- ============================================================
-- 2) bbs_replies: 重複トリガを canonical な 1 本に統一 (関数は触らない / insert のみ)
-- ============================================================
drop trigger if exists bbs_replies_count_trigger on public.bbs_replies;
drop trigger if exists bbs_reply_trg on public.bbs_replies;
create trigger bbs_reply_trg
  after insert on public.bbs_replies
  for each row execute procedure public.update_bbs_reply();

-- ============================================================
-- 3) drift 再計算: posts.comments_count = 実コメント数
--    (posts には counter guard trigger は無い。0134 は列 GRANT revoke のみで、
--     SQL エディタ = postgres 権限なら直 UPDATE 可。0099 の likes_count と同じ)。
-- ============================================================
update public.posts p
set comments_count = coalesce(c.cnt, 0)
from (
  select post_id, count(*)::int as cnt
  from public.comments
  group by post_id
) c
where p.id = c.post_id
  and p.comments_count is distinct from coalesce(c.cnt, 0);

update public.posts p
set comments_count = 0
where p.comments_count <> 0
  and not exists (select 1 from public.comments cm where cm.post_id = p.id);

-- ============================================================
-- 4) drift 再計算: bbs_threads.replies_count = 実返信数
-- ============================================================
update public.bbs_threads t
set replies_count = coalesce(r.cnt, 0)
from (
  select thread_id, count(*)::int as cnt
  from public.bbs_replies
  group by thread_id
) r
where t.id = r.thread_id
  and t.replies_count is distinct from coalesce(r.cnt, 0);

update public.bbs_threads t
set replies_count = 0
where t.replies_count <> 0
  and not exists (select 1 from public.bbs_replies br where br.thread_id = t.id);

-- ============================================================
-- 5) drift 再計算: profiles.comment_count (二重計上で増えていた可能性に備え整合)
--    guard_profile_update_trg (0036) が直 UPDATE を禁止するため 0099 と同様に一時 disable。
-- ============================================================
alter table public.profiles disable trigger guard_profile_update_trg;

update public.profiles pr
set comment_count = coalesce(x.cnt, 0)
from (
  select author_id as uid, count(*)::int as cnt
  from public.comments
  group by author_id
) x
where pr.id = x.uid
  and pr.comment_count is distinct from coalesce(x.cnt, 0);

update public.profiles pr
set comment_count = 0
where pr.comment_count <> 0
  and not exists (select 1 from public.comments cm where cm.author_id = pr.id);

alter table public.profiles enable trigger guard_profile_update_trg;

select '0137 完了 — comments/bbs_replies の二重トリガを解消 + comments_count/replies_count/comment_count を実数へ再計算' as note;
