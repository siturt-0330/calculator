-- ============================================================
-- 0105_guard_shadowbanned.sql
-- ------------------------------------------------------------
-- 症状 / 真因:
--   profiles.shadowbanned (migration 0061) は admin_toggle_shadowban() 経由でのみ
--   変更される想定だが、guard_profile_update() (0036 → 0100) はこの列を保護して
--   いなかった。profiles_update ポリシー (0001) は本人行の UPDATE を許すため、
--   シャドウバンされたユーザが自分で
--       update public.profiles set shadowbanned = false where id = auth.uid();
--   を実行してシャドウバンを自己解除できてしまう (モデレーション回避)。
--
-- 対策:
--   guard_profile_update() を 0100 の内容そのままに create or replace し、
--   セキュリティ列の「depth 無関係で常に厳格」ブロックに shadowbanned を追加する。
--   - admin は関数冒頭の v_is_admin 短絡で従来通り通過 (admin_toggle_shadowban も admin 実行)。
--   - 非 admin (=本人含む) の shadowbanned 変更は 42501 で reject。
--   trigger 本体 (guard_profile_update_trg, 0036) はそのまま再利用する (0100 と同流儀)。
--
-- 注意: 既存 migration は編集せず、新規 file で関数のみ差し替える (冪等)。
-- ============================================================

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_is_admin boolean := false;
begin
  begin
    v_is_admin := coalesce(public.is_admin(), false);
  exception when undefined_function then
    v_is_admin := false;
  end;

  if v_is_admin then
    return new;
  end if;

  -- --- セキュリティ / 課金列: depth に関係なく常に厳格 ---
  if new.is_admin is distinct from old.is_admin then
    raise exception 'guard: is_admin can only be changed by admin' using errcode = '42501';
  end if;
  if new.trust_score is distinct from old.trust_score then
    raise exception 'guard: trust_score is maintained by the system' using errcode = '42501';
  end if;
  if new.account_state is distinct from old.account_state then
    raise exception 'guard: account_state is maintained by the system' using errcode = '42501';
  end if;
  if new.plan is distinct from old.plan then
    raise exception 'guard: plan changes via billing flow only' using errcode = '42501';
  end if;
  -- ★ 0105 追加: シャドウバンの自己解除を防ぐ (admin_toggle_shadowban / admin のみ可)
  if new.shadowbanned is distinct from old.shadowbanned then
    raise exception 'guard: shadowbanned can only be changed by admin' using errcode = '42501';
  end if;

  -- --- 派生カウンタ列: トリガ (depth >= 2) なら許可 / 直接 UPDATE (depth = 1) は reject ---
  if new.post_count is distinct from old.post_count then
    if pg_trigger_depth() < 2 then
      raise exception 'guard: post_count is maintained by triggers' using errcode = '42501';
    end if;
  end if;
  if new.comment_count is distinct from old.comment_count then
    if pg_trigger_depth() < 2 then
      raise exception 'guard: comment_count is maintained by triggers' using errcode = '42501';
    end if;
  end if;
  if new.like_received_count is distinct from old.like_received_count then
    if pg_trigger_depth() < 2 then
      raise exception 'guard: like_received_count is maintained by triggers' using errcode = '42501';
    end if;
  end if;
  if new.concern_received_count is distinct from old.concern_received_count then
    if pg_trigger_depth() < 2 then
      raise exception 'guard: concern_received_count is maintained by triggers' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$fn$;

select '0105_guard_shadowbanned 完了' as result;
