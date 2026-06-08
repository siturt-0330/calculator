-- ============================================================
-- 0135: コミュニティのオーナー(管理権) 譲渡
-- ============================================================
-- 背景:
--   community_members.role は 'owner'/'admin'/'member' (0017)。owner は唯一 1 名。
--   既に member→admin の昇格 / admin→member の降格 (0069) はあるが、
--   「owner そのものを別メンバーへ譲渡する」手段が無かった。これを追加する。
--   (communities.created_by は immutable=作成者の記録。所有権は role ベースなので
--    created_by は触らず、role の入れ替えで譲渡する。)
--
-- 設計:
--   - 現 owner 本人だけが譲渡可 (is_community_owner で判定)。
--   - 譲渡先は同コミュニティの member or admin (= メンバーであること)。自分自身は不可。
--   - ★原子的に: 旧 owner → 'admin' / 新 owner → 'owner' を 1 関数(=1 トランザクション)で
--     入れ替える。owner が 0 名/2 名になる窓を外部セッションに見せない。
--   - 旧 owner は 'admin' に降りる (締め出さず mod 権限は維持。完全に退く場合は別途 demote)。
--   - security definer + search_path 固定 (RLS bypass しても owner 判定で守る)。冪等。
--   ★本番は Supabase SQL エディタで手動適用が必要 (他 migration と同様)。
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) mod_action_logs.action の check 制約に 'transfer_owner' を追加
--    (0068 は inline column check = 既定名 mod_action_logs_action_check)。
--    drop if exists → 全 action を列挙して add (冪等)。
-- ----------------------------------------------------------------
alter table public.mod_action_logs drop constraint if exists mod_action_logs_action_check;
alter table public.mod_action_logs add constraint mod_action_logs_action_check
  check (action in (
    'delete_post', 'delete_comment', 'delete_bbs_reply',
    'kick', 'ban', 'unban', 'promote', 'demote', 'transfer_owner'
  ));

-- ----------------------------------------------------------------
-- 2) mod_transfer_ownership — owner を別メンバーへ譲渡
-- ----------------------------------------------------------------
create or replace function public.mod_transfer_ownership(
  target_community_id uuid,
  new_owner_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_role text;
  v_is_official boolean;
begin
  -- 現 owner 本人のみ。
  if not public.is_community_owner(target_community_id) then
    raise exception 'owner only';
  end if;
  if new_owner_id = auth.uid() then
    raise exception 'cannot transfer to yourself';
  end if;

  -- ★公式コミュニティは owner ロール譲渡を禁止 (0109 と同方針)。
  --   公式は official_admin_user_id + 公式表示名 (0032) を持ち、role の譲渡では
  --   それらが移らず official_admin と role-owner が desync する (部分乗っ取り) ため。
  select is_official into v_is_official from public.communities where id = target_community_id;
  if coalesce(v_is_official, false) then
    raise exception 'cannot transfer ownership of an official community';
  end if;

  select role into target_role from public.community_members
  where community_id = target_community_id and user_id = new_owner_id;

  if target_role is null then
    raise exception 'user is not a member';
  end if;
  if target_role = 'owner' then
    raise exception 'already owner';
  end if;
  -- ★BAN 済みユーザーには譲渡しない (kick/ban フローとの整合・防御)。
  if exists (
    select 1 from public.community_bans
    where community_id = target_community_id and user_id = new_owner_id
  ) then
    raise exception 'cannot transfer to a banned user';
  end if;

  -- ★原子的に所有権を入れ替える (同一トランザクション内なので中間状態は外から見えない)。
  --   旧 owner は 'admin' に (締め出さない)。新 owner を 'owner' に。
  update public.community_members
  set role = 'admin'
  where community_id = target_community_id and user_id = auth.uid();

  update public.community_members
  set role = 'owner'
  where community_id = target_community_id and user_id = new_owner_id;

  insert into public.mod_action_logs (
    community_id, mod_user_id, target_user_id, action
  ) values (
    target_community_id, auth.uid(), new_owner_id, 'transfer_owner'
  );
end;
$$;

comment on function public.mod_transfer_ownership(uuid, uuid) is
  '現 owner が owner 権限を別メンバーへ譲渡 (旧 owner は admin に降りる)。owner のみ実行可・原子的。';

-- ----------------------------------------------------------------
-- 3) community_members の直接 UPDATE を revoke (defense-in-depth)
--    role 変更は SECURITY DEFINER RPC (promote/demote/transfer = 関数 owner 権限で
--    実行) のみを正規経路とする。現状 community_members に UPDATE policy は無く RLS で
--    既に deny されているが、将来うっかり UPDATE policy を足しても self-escalation
--    (自分の role を owner に書換) を防ぐため明示的に revoke しておく。
--    ★DEFINER RPC は関数 owner 権限で動くため、この revoke の影響を受けない
--    (promote/demote/transfer は引き続き動作する)。
-- ----------------------------------------------------------------
revoke update on public.community_members from authenticated;
revoke update on public.community_members from anon;

-- ----------------------------------------------------------------
-- 4) GRANT
-- ----------------------------------------------------------------
grant execute on function public.mod_transfer_ownership(uuid, uuid) to authenticated;

select '0135 完了 — mod_transfer_ownership(owner 譲渡) 追加 + mod_action_logs に transfer_owner' as note;
