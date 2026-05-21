-- ============================================================
-- 0030_fix_community_member_count_guard.sql
-- ============================================================
-- 致命的バグ修正: コミュニティに参加できない
--
-- 症状:
--   joinCommunity 呼出時に「member_count is maintained by trigger」 エラー
--   が出てユーザーが coleridge コミュニティに参加できない。
--
-- 原因 (trigger 連鎖):
--   1) user joins → INSERT into community_members
--   2) on_community_member_change trigger → UPDATE communities SET member_count
--   3) その UPDATE が guard_community_update_trg を発火
--   4) guard 内で「member_count is distinct from old」 を検知して raise
--   5) → INSERT が ROLLBACK → 参加失敗
--
-- 修正:
--   pg_trigger_depth() で 「我々はネストされた trigger の中にいる」 を検知。
--   depth > 1 (= 別の trigger から呼ばれた UPDATE) なら member_count /
--   post_count の変更を許可する。
--   client が直接 UPDATE する (= depth = 1) ケースだけ防ぐ。
-- ============================================================

create or replace function public.guard_community_update()
returns trigger language plpgsql security definer as $$
begin
  -- owner/admin なら全部 OK
  if public.is_community_admin(new.id) then
    return new;
  end if;
  -- それ以外 (= 一般 member) は name / description / visibility / created_by を
  -- 変えてはいけない
  if new.name is distinct from old.name then
    raise exception 'only owner/admin can change name';
  end if;
  if new.description is distinct from old.description then
    raise exception 'only owner/admin can change description';
  end if;
  if new.visibility is distinct from old.visibility then
    raise exception 'only owner/admin can change visibility';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable';
  end if;
  -- member_count / post_count は count trigger が更新する。
  -- ネストされた trigger の中 (pg_trigger_depth >= 2) なら許可。
  -- depth = 1 (client が直接 UPDATE) なら防ぐ。
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
  -- last_post_at も同じく count trigger 由来なら許可
  if new.last_post_at is distinct from old.last_post_at then
    if pg_trigger_depth() < 2 then
      raise exception 'last_post_at is maintained by trigger';
    end if;
  end if;
  return new;
end;
$$;

-- trigger 自体は 0019 で作られている、関数だけ差し替えれば OK
-- ============================================================
