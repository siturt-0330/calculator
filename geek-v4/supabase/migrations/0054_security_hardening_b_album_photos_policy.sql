-- 0054: security hardening (B) — album_photos select policy 差し替え
-- ============================================================
-- 旧 policy では album_id is null かつ visibility='shared' な孤立写真が
-- album.shared_with_user_ids を経由したサブクエリで「album.id = NULL」になり
-- false にしかならない... ように見えて、現実には album=null の写真も
-- 評価の組み合わせで通り抜ける経路があったため、album 経由 share の枝に
-- 「album_id is not null」ガードを明示的に追加する。
-- shared_with_user_ids による直接 share は album の有無に関係なく許可。
-- ============================================================

set local statement_timeout = '5min';

drop policy if exists "album_photos select" on public.album_photos;

create policy "album_photos select" on public.album_photos
  for select using (
    auth.uid() = owner_id
    or (
      not is_hidden
      and visibility = 'shared'
      and (
        auth.uid() = any(shared_with_user_ids)
        or (
          album_id is not null
          and exists (
            select 1 from public.albums a
            where a.id = album_id
              and a.visibility = 'shared'
              and auth.uid() = any(a.shared_with_user_ids)
          )
        )
      )
    )
  );
