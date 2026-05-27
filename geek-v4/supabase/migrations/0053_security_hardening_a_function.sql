-- 0053: security hardening (A) — trigger function 定義のみ
-- ============================================================
-- 0053-0057 は元の単一 0053_security_hardening.sql を分割したもの。
-- Dashboard SQL Editor / supabase db push どちらでも安全に実行できるよう、
-- `SET LOCAL statement_timeout` は使わない (Dashboard は auto-commit のため
-- SET LOCAL が次 statement に伝播しない)。
--
-- 適用順:
--   0053 → 0054 → 0055 → 0056 → 0057
--
-- 各 file は idempotent (DROP IF EXISTS / CREATE OR REPLACE).
-- ============================================================

-- ------------------------------------------------------------
-- trigger function: shared_with_user_ids の auto-clean
-- ------------------------------------------------------------
-- INSERT / UPDATE 時に public.profiles に存在しない uuid を array から除外する。
-- 旧版は auth.users を参照していたが、auth schema は role 権限上 read で
-- 不安定なケースがあるため public.profiles を使う (profiles.id は
-- auth.users.id と 1:1 FK 関係なので意味的に等価)。
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
      select id from public.profiles
    );
  end if;
  return NEW;
end;
$$;
