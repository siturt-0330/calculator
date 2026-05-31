-- ============================================================
-- 0102_profiles_cover_url.sql
-- ------------------------------------------------------------
-- 目的:
--   profiles テーブルに cover_url (マイページのカバー画像 URL) を追加。
--   本人が settings/profile-edit から差し替え、mypage の ProfileMasthead が
--   優先表示する。空 (NULL) の場合は従来通り「最新 shared 写真」を fallback。
--
--   既存 storage bucket `avatars` を流用 (path = `{user_id}/cover_{ts}.{ext}`)
--   して別 bucket を作らない方針。policies (owner だけ INSERT/UPDATE 可) は
--   そのまま流用される。
--
--   length check は 1024 文字 (Supabase Storage の公開 URL 長を超えないため
--   十分なマージン)。NULL 許容で空にも戻せる。
-- ============================================================

set local statement_timeout = '5min';

alter table public.profiles
  add column if not exists cover_url text
    check (cover_url is null or length(cover_url) <= 1024);

-- 既存 SELECT policy は profiles 全 column 対象 (profiles_select) なので
-- 追加 column も自動で見える。INSERT / UPDATE policy も同様に owner 限定で
-- そのまま機能する (今回 policy 追加は不要)。

-- profiles_public view (0081) を使っているクライアントは現状 cover_url を
-- 読まない (本人だけが mypage で見るデータ). 必要に応じて view に追加可。
