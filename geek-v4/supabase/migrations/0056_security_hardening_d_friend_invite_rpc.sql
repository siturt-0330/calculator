-- 0056: security hardening (D) — accept_friend_invite RPC: TOCTOU + 双方向重複 fix
-- ============================================================
-- 旧 RPC の問題:
--   1. 「used_by is null AND expires_at > now()」を含めた行を for update lock
--      していたが、lock 取得後に状態を再評価していなかった (TOCTOU)。
--      → 同時に 2 セッションで accept すると 2 件成立する余地。
--   2. 双方向 (A→B でも B→A でも) の既存 pending を OR で同時 update する条件で
--      取得しており、accept レース中に同一ペアの friendship が 2 行できる
--      可能性があった。
--
-- 修正方針:
--   1. 先に code 単独で lock を取り、lock 後に used_by / expires_at を再評価。
--   2. 既存 accepted があれば invite を consume してエラー応答 (再利用防止)。
--   3. 双方向 pending を limit 1 で取り、見つかれば update / 無ければ insert。
-- ============================================================

set local statement_timeout = '5min';

create or replace function public.accept_friend_invite(code_in text)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  inv record;
  fid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;

  -- 1. 先に lock (used_by / expires_at は問わずに取る)
  select * into inv from public.friend_invites
    where code = code_in
    for update;

  if inv is null then
    return jsonb_build_object('ok', false, 'error', '招待コードが見つかりません');
  end if;

  -- 2. lock 後に状態を再評価 (TOCTOU 防止)
  if inv.used_by is not null then
    return jsonb_build_object('ok', false, 'error', '招待は既に使用されています');
  end if;
  if inv.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', '招待コードの期限が切れています');
  end if;
  if inv.created_by = uid then
    return jsonb_build_object('ok', false, 'error', '自分の招待コードは使えません');
  end if;

  -- 3. 双方向 (A→B でも B→A でも) で accepted があれば invite を consume してエラー
  if exists (
    select 1 from public.friendships
    where status = 'accepted'
      and (
        (requester_id = inv.created_by and recipient_id = uid)
        or (requester_id = uid and recipient_id = inv.created_by)
      )
  ) then
    update public.friend_invites
      set used_by = uid, used_at = now()
      where code = code_in;
    return jsonb_build_object('ok', false, 'error', 'すでに友達です');
  end if;

  -- 4. 双方向 pending を 1 行だけ取り、update or insert
  select id into fid from public.friendships
    where status = 'pending'
      and (
        (requester_id = inv.created_by and recipient_id = uid)
        or (requester_id = uid and recipient_id = inv.created_by)
      )
    limit 1;

  if fid is not null then
    update public.friendships
      set status = 'accepted', accepted_at = now()
      where id = fid;
  else
    insert into public.friendships (requester_id, recipient_id, status, accepted_at)
      values (uid, inv.created_by, 'accepted', now())
      returning id into fid;
  end if;

  -- 5. invite を consume
  update public.friend_invites
    set used_by = uid, used_at = now()
    where code = code_in;

  return jsonb_build_object('ok', true, 'friendship_id', fid);
end;
$$;

grant execute on function public.accept_friend_invite(text) to authenticated;
