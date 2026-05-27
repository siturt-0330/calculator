-- ============================================================
-- 0063: コメント「気になる」 (comment_concerns) — Reddit ガイド 5.3 / 5.10 章
-- ------------------------------------------------------------
-- 低品質コメントを「気になる」マークでユーザーに集合知ベース collapse する。
--
-- - comment_concerns: 1 user → 1 comment まで (PK で physical unique)
-- - comments.concern_count: 集計列 (trigger で +/- 1)
-- - comments.reply_count:   親コメントの返信数集計 (trigger で +/- 1)
--    → 「N 件の低評価コメントを表示」UI で利用
--
-- 設計判断:
--   - concern は post の concerns と同じ取り扱い (低品質サイン) だが、UI 表現は
--     非表示ではなく「collapse」(タップで展開)。
--   - is_private は持たず常に集計 — comment 側は概ね匿名運用なので、is_private を
--     導入しても本人 only filter として機能しない (post 側は author_id が見えるが
--     comment は anonymous も多い)。シンプルに concern_count として可視化する。
--   - concern_count / reply_count は migration 0062 流儀で idempotent (IF NOT EXISTS)。
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) comment_concerns テーブル本体
-- ----------------------------------------------------------------
create table if not exists public.comment_concerns (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists comment_concerns_comment_idx
  on public.comment_concerns(comment_id);

-- ----------------------------------------------------------------
-- 2) RLS
-- ----------------------------------------------------------------
alter table public.comment_concerns enable row level security;

drop policy if exists "comment_concerns_read" on public.comment_concerns;
create policy "comment_concerns_read" on public.comment_concerns
  for select using (true);

drop policy if exists "comment_concerns_insert" on public.comment_concerns;
create policy "comment_concerns_insert" on public.comment_concerns
  for insert with check (auth.uid() = user_id);

drop policy if exists "comment_concerns_delete" on public.comment_concerns;
create policy "comment_concerns_delete" on public.comment_concerns
  for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- 3) comments に concern_count + reply_count 集計列を追加
-- ----------------------------------------------------------------
alter table public.comments
  add column if not exists concern_count int not null default 0,
  add column if not exists reply_count int not null default 0;

-- ----------------------------------------------------------------
-- 4) concern_count 更新 trigger — comment_concerns の insert/delete で +/- 1
-- ----------------------------------------------------------------
create or replace function public.update_comment_concern_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.comments
      set concern_count = concern_count + 1
      where id = NEW.comment_id;
  elsif TG_OP = 'DELETE' then
    update public.comments
      set concern_count = greatest(concern_count - 1, 0)
      where id = OLD.comment_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_comment_concern_count on public.comment_concerns;
create trigger trg_comment_concern_count
  after insert or delete on public.comment_concerns
  for each row execute function public.update_comment_concern_count();

-- ----------------------------------------------------------------
-- 5) reply_count 更新 trigger — comments.parent_comment_id 経由で +/- 1
--    NEW.parent_comment_id が NULL (= root comment) は対象外。
-- ----------------------------------------------------------------
create or replace function public.update_comment_reply_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' and NEW.parent_comment_id is not null then
    update public.comments
      set reply_count = reply_count + 1
      where id = NEW.parent_comment_id;
  elsif TG_OP = 'DELETE' and OLD.parent_comment_id is not null then
    update public.comments
      set reply_count = greatest(reply_count - 1, 0)
      where id = OLD.parent_comment_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_comment_reply_count on public.comments;
create trigger trg_comment_reply_count
  after insert or delete on public.comments
  for each row execute function public.update_comment_reply_count();
