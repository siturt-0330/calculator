-- ============================================================
-- 0050_realtime_publication_and_notify_aggregate.sql
-- ============================================================
-- 2 つの critical regression を 1 migration で復旧:
--
-- (1) notify_on_reaction の集計ロジック消失 (0021 が 0009 を上書きで破壊)
--
-- (2) Realtime publication 漏れ:
--     - post_added_tags  (hooks/useAddedTags.ts が subscribe しているが未登録)
--     - bbs_threads      (hooks/useBBS.ts が subscribe しているが未登録)
-- ============================================================
-- 1. notify_on_reaction 復旧 — 24h 集計通知 + use_count 加算 + 匿名化を合算
-- ============================================================
-- 経緯:
--   migration 0008: 基本通知 (1 INSERT で 1 通)
--   migration 0009: 24h 以内に同 post+meme があれば集計 + user_stamps.use_count 加算
--   migration 0021: 匿名化のため `誰かが ...` 表記に。**この時 0009 の集計と
--                  use_count 加算が完全に削除されてしまっていた** (regression)
--
-- 結果として 0021 以降:
--   - 100 人が同じ meme で反応すると 100 通の通知が積まれる (本来 1 通集約)
--   - カスタムスタンプの user_stamps.use_count が停止 (人気スタンプ順 UI が壊れる)
--
-- 本 migration: 0009 の集計と use_count + 0021 の匿名表記を合算した版に差し替え。
-- bbs 側の notify_on_bbs_reply_reaction は 0021 で触られておらず 0009 のまま
-- 生き残っていたので、こちらは触らない (parity 維持)。
-- ============================================================

create or replace function public.notify_on_reaction()
returns trigger language plpgsql security definer as $$
declare
  author uuid;
  existing_id uuid;
  new_count int;
begin
  select author_id into author from public.posts where id = NEW.post_id;
  if author is null or author = NEW.user_id then return null; end if;

  -- 24時間以内に同じ post + meme の通知があれば集計
  select id into existing_id
  from public.notifications
  where user_id = author
    and type = 'like'
    and (data->>'post_id') = NEW.post_id::text
    and (data->>'meme') = NEW.meme
    and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;

  if existing_id is not null then
    select coalesce((data->>'count')::int, 1) + 1 into new_count
    from public.notifications where id = existing_id;
    update public.notifications set
      data       = jsonb_set(data, '{count}', to_jsonb(new_count)),
      message    = new_count || '人があなたの投稿にリアクションを付けました',
      read       = false,
      created_at = now()
    where id = existing_id;
  else
    insert into public.notifications(user_id, type, message, data)
    values (
      author, 'like',
      '誰かがあなたの投稿にリアクションを付けました',
      jsonb_build_object('post_id', NEW.post_id, 'meme', NEW.meme, 'count', 1)
    );
  end if;
  -- カスタムスタンプ (text=meme) があれば use_count を +1
  update public.user_stamps set use_count = use_count + 1 where text = NEW.meme;
  return null;
end;
$$;

-- trigger 本体 (reactions_notify_trigger) は 0009 で作られているので関数だけ差し替え。

-- ============================================================
-- 2. Realtime publication 漏れの修正
-- ============================================================
-- hooks/useAddedTags.ts と hooks/useBBS.ts で subscribe しているが
-- supabase_realtime publication に登録されていないため、
-- CHANNEL_ERROR で realtime が無音破綻している。
--
-- - post_added_tags : タグ追加の realtime 反映が来ない (= 別タブから戻らないと
--                     他人が付けたタグが表示されない)
-- - bbs_threads     : 同 channel chain の bbs_replies binding まで連鎖死する
--                     可能性 (CLAUDE.md § 11 の地雷パターン)
-- ============================================================
do $$
declare t text;
begin
  for t in select unnest(array['post_added_tags', 'bbs_threads']) loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============================================================
-- 確認:
-- 1. 同じ post に対して同じ meme で 2 ユーザーが反応 →
--    投稿主の notifications に 1 行だけ存在 ("2人があなたの投稿に ...")
-- 2. user_stamps を持っているユーザーが reaction を受ける →
--    user_stamps.use_count が増えている
-- 3. supabase_realtime publication のテーブル一覧に
--    post_added_tags / bbs_threads が含まれている:
--      select tablename from pg_publication_tables
--      where pubname = 'supabase_realtime' and schemaname = 'public';
-- ============================================================
