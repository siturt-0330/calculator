-- ============================================================
-- 0043: 投稿への動画添付サポート
-- ============================================================
-- 既存 posts.media_urls は画像 URL を入れる column として運用してきた。
-- 動画 URL を一緒に入れると、render 側で MIME 判定が必要になる + 取扱が雑になる
-- ので、video_urls を別 column として追加する。video_durations / video_posters も
-- 同時に持つことで thumbnail 表示 / 再生時間 UI を作れる。
--
-- また、現状 posts のメディアは Storage bucket 未設定 (avatars / community-icons
-- のみ存在) で、クライアントがローカル URI を直接 media_urls に書き込んでいる
-- ため "投稿者以外には画像/動画が見えない" 重大バグがあった。
-- ここで `posts-media` bucket を作って RLS を設定する。
-- ============================================================

-- ----------------------------------------------------------------
-- 1. posts に video カラム追加
-- ----------------------------------------------------------------
alter table public.posts
  add column if not exists video_urls       text[]     not null default '{}',
  add column if not exists video_durations  integer[]  not null default '{}',
  add column if not exists video_posters    text[]     not null default '{}';

comment on column public.posts.video_urls       is '添付動画の公開 URL 配列 (posts-media bucket 経由)';
comment on column public.posts.video_durations  is '動画の長さ (秒)。video_urls と同じ index で対応';
comment on column public.posts.video_posters    is '動画のサムネイル URL (任意)。クライアント生成 or storage transform で';

-- ----------------------------------------------------------------
-- 2. posts-media bucket — 画像 + 動画両方を入れる単一バケット
-- ----------------------------------------------------------------
-- file_size_limit は動画に合わせて 100MB に。MIME 制限で image/* と video/* のみ許可。
-- public=true で誰でも取得可能 (匿名 SNS なので意図通り)。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'posts-media',
  'posts-media',
  true,
  100 * 1024 * 1024,
  array[
    -- 画像
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    -- 動画 (主要 MIME — iOS QuickTime / Android MP4 / Web WebM)
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------
-- 3. posts-media の path 規約: '<user_id>/<filename>'
--    avatars と同じ規約。先頭セグメントが auth.uid() と一致しないと insert 不可。
-- ----------------------------------------------------------------
create or replace function public.user_id_from_posts_media_path(p text)
returns uuid language plpgsql immutable as $$
declare
  segs text[];
  s text;
begin
  segs := storage.foldername(p);
  if array_length(segs, 1) is null or array_length(segs, 1) < 1 then
    return null;
  end if;
  s := segs[1];
  if s !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return s::uuid;
exception when others then
  return null;
end;
$$;

-- ----------------------------------------------------------------
-- 4. posts-media RLS — select は public (誰でも見える)、
--    insert/update/delete は path 先頭が自分の user_id のものだけ
-- ----------------------------------------------------------------
drop policy if exists "posts_media_select" on storage.objects;
create policy "posts_media_select" on storage.objects for select using (
  bucket_id = 'posts-media'
);

drop policy if exists "posts_media_insert" on storage.objects;
create policy "posts_media_insert" on storage.objects for insert with check (
  bucket_id = 'posts-media'
  and auth.uid() is not null
  and public.user_id_from_posts_media_path(name) = auth.uid()
);

drop policy if exists "posts_media_update" on storage.objects;
create policy "posts_media_update" on storage.objects for update using (
  bucket_id = 'posts-media'
  and auth.uid() is not null
  and public.user_id_from_posts_media_path(name) = auth.uid()
);

drop policy if exists "posts_media_delete" on storage.objects;
create policy "posts_media_delete" on storage.objects for delete using (
  bucket_id = 'posts-media'
  and auth.uid() is not null
  and public.user_id_from_posts_media_path(name) = auth.uid()
);

-- ----------------------------------------------------------------
-- 5. アカウント削除時の cleanup
-- ----------------------------------------------------------------
-- 0015_account_deletion.sql の delete_account() に依存して、auth.users → cascade で
-- posts も消える。posts 削除時に Storage objects は自動削除されないが、
-- それは別途定期 cleanup ジョブ (orphan removal) の仕事。ここではポリシーまで。
