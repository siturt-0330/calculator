-- ============================================================
-- 0059: コメントツリー化 (parent_comment_id) + メンション通知 (reply_to_comment_id)
-- ------------------------------------------------------------
-- - public.comments に 2 カラム追加:
--     parent_comment_id   ツリー構造用 (返信ボタンで親を指定)
--     reply_to_comment_id メンション通知の宛先 (深い階層でも特定 comment を狙える)
-- - 階層 4 段までを trigger で物理制限 (5 階層目以降は parent を NULL に nullify
--   して sibling 扱い) — Reddit ガイド章末「視覚混乱を避ける」提言。
-- - reply_to_comment_id がセットされたら対象 comment の author に
--   'reply' 種別の notification を生成 (security definer)。
--
-- 後方互換:
--   - 既存 comment は parent_comment_id NULL のままなのでルート扱いされる。
--   - 新規 INSERT 時のみ depth ガードと通知が走る。
--   - notifications.type は 0001 で 'reply' が既に CHECK に含まれているので
--     新たな CHECK 拡張は不要。
-- ============================================================

set local statement_timeout = '5min';

alter table public.comments
  add column if not exists parent_comment_id uuid
    references public.comments(id) on delete cascade,
  add column if not exists reply_to_comment_id uuid
    references public.comments(id) on delete set null;

-- ============================================================
-- 階層 4 段までを CHECK で物理制限
-- ------------------------------------------------------------
-- depth=0 (root), 1, 2, 3 の 4 段までを許容。
-- 4 段目に到達したら parent_comment_id を NULL に書き換え、sibling 扱い。
-- 再帰 CTE ではなく単純ループで親をたどる (cycle 防止のため depth < 5 で打ち切り)。
-- security definer は不要 — INSERT する author 自身の権限で動けば十分。
-- ============================================================
create or replace function public.check_comment_depth()
returns trigger language plpgsql as $$
declare
  depth int := 0;
  cur uuid := NEW.parent_comment_id;
begin
  -- parent が無いなら depth=0 (root) なので即 OK
  if NEW.parent_comment_id is null then
    return NEW;
  end if;

  -- 親をたどって深さを数える (cycle 防止に最大 5 回まで)
  while cur is not null and depth < 5 loop
    select parent_comment_id into cur from public.comments where id = cur;
    depth := depth + 1;
  end loop;

  -- depth >= 4 (= 5 階層目以降) なら parent を nullify して sibling 扱い
  if depth >= 4 then
    NEW.parent_comment_id := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_check_comment_depth on public.comments;
create trigger trg_check_comment_depth
  before insert on public.comments
  for each row execute function public.check_comment_depth();

-- 階層検索の高速化 (root を引いて子をたどる経路用)
create index if not exists comments_parent_idx
  on public.comments(parent_comment_id) where parent_comment_id is not null;

-- ============================================================
-- メンション通知: reply_to_comment_id がセットされたら
-- 対象 comment.author_id に notification を 1 件 insert
-- ------------------------------------------------------------
-- - security definer + search_path 固定 (search_path injection 対策, 0020 流儀)
-- - 自分自身への返信は通知しない (target_author = NEW.author_id を skip)
-- - 対象 comment が削除済 (reply_to NULL 化) や見つからないケースも no-op
-- - data jsonb は将来 (post_id / comment_id を含める) 拡張余地として残す
-- ============================================================
create or replace function public.notify_comment_reply()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  target_author uuid;
begin
  if NEW.reply_to_comment_id is null then
    return NEW;
  end if;

  select author_id into target_author from public.comments
    where id = NEW.reply_to_comment_id;

  if target_author is null or target_author = NEW.author_id then
    return NEW;
  end if;

  insert into public.notifications (user_id, type, tag_name, message, read)
  values (
    target_author,
    'reply',
    null,
    'コメントに返信がありました',
    false
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_comment_reply on public.comments;
create trigger trg_notify_comment_reply
  after insert on public.comments
  for each row execute function public.notify_comment_reply();
