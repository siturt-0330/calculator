-- ============================================================
-- 0049_restore_member_count_depth_guard.sql
-- ============================================================
-- Critical regression 修正: コミュニティに参加できない
--
-- 症状:
--   joinCommunity 呼出時に「member_count is maintained by trigger」 が
--   raise されて INSERT into community_members が ROLLBACK → 参加失敗。
--
-- 原因:
--   migration 0048 (community wiki edit) で guard_community_update() を
--   create or replace した際、migration 0030 で入れた pg_trigger_depth()
--   ガードを完全に削除してしまっていた。0048 は wiki 編集 (name / desc
--   解放) の意図のみで member_count 関連には触らないはずだったのに、
--   関数全体を上書きしたため 0030 の修正が消えた。
--
-- 復旧:
--   0030 の depth guard を再導入しつつ、0048 の wiki 編集 (name /
--   description は member も変更可、visibility は owner/admin のみ) も
--   保持する合算版に差し替え。
--
-- trigger 連鎖の動作:
--   1) user joins → INSERT into community_members
--   2) on_community_member_change trigger → UPDATE communities SET member_count
--   3) UPDATE が guard_community_update_trg を発火
--   4) member_count が変わっているが pg_trigger_depth() = 2 → 許可
--   5) → INSERT 成功
--
--   client が直接 UPDATE communities SET member_count を投げた場合
--   (= pg_trigger_depth() = 1) は引き続き reject する。
-- ============================================================

create or replace function public.guard_community_update()
returns trigger language plpgsql security definer as $$
begin
  -- owner/admin なら全部 OK
  if public.is_community_admin(new.id) then
    return new;
  end if;

  -- 一般 member は wiki 編集として:
  --   - name / description / icon は変更可 (0048 で解放)
  --   - visibility は変更不可 (privacy / 招待制の境界 owner/admin のみ)
  --   - created_by は immutable
  if new.visibility is distinct from old.visibility then
    raise exception 'only owner/admin can change visibility';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable';
  end if;

  -- ★ member_count / post_count / last_post_at は count trigger が更新する。
  --   ネストされた trigger の中 (pg_trigger_depth >= 2) なら許可。
  --   depth = 1 (client が直接 UPDATE) なら防ぐ。
  --   ★ 0030 で入れたガードが 0048 で消えていたため、ここで復活させる。
  if new.member_count is distinct from old.member_count then
    if pg_trigger_depth() < 2 then
      raise exception 'member_count is maintained by trigger';
    end if;
  end if;
  if new.post_count is distinct from old.post_count then
    if pg_trigger_depth() < 2 then
      raise exception 'post_count is maintained by trigger';
    end if;
  end if;
  if new.last_post_at is distinct from old.last_post_at then
    if pg_trigger_depth() < 2 then
      raise exception 'last_post_at is maintained by trigger';
    end if;
  end if;

  return new;
end;
$$;

-- trigger 本体 (guard_community_update_trg) は 0019 で作られている、関数だけ差し替え。
-- ============================================================
-- 確認:
-- 1. owner: name / desc / visibility / icon すべて update 可
-- 2. member (owner ではない): name / desc / icon update 可, visibility は raise
-- 3. user が joinCommunity を呼ぶ → INSERT community_members → trigger 連鎖で
--    UPDATE communities SET member_count → depth=2 なので許可 → 参加成功
-- 4. client が直接 UPDATE communities SET member_count を投げる → depth=1 →
--    reject される (悪意ある書き換え防止)
-- ============================================================
