-- ============================================================
-- 0101_community_join_request_notifications.sql
-- ------------------------------------------------------------
-- 目的:
--   1. notifications.type CHECK enum に 'join_request' を追加
--   2. community_join_requests AFTER INSERT トリガで、コミュニティの
--      owner / admin 全員に「参加申請が来た」通知を自動生成
--
-- 連動するクライアント側:
--   - app/notifications/index.tsx: visualFor / handleTap に 'join_request'
--     ケース追加 (通知タップで /community/<id>/admin に遷移)
--   - admin.tsx の「参加申請」セクションが申請カードを表示し承認/拒否
--
-- 既存トリガとの干渉なし:
--   - community_join_requests には BEFORE INSERT (0025 で user_id / status
--     を強制) があるが、本トリガは AFTER INSERT なので順序的に問題なし。
--   - upsert で pending → pending を再度送ったケースは ON CONFLICT で UPDATE
--     になり INSERT は発火しない → 通知が重複生成されない (期待挙動)。
--
-- 既存 migration ファイルは編集禁止のため、本ファイルを 0101 として追加する。
-- revert したい場合は新 migration (00XX_revert_*.sql) で trigger drop + 旧
-- CHECK 制約に戻すこと。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1. notifications.type CHECK enum に 'join_request' を追加
-- ============================================================
-- 既存 (0037 で official_post / mention / announcement 追加済) に 'join_request'
-- を加える。0037 のパターン (drop → add) を踏襲。
do $$
begin
  if to_regclass('public.notifications') is null then
    raise notice 'skip: notifications table not found';
    return;
  end if;

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
          'join_request'
        ))
    $sql$;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- 2. join_request 通知生成トリガ
-- ============================================================
-- security definer:
--   通知 INSERT は trigger を起点に発火するので、申請者のセッションでも
--   owner/admin の user_id 行を notifications に INSERT する必要がある。
--   RLS を貫通する必要があるため SECURITY DEFINER 必須。
--
-- 失敗時の方針:
--   community が削除済み / メンバー一覧取得失敗等の異常時は通知を作らず
--   silently スキップする (申請自体は成立させる)。
create or replace function public.notify_on_community_join_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_name text;
  v_applicant_nickname text;
  v_admin_id uuid;
begin
  -- pending 以外 (= approve / reject の直接 INSERT) は通知不要
  if new.status is distinct from 'pending' then
    return new;
  end if;

  -- community 名を取得 (削除済みなら通知作らない)
  select name
    into v_community_name
    from public.communities
   where id = new.community_id;
  if v_community_name is null then
    return new;
  end if;

  -- 申請者の nickname (NULL の場合は「匿名」)
  select coalesce(nickname, '匿名')
    into v_applicant_nickname
    from public.profiles
   where id = new.user_id;
  if v_applicant_nickname is null then
    v_applicant_nickname := '匿名';
  end if;

  -- owner / admin 全員に通知 (申請者本人は除外)
  for v_admin_id in
    select user_id
      from public.community_members
     where community_id = new.community_id
       and role in ('owner', 'admin')
       and user_id <> new.user_id
  loop
    insert into public.notifications (user_id, type, message, data)
    values (
      v_admin_id,
      'join_request',
      v_applicant_nickname || ' さんが「' || v_community_name || '」への参加を申請しました',
      jsonb_build_object(
        'community_id', new.community_id,
        'applicant_user_id', new.user_id,
        'community_name', v_community_name,
        'applicant_nickname', v_applicant_nickname
      )
    );
  end loop;

  return new;
end;
$$;

-- 古い同名トリガがあれば外してから付け直す (idempotent)
drop trigger if exists trg_notify_on_community_join_request on public.community_join_requests;

create trigger trg_notify_on_community_join_request
  after insert on public.community_join_requests
  for each row
  execute function public.notify_on_community_join_request();

-- ============================================================
-- 備考:
--   - approve / reject 時に申請者へ「承認されました」通知を送る派生は
--     別 migration で追加可 (本 migration では owner 側通知のみに絞る)。
--   - 同じ申請を再 upsert しても INSERT は走らないので通知重複なし。
--   - push 通知 (send-push edge function) との連動が必要なら、別途
--     notifications INSERT を webhook で拾って send-push に流す既存パターンを使う。
-- ============================================================
