-- 0055: security hardening (C) — storage.objects: albums bucket SELECT を厳格化
-- ============================================================
-- ★ このファイルが最も重い (storage.objects の RLS 再評価が走るため、
--   object 数が多いと数十秒 - 数分かかる)。
--   apply 失敗 (Connection terminated due to connection timeout) 時は、
--   Supabase Dashboard → SQL Editor で本ファイルの中身をコピペして
--   実行することで回避可能 (Dashboard 側は statement_timeout が緩い)。
--
-- 旧 policy "albums bucket select public" は bucket_id = 'albums' のみで
-- すべての object を anon にも公開していたため、他人のフォルダの object
-- パスを推測すれば誰でも read できた。
--
-- bucket 自体は public=true のままにする (既存の image_url を壊さない)。
-- しかし RLS policy で:
--   - to authenticated (anon は弾く)
--   - 自分のフォルダ or album_photos 経由で許可された path
-- に限定する。これで anon の bucket dir 列挙 / 他人 path への access は防げる。
-- ============================================================

set local statement_timeout = '10min';

drop policy if exists "albums bucket select public" on storage.objects;

create policy "albums bucket select scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'albums'
    and (
      -- 自分のフォルダ (path 第 1 セグメント = uid)
      (storage.foldername(name))[1] = auth.uid()::text
      -- album_photos 経由で許可されたフォルダ
      or exists (
        select 1 from public.album_photos ap
        where ap.image_url like '%/albums/' || (storage.foldername(name))[1] || '/%'
          and (
            ap.owner_id = auth.uid()
            or (
              ap.visibility = 'shared'
              and auth.uid() = any(ap.shared_with_user_ids)
            )
            or (
              ap.album_id is not null
              and exists (
                select 1 from public.albums a
                where a.id = ap.album_id
                  and a.visibility = 'shared'
                  and auth.uid() = any(a.shared_with_user_ids)
              )
            )
          )
      )
    )
  );
