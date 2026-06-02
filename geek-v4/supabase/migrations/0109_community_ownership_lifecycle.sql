-- ============================================================
-- 0109: コミュニティ オーナー権限の譲渡 / コミュニティ削除
-- ============================================================
-- 設計:
--   DANGER ZONE — owner だけが実行できる 2 つの破壊的操作を RPC 化する。
--
--   (1) transfer_community_ownership(p_community_id, p_new_owner_id)
--       - caller が owner でなければ 42501 (insufficient_privilege)
--       - target は既存メンバーで、かつ既に owner ではないこと
--       - caller(owner) を admin に降格 + target を owner に昇格 (同一トランザクション)
--       - is_official のコミュは block (official_admin_user_id / 公式表示名の
--         移譲が伴わないため。公式は別フロー — 0032 の公式申請系で扱う)
--       - mod_action_logs に action='promote' を 1 行記録 (target を昇格した事実)
--
--   (2) delete_community(p_community_id)
--       - caller が owner でなければ 42501
--       - is_official は block (公式コミュは勝手に消せない)
--       - communities 行を削除。依存テーブルは全て
--         `references public.communities(id) on delete cascade` なので
--         communities 1 行 delete で連鎖削除される (下記 NOTE 参照)。
--
-- 既存 (0017 / 0068 / 0069):
--   - community_members.role = ('owner' | 'admin' | 'member')
--   - is_community_owner(uuid) は 0069 で security definer 再定義済
--   - mod_action_logs.action check に 'promote' / 'demote' が含まれる (0068)
--   - communities_delete RLS は is_community_owner(id) (0017) — RPC とは別経路の
--     defense in depth として残す (本 RPC は SECURITY DEFINER で RLS を bypass
--     するため、関数内の owner 判定が一次防御)。
--
-- NOTE (cascade 前提 — 2026-06 に全 FK を実確認済):
--   communities(id) を `on delete cascade` で参照しているため、communities を
--   1 行削除すれば自動で道連れ削除される (明示 delete 不要):
--     community_members / community_tags / community_join_requests /
--     community_posts (0017), post_communities (0023),
--     community_spots / community_events (0023), community_invites (0019),
--     community_stamps / community_stamp_reactions (0040),
--     community_member_profiles (0047), community_bans / mod_action_logs (0068),
--     community_task_weights (0089), 公式系 (0032)
--   ※ bbs_threads.community_id だけは `on delete set null` (スレッドは残り
--      コミュ紐付けだけ外れる — 0023)。これは意図どおり。
--   ※ delete_community は is_official=true を block するので、0032 の公式専用
--      テーブルにはそもそも到達しない。
--
-- 全 statement は idempotent (create or replace function)。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) transfer_community_ownership — owner 権限の譲渡
-- ============================================================
create or replace function public.transfer_community_ownership(
  p_community_id uuid,
  p_new_owner_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_is_official boolean;
  v_target_role text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- caller が owner であることを確認 (一次防御)
  if not public.is_community_owner(p_community_id) then
    raise exception 'owner only' using errcode = '42501';
  end if;

  -- 自分自身への譲渡は no-op エラー
  if p_new_owner_id = v_caller then
    raise exception 'cannot transfer ownership to yourself';
  end if;

  -- 公式コミュニティは block (official_admin の移譲が伴わないため)
  select is_official into v_is_official
  from public.communities
  where id = p_community_id;
  if v_is_official is null then
    raise exception 'community not found';
  end if;
  if v_is_official then
    raise exception '公式コミュニティのオーナー権限は譲渡できません。公式管理者の変更は公式申請から行ってください。';
  end if;

  -- target が既存メンバーかを確認 (FOR UPDATE で行ロック)
  select role into v_target_role
  from public.community_members
  where community_id = p_community_id and user_id = p_new_owner_id
  for update;

  if v_target_role is null then
    raise exception 'target user is not a member';
  end if;
  if v_target_role = 'owner' then
    raise exception 'target user is already the owner';
  end if;

  -- caller(owner) を admin に降格
  update public.community_members
  set role = 'admin'
  where community_id = p_community_id and user_id = v_caller;

  -- target を owner に昇格
  update public.community_members
  set role = 'owner'
  where community_id = p_community_id and user_id = p_new_owner_id;

  -- audit log (target を昇格した事実を promote として記録)
  insert into public.mod_action_logs (
    community_id, mod_user_id, target_user_id, action
  ) values (
    p_community_id, v_caller, p_new_owner_id, 'promote'
  );
end;
$$;

comment on function public.transfer_community_ownership(uuid, uuid) is
  'owner 権限の譲渡。caller(owner)->admin / target->owner を atomic に。owner のみ実行可、公式コミュは block。';

-- ============================================================
-- 2) delete_community — コミュニティ削除
-- ============================================================
create or replace function public.delete_community(
  p_community_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_is_official boolean;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- caller が owner であることを確認 (一次防御)
  if not public.is_community_owner(p_community_id) then
    raise exception 'owner only' using errcode = '42501';
  end if;

  -- 公式コミュニティは block
  select is_official into v_is_official
  from public.communities
  where id = p_community_id;
  if v_is_official is null then
    raise exception 'community not found';
  end if;
  if v_is_official then
    raise exception '公式コミュニティは削除できません。公式申請の取り下げが必要です。';
  end if;

  -- communities 行を削除。依存テーブルは全て on delete cascade なので連鎖削除される
  -- (上記 NOTE 参照 — 全 FK を実確認済)。
  delete from public.communities where id = p_community_id;
end;
$$;

comment on function public.delete_community(uuid) is
  'コミュニティ削除。owner のみ実行可、公式コミュは block。依存行は FK cascade で連鎖削除。';

-- ============================================================
-- 3) GRANT
-- ============================================================
grant execute on function public.transfer_community_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_community(uuid) to authenticated;

select '0109_community_ownership_lifecycle 完了: transfer_community_ownership + delete_community' as result;
