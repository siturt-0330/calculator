-- ============================================================
-- 0024_communities_insert_robustness.sql
-- ============================================================
-- 目的: communities INSERT 時の RLS 違反エラーを根本的に防ぐ。
--
-- 既存ポリシー (0017):
--   create policy "communities_insert" ... with check (auth.uid() = created_by);
--
-- このポリシーは
--   1) created_by を client が明示的にセット
--   2) auth.uid() != null
--   3) JWT が PostgREST に正しく転送される
-- 全て揃って初めて通る。実環境では JWT 失効 / 古いセッション / client 側
-- user.id の差し替えなどで弾かれるケースが頻発するため、以下のように緩和する:
--
-- 1) created_by の DEFAULT を auth.uid() にする (client が漏らしても OK)
-- 2) BEFORE INSERT trigger で created_by を強制的に auth.uid() に書き換える
--    (client が他人の id を入れても "なりすまし" できない)
-- 3) ポリシーは「auth.uid() IS NOT NULL」だけに緩和
--    (client が created_by を間違えても trigger が直すので安全)
-- ============================================================

-- 1) DEFAULT を追加 (既存行は影響なし)
alter table public.communities
  alter column created_by set default auth.uid();

-- 2) BEFORE INSERT trigger: created_by を auth.uid() に強制
create or replace function public.communities_set_created_by()
returns trigger language plpgsql security definer as $$
begin
  -- 認証されてないユーザーは弾く
  if auth.uid() is null then
    raise exception 'authentication required to create community';
  end if;
  -- created_by は常に server-side で auth.uid() に上書き
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists communities_set_created_by on public.communities;
create trigger communities_set_created_by
  before insert on public.communities
  for each row execute procedure public.communities_set_created_by();

-- 3) ポリシー緩和: created_by の一致は trigger で保証されるので、
--    RLS では「ログインしているか」だけチェックすれば良い
drop policy if exists "communities_insert" on public.communities;
create policy "communities_insert" on public.communities for insert
  with check (auth.uid() is not null);
