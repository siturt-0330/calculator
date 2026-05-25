-- ============================================================
-- 0048_community_wiki_edit.sql
-- ------------------------------------------------------------
-- 「コミュニティに入っている人はアイコン / 名前 / タグ / 説明欄の変更ができる」
-- = wiki 型編集に解放 (spot wiki edit, migration 0045 と同じ思想)。
--
-- 既存ポリシー (migration 0019):
--   - icon_* → member 誰でも可
--   - name / description / visibility → owner / admin のみ
-- 本 migration:
--   - name / description も member 誰でも可 に解放
--   - visibility は owner / admin のみ keep (privacy / 招待制の境界)
--   - member_count / post_count / created_by は引き続き immutable
--
-- リスク:
--   - 名前変更による spam / vandalism の可能性。が、user 要望ベースで判断、
--     後続で audit log / trust score gate を追加する想定。
--
-- community_tags は migration 0017 で既に member の INSERT/DELETE 可能 → 触らない。
-- ============================================================

create or replace function public.guard_community_update()
returns trigger language plpgsql security definer as $$
begin
  -- owner/admin なら全部 OK
  if public.is_community_admin(new.id) then
    return new;
  end if;

  -- 一般 member は wiki 編集として:
  --   - name / description 変更可 (本 migration で解放)
  --   - visibility 変更不可 (privacy 境界 owner/admin のみ)
  --   - created_by / member_count / post_count は引き続き immutable
  if new.visibility is distinct from old.visibility then
    raise exception 'only owner/admin can change visibility';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable';
  end if;
  if new.member_count is distinct from old.member_count then
    raise exception 'member_count is maintained by trigger';
  end if;
  if new.post_count is distinct from old.post_count then
    raise exception 'post_count is maintained by trigger';
  end if;
  return new;
end;
$$;

-- ============================================================
-- 確認
-- ============================================================
-- 1. owner: name / desc / visibility / icon すべて update できる
-- 2. member (owner ではない): name / desc / icon は update できる、visibility は raise
-- 3. 非 member: 行 select すらできないので update も到達しない
