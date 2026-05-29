-- ============================================================
-- 0100_fix_profile_counter_depth_guard.sql
-- ------------------------------------------------------------
-- 症状:
--   いいね / いいね取消 (public.likes への INSERT/DELETE) が
--     ERROR: 42501: guard: like_received_count is maintained by triggers
--   で失敗する。投稿 (post_count) / コメント (comment_count) /
--   気になる (concern_received_count) でも同型の失敗が起きうる。
--
-- 真因:
--   guard_profile_update() (migration 0036) が profiles の「派生カウンタ列」
--     post_count / comment_count / like_received_count / concern_received_count
--   を *非 admin なら無条件で reject* していた。
--   これらは update_likes_count() 等の AFTER トリガが author の profile を
--   UPDATE して維持する列で、トリガは呼び出しユーザの権限で実行される。
--   そのため一般ユーザ (Supabase SQL Editor では auth.uid()=NULL=非 admin 扱い)
--   の操作だと、トリガ経由の *正当な* カウンタ更新まで guard が巻き添えで
--   reject していた。
--   トリガ連鎖の実際:
--     1) DELETE public.likes              (depth 0)
--     2) → update_likes_count() トリガ発火  (depth 1)
--     3) → UPDATE public.profiles SET like_received_count = ...
--     4) → guard_profile_update_trg 発火    (depth 2) → 無条件 reject ←ここ
--   migration 0075 / 0099 は「guard を一時 disable してから一括 UPDATE」で
--   凌いでいたが、それは migration 自身の直接 UPDATE (depth 1) 用の回避策で、
--   ランタイムのユーザ操作 (depth 2) は救えていなかった。
--
-- 対策:
--   community 側で既に確立しているパターン (0030 / 0049 の
--   guard_community_update) と同じく pg_trigger_depth() で判定する。
--     - ネストしたトリガ内 (depth >= 2) の更新 = 正当なカウンタ維持 → 許可
--     - client / SQL Editor からの直接 UPDATE (depth = 1) = 改ざん → reject 継続
--   これにより「カウンタは本人が直接書き換えられない」という 0036 の
--   防御意図は保ったまま、トリガ経由のカウンタ更新だけを通す。
--
-- 注意:
--   - 既存 migration の編集は禁止 (冪等性が崩れる) ため、新規 file で
--     関数だけを create or replace で差し替える。trigger 本体
--     (guard_profile_update_trg) は 0036 のものをそのまま使う (0049 と同じ流儀)。
--   - is_admin / trust_score / account_state / plan は system / admin / billing が
--     管理する列なので depth 例外は付けず *厳格なまま* (0049 と同じ思想)。
--     将来これらがトリガ経由で更新される設計になったら、同じ depth パターンを
--     個別に足せばよい。
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
  -- is_admin() が定義されていれば admin 判定 (未定義環境でも壊れないよう保護)
  begin
    v_is_admin := coalesce(public.is_admin(), false);
  exception when undefined_function then
    v_is_admin := false;
  end;

  if v_is_admin then
    return new;
  end if;

  -- --- セキュリティ / 課金列: depth に関係なく常に厳格 (従来通り) ---
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

  -- --- 派生カウンタ列: トリガ (depth >= 2) なら許可 / 直接 UPDATE (depth = 1) は reject ---
  --   update_post_count / update_comments_count / update_likes_count /
  --   update_concern_count などの AFTER トリガが author profile を更新する経路を通す。
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

-- ============================================================
-- 期待挙動 (確認用):
--   1. 一般ユーザがいいね      → INSERT likes → update_likes_count (depth 2) → 許可
--   2. 一般ユーザがいいね取消  → DELETE likes → update_likes_count (depth 2) → 許可
--   3. 投稿 / コメント / 気になるのカウンタも同様にトリガ経由なら通る
--   4. 直接 UPDATE profiles SET like_received_count = 9999 (depth 1) → 42501 で reject
--   5. trust_score / account_state / is_admin / plan は非 admin から変更不可 (従来通り)
-- ============================================================
select '0100_fix_profile_counter_depth_guard 完了' as result;
