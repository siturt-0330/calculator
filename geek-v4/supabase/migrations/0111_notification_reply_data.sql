-- ============================================================
-- 0111: 返信通知 (reply) に post_id/comment_id を格納 + 文面改善
-- ============================================================
-- 背景:
--   0059 の notify_comment_reply は 'reply' 通知を作るが data を埋めておらず
--   (当時のコメントにも「将来 post_id/comment_id を含める」と明記)、
--   アプリ側で「どの投稿の返信か」を解決できず通知タップがフィードに落ちていた。
--   0008 の like/comment/reaction は既に data.post_id を持つので、reply も揃える。
--
--   併せて文面を他通知 (「X が…しました」) と統一し、返信者のニックネームを入れる。
--
-- 安全性:
--   - CREATE OR REPLACE FUNCTION のみ (trigger 定義は 0059 のまま据え置き、
--     関数本体だけ差し替わる)。idempotent。
--   - comments.post_id / comments.id / comments.author_id は既存列。
-- ============================================================

create or replace function public.notify_comment_reply()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  target_author uuid;
  replier_nick text;
begin
  -- reply_to_comment_id が無ければ通常コメント (notify_on_comment 側が担当)
  if NEW.reply_to_comment_id is null then
    return NEW;
  end if;

  select author_id into target_author from public.comments
    where id = NEW.reply_to_comment_id;

  -- 対象が見つからない / 自分自身への返信 は通知しない
  if target_author is null or target_author = NEW.author_id then
    return NEW;
  end if;

  select nickname into replier_nick from public.profiles where id = NEW.author_id;

  insert into public.notifications (user_id, type, tag_name, message, read, data)
  values (
    target_author,
    'reply',
    null,
    coalesce(replier_nick, '誰か') || ' があなたのコメントに返信しました',
    false,
    jsonb_build_object(
      'post_id', NEW.post_id,
      'comment_id', NEW.id,
      'reply_to_comment_id', NEW.reply_to_comment_id
    )
  );
  return NEW;
end;
$$;

select '0111_notification_reply_data 完了: reply 通知に post_id/comment_id + 返信者名' as result;
