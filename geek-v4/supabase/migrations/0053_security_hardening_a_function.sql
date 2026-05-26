-- 0053: security hardening (A) — trigger function 定義のみ
-- ============================================================
-- 0053-0057 は元の単一 0053_security_hardening.sql を分割したもの。
-- 「storage.objects RLS rebuild で statement_timeout に当たって接続が
-- timeout する」事故を避けるため、独立 transaction で 1 つずつ apply
-- できるようにする。
--
-- 適用順:
--   0053 → 0054 → 0055 → 0056 → 0057
--
-- 各ファイル先頭で statement_timeout を緩めるが、これは現在 transaction
-- 内でのみ有効 (SET LOCAL)。supabase db push / SQL Editor どちらでも
-- 安全に使える。
-- ============================================================

set local statement_timeout = '5min';

-- ------------------------------------------------------------
-- trigger function: shared_with_user_ids の auto-clean
-- ------------------------------------------------------------
-- INSERT / UPDATE 時に auth.users に存在しない uuid を array から除外する。
-- INTERSECT は順序保証なしだが shared_with_user_ids の意味的順序は無いので OK。
create or replace function public.clean_shared_user_ids()
returns trigger language plpgsql
set search_path = public, pg_catalog as $$
begin
  if NEW.shared_with_user_ids is not null
     and array_length(NEW.shared_with_user_ids, 1) > 0 then
    NEW.shared_with_user_ids := array(
      select unnest(NEW.shared_with_user_ids)
      intersect
      select id from auth.users
    );
  end if;
  return NEW;
end;
$$;
