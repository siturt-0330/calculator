-- ============================================================
-- 0018: コミュニティアイコンを写真アップロードに対応
-- ============================================================
-- 変更点:
--   - communities.icon_url カラムを追加 (Supabase Storage の public URL を入れる)
--   - icon_emoji / icon_color は残す (画像アップロード前の placeholder 用 + 削除時の戻し先)
--   - Storage bucket 'community-icons' を作る (public)
--   - bucket RLS:
--       * select: 誰でも (icon は public 表示なので)
--       * insert: 認証ユーザー & そのコミュニティのメンバー (path に community_id を含める)
--       * update: 認証ユーザー & メンバー
--       * delete: 認証ユーザー & メンバー
-- ============================================================

alter table public.communities
  add column if not exists icon_url text;

-- ============================================================
-- Storage bucket 作成 (idempotent)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-icons',
  'community-icons',
  true,
  5 * 1024 * 1024,   -- 5MB max
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- ============================================================
-- Storage RLS — bucket 'community-icons'
-- パス規約: '<community_id>/<filename>'
-- (storage.foldername(name)[1] が community_id になる)
-- ============================================================

-- アイコンは公開 — 誰でも SELECT (アプリ全体で見える)
drop policy if exists "community_icons_select" on storage.objects;
create policy "community_icons_select" on storage.objects for select using (
  bucket_id = 'community-icons'
);

-- INSERT: 認証済 & path[1] が自分の所属する community_id
drop policy if exists "community_icons_insert" on storage.objects;
create policy "community_icons_insert" on storage.objects for insert with check (
  bucket_id = 'community-icons'
  and auth.uid() is not null
  and public.is_community_member((storage.foldername(name))[1]::uuid)
);

-- UPDATE: 同じ条件
drop policy if exists "community_icons_update" on storage.objects;
create policy "community_icons_update" on storage.objects for update using (
  bucket_id = 'community-icons'
  and auth.uid() is not null
  and public.is_community_member((storage.foldername(name))[1]::uuid)
);

-- DELETE: 同じ条件
drop policy if exists "community_icons_delete" on storage.objects;
create policy "community_icons_delete" on storage.objects for delete using (
  bucket_id = 'community-icons'
  and auth.uid() is not null
  and public.is_community_member((storage.foldername(name))[1]::uuid)
);
