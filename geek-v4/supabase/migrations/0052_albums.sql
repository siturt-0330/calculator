-- ============================================================
-- 0052_albums.sql
-- ============================================================
-- 写真アルバム機能 (Phase 1):
--   - photo_visibility enum ('private' | 'shared')
--   - albums table + RLS (owner + 共有相手のみ閲覧可)
--   - album_photos table + RLS (album 単位 / photo 単位 両方の共有をサポート)
--   - refresh_album_photo_count() trigger (photo_count 自動メンテ)
--   - storage bucket 'albums' (10MB, jpeg/png/webp/gif) + storage.objects RLS
--   - albums / album_photos を realtime publication に追加
--
-- spec: docs/MYPAGE_ALBUMS_SPEC.md § 2
-- ============================================================

create type photo_visibility as enum ('private', 'shared');

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 60),
  description text check (length(description) <= 200),
  cover_photo_id uuid,  -- circular FK 回避のため FK 制約は無し
  visibility photo_visibility not null default 'private',
  shared_with_user_ids uuid[] not null default '{}',
  photo_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index albums_owner_idx on public.albums (owner_id, created_at desc);
create index albums_shared_with_idx on public.albums using gin (shared_with_user_ids);

alter table public.albums enable row level security;
create policy "albums select" on public.albums
  for select using (
    auth.uid() = owner_id
    or (visibility = 'shared' and auth.uid() = any(shared_with_user_ids))
  );
create policy "albums insert" on public.albums
  for insert with check (auth.uid() = owner_id);
create policy "albums update" on public.albums
  for update using (auth.uid() = owner_id);
create policy "albums delete" on public.albums
  for delete using (auth.uid() = owner_id);

create table public.album_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  album_id uuid references public.albums(id) on delete set null,
  image_url text not null,
  caption text check (length(caption) <= 500),
  visibility photo_visibility not null default 'private',
  shared_with_user_ids uuid[] not null default '{}',
  is_hidden boolean not null default false,
  width int,
  height int,
  blurhash text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index album_photos_owner_idx on public.album_photos (owner_id, created_at desc);
create index album_photos_album_idx on public.album_photos (album_id, position);
create index album_photos_shared_with_idx on public.album_photos using gin (shared_with_user_ids);

alter table public.album_photos enable row level security;
create policy "album_photos select" on public.album_photos
  for select using (
    auth.uid() = owner_id
    or (
      not is_hidden
      and visibility = 'shared'
      and (
        auth.uid() = any(shared_with_user_ids)
        or exists (
          select 1 from public.albums a
          where a.id = album_id
            and a.visibility = 'shared'
            and auth.uid() = any(a.shared_with_user_ids)
        )
      )
    )
  );
create policy "album_photos insert" on public.album_photos
  for insert with check (auth.uid() = owner_id);
create policy "album_photos update" on public.album_photos
  for update using (auth.uid() = owner_id);
create policy "album_photos delete" on public.album_photos
  for delete using (auth.uid() = owner_id);

-- photo_count trigger
create or replace function public.refresh_album_photo_count()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
begin
  if TG_OP = 'INSERT' and NEW.album_id is not null then
    update public.albums
      set photo_count = photo_count + 1, updated_at = now()
      where id = NEW.album_id;
  elsif TG_OP = 'DELETE' and OLD.album_id is not null then
    update public.albums
      set photo_count = greatest(photo_count - 1, 0), updated_at = now()
      where id = OLD.album_id;
  elsif TG_OP = 'UPDATE' and NEW.album_id is distinct from OLD.album_id then
    if OLD.album_id is not null then
      update public.albums
        set photo_count = greatest(photo_count - 1, 0), updated_at = now()
        where id = OLD.album_id;
    end if;
    if NEW.album_id is not null then
      update public.albums
        set photo_count = photo_count + 1, updated_at = now()
        where id = NEW.album_id;
    end if;
  end if;
  return null;
end;
$$;
create trigger album_photos_count_trg
  after insert or update or delete on public.album_photos
  for each row execute function public.refresh_album_photo_count();

-- storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('albums', 'albums', true, 10 * 1024 * 1024,
          array['image/jpeg','image/png','image/webp','image/gif'])
  on conflict (id) do nothing;

create policy "albums bucket upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'albums' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "albums bucket update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'albums' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "albums bucket delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'albums' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "albums bucket select public" on storage.objects
  for select using (bucket_id = 'albums');

-- realtime
alter publication supabase_realtime add table public.albums;
alter publication supabase_realtime add table public.album_photos;

-- end of 0052_albums.sql
