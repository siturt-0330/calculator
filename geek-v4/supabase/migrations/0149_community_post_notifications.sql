-- ============================================================
-- 0149_community_post_notifications.sql — コミュニティ新着投稿の通知
-- ------------------------------------------------------------
-- 目的 (YouTube のチャンネル新着動画通知に相当・2026-06-12 ユーザー要望):
--   参加しているコミュニティに新しい投稿が紐付いたら、メンバー全員
--   (投稿者本人を除く) に type='community_post' の通知を届ける。
--
-- 設計:
--   (1) notifications_type_check に 'community_post' を追加 (0136 の一覧 + 1)。
--   (2) get_notification_preferences() を 12 カテゴリ (community_post 追加) で
--       置き換え — クライアントの通知設定画面に ON/OFF トグルが現れる。
--       既定 true (fail-open)。アプリ内表示の実フィルタはクライアント
--       (lib/utils/notificationFilter.ts) と push Edge Function が prefs を見る。
--   (3) post_communities AFTER INSERT トリガ — メンバーへ一括 INSERT。
--       ★匿名性: 投稿者のニックネーム/ID を message にも data にも入れない。
--         message は「<コミュ名> に新しい投稿があります」のみ。
--         data = { post_id, community_id } (タップ遷移用)。
--       ★投稿者本人には通知しない。
--       ★クロスポスト (1 投稿→複数コミュ) はコミュごとに発火する
--         (YouTube がチャンネルごとに通知するのと同型)。
--       ★安全弁: 1 コミュあたり最大 500 通知 (巨大コミュで INSERT が
--         暴れない上限。現在の規模では到達しない)。
--
-- 冪等: drop trigger if exists → create / create or replace function /
--        constraint は drop→add。
-- ★本番は Supabase SQL エディタで手動適用が必要 (他 migration と同様)。
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) notifications.type に 'community_post' を追加
-- ----------------------------------------------------------------
do $$
begin
  begin
    execute 'alter table public.notifications drop constraint if exists notifications_type_check';
  exception when others then null;
  end;

  begin
    execute $sql$
      alter table public.notifications
        add constraint notifications_type_check
        check (type in (
          'like',
          'comment',
          'follow',
          'reply',
          'event',
          'official_post',
          'mention',
          'announcement',
          'join_request',
          'mod_action',
          'community_post'
        ))
    $sql$;
  exception when duplicate_object then null;
  end;
end $$;

-- ----------------------------------------------------------------
-- 2) get_notification_preferences — 12 カテゴリに拡張 (0070 を置き換え)
-- ----------------------------------------------------------------
create or replace function public.get_notification_preferences()
returns table (category text, push boolean, inapp boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with categories as (
    select unnest(array[
      'like', 'comment', 'reply', 'mention', 'follow',
      'friend_request', 'friend_accept', 'official_post',
      'event', 'mod_action', 'system', 'community_post'
    ]) as cat
  )
  select
    c.cat as category,
    coalesce(p.push, true) as push,
    coalesce(p.inapp, true) as inapp
  from categories c
  left join public.notification_preferences p
    on p.category = c.cat and p.user_id = auth.uid()
  order by c.cat;
$$;

grant execute on function public.get_notification_preferences() to authenticated;

-- ----------------------------------------------------------------
-- 3) post_communities AFTER INSERT → メンバーへ community_post 通知
-- ----------------------------------------------------------------
-- security definer: community_members / posts / communities を横断 SELECT し
-- notifications へ INSERT するため。search_path 固定で安全化。
create or replace function public.notify_community_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_author uuid;
  v_name   text;
begin
  select author_id into v_author from public.posts where id = NEW.post_id;
  select name into v_name from public.communities where id = NEW.community_id;
  if v_name is null then
    return NEW;
  end if;

  insert into public.notifications (user_id, type, message, data)
  select
    m.user_id,
    'community_post',
    v_name || ' に新しい投稿があります',
    jsonb_build_object('post_id', NEW.post_id, 'community_id', NEW.community_id)
  from public.community_members m
  where m.community_id = NEW.community_id
    and (v_author is null or m.user_id <> v_author)
  limit 500; -- 安全弁: 巨大コミュで INSERT が暴れない上限

  return NEW;
end;
$$;

drop trigger if exists notify_community_post_trg on public.post_communities;
create trigger notify_community_post_trg
  after insert on public.post_communities
  for each row execute function public.notify_community_post();
