-- ============================================================
-- 0116_add_pseudonym_id.sql — 匿名擬似名の安定トークン用 列を profiles に追加 (de-anon Phase2 2a-1)
-- ============================================================
-- 目的: client が匿名投稿/コメントの実 author_id を二度と受け取らないようにする土台。
--   現状 pseudonymFor() は author_id(uuid) を FNV ハッシュして擬似名 handle/色 を出すが、Phase2 で
--   posts/comments.author_id を REVOKE するため、代替の「per-user 安定・非可逆」トークンが要る。
--   pseudonym_id = profiles ごとの random uuid (auth user_id とは無相関)。後続 migration で comment 取得
--   RPC 等が匿名 author の author_token として pseudonym_id を返し、client はこれを pseudonymFor に流す。
--   /user 擬似プロフィールも pseudonym_id で解決する (get_pseudo_profile_posts)。
--
-- ★de-anon 防止の不変条件: pseudonym_id は profiles_public(0081) に **絶対に追加しない**。
--   profiles_public は id→nickname を anon/authenticated に公開する oracle。token が join 鍵(id)に
--   現れなければ token→nickname の解決路が存在しない (= 構造的に de-anon 不能)。
--
-- 冪等: add column if not exists + create unique index if not exists (top-level, do ブロック不使用)。
--   NOT NULL + default gen_random_uuid() で既存行は random 値が backfill される。
-- ============================================================

alter table public.profiles
  add column if not exists pseudonym_id uuid not null default gen_random_uuid();

create unique index if not exists profiles_pseudonym_id_key
  on public.profiles (pseudonym_id);

select '0116_add_pseudonym_id 完了 — profiles.pseudonym_id (匿名擬似名トークン用 random uuid) 追加。profiles_public には絶対に追加しないこと' as note;
