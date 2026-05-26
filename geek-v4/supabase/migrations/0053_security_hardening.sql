-- 0053: post-launch security hardening (RLS / RPC tightening)
-- ============================================================
-- 0053_security_hardening.sql
-- ============================================================
-- 直近 4 件の脆弱性を塞ぐ:
--   1. album_photos の orphaned photo leak (album_id is null + shared) [CRITICAL]
--   2. albums bucket SELECT が anon / 他フォルダに開放されている [CRITICAL]
--   3. accept_friend_invite RPC の TOCTOU + 双方向重複 friendship [CRITICAL]
--   4. shared_with_user_ids に存在しない user_id が紛れ込む [HIGH]
--
-- 適用順:
--   (A) trigger function (clean_shared_user_ids) を定義
--   (B) policies を DROP → CREATE で差し替え
--       - album_photos select
--       - albums bucket select
--   (C) RPC accept_friend_invite を CREATE OR REPLACE で書き直し
--   (D) triggers を albums / album_photos に attach
--
-- 既存 migration (0051, 0052) は編集禁止 (idempotency 崩壊を避けるため
-- 全修正は本ファイルだけで完結させる)。
-- ============================================================

-- ------------------------------------------------------------
-- (A) trigger function: shared_with_user_ids の auto-clean
-- ------------------------------------------------------------
-- INSERT / UPDATE 時に auth.users に存在しない uuid を array から除外する。
-- INTERSECT は順序を保証しないが shared_with_user_ids の意味的順序は無いので OK。
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

-- ------------------------------------------------------------
-- (B-1) album_photos select policy の差し替え
-- ------------------------------------------------------------
-- 旧 policy では album_id is null かつ visibility='shared' な孤立写真が
-- album.shared_with_user_ids を経由したサブクエリで「album.id = NULL」になり
-- false にしかならない... ように見えて、現実には album=null の写真も
-- 評価の組み合わせで通り抜ける経路があったため、album 経由 share の枝に
-- 「album_id is not null」ガードを明示的に追加する。
-- shared_with_user_ids による直接 share は album の有無に関係なく許可。
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

-- ------------------------------------------------------------
-- (B-2) storage.objects: albums bucket SELECT を厳格化
-- ------------------------------------------------------------
-- 旧 policy "albums bucket select public" は bucket_id = 'albums' のみで
-- すべての object を anon にも公開していたため、他人のフォルダの object
-- パスを推測すれば誰でも read できた。
--
-- bucket 自体は public=true のままにする (既存の image_url を壊さない)。
-- しかし RLS policy で:
--   - to authenticated (anon は弾く)
--   - 自分のフォルダ or album_photos 経由で許可された path
-- に限定する。これで anon の bucket dir 列挙 / 他人 path への access は防げる。
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

-- ------------------------------------------------------------
-- (C) accept_friend_invite RPC: TOCTOU + 双方向重複 fix
-- ------------------------------------------------------------
-- 旧 RPC の問題:
--   1. 「used_by is null AND expires_at > now()」を含めた行を for update lock
--      していたが、lock 取得後に状態を再評価していなかった (TOCTOU)。
--      → 同時に 2 セッションで accept すると 2 件成立する余地。
--   2. 双方向 (A→B でも B→A でも) の既存 pending を OR で同時 update する条件で
--      取得しており、accept レース中に同一ペアの friendship が 2 行できる
--      可能性があった。
--
-- 修正方針:
--   1. 先に code 単独で lock を取り、lock 後に used_by / expires_at を再評価。
--   2. 既存 accepted があれば invite を consume してエラー応答 (再利用防止)。
--   3. 双方向 pending を limit 1 で取り、見つかれば update / 無ければ insert。
create or replace function public.accept_friend_invite(code_in text)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  inv record;
  fid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;

  -- 1. 先に lock (used_by / expires_at は問わずに取る)
  select * into inv from public.friend_invites
    where code = code_in
    for update;

  if inv is null then
    return jsonb_build_object('ok', false, 'error', '招待コードが見つかりません');
  end if;

  -- 2. lock 後に状態を再評価 (TOCTOU 防止)
  if inv.used_by is not null then
    return jsonb_build_object('ok', false, 'error', '招待は既に使用されています');
  end if;
  if inv.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', '招待コードの期限が切れています');
  end if;
  if inv.created_by = uid then
    return jsonb_build_object('ok', false, 'error', '自分の招待コードは使えません');
  end if;

  -- 3. 双方向 (A→B でも B→A でも) で accepted があれば invite を consume してエラー
  if exists (
    select 1 from public.friendships
    where status = 'accepted'
      and (
        (requester_id = inv.created_by and recipient_id = uid)
        or (requester_id = uid and recipient_id = inv.created_by)
      )
  ) then
    update public.friend_invites
      set used_by = uid, used_at = now()
      where code = code_in;
    return jsonb_build_object('ok', false, 'error', 'すでに友達です');
  end if;

  -- 4. 双方向 pending を 1 行だけ取り、update or insert
  select id into fid from public.friendships
    where status = 'pending'
      and (
        (requester_id = inv.created_by and recipient_id = uid)
        or (requester_id = uid and recipient_id = inv.created_by)
      )
    limit 1;

  if fid is not null then
    update public.friendships
      set status = 'accepted', accepted_at = now()
      where id = fid;
  else
    insert into public.friendships (requester_id, recipient_id, status, accepted_at)
      values (uid, inv.created_by, 'accepted', now())
      returning id into fid;
  end if;

  -- 5. invite を consume
  update public.friend_invites
    set used_by = uid, used_at = now()
    where code = code_in;

  return jsonb_build_object('ok', true, 'friendship_id', fid);
end;
$$;
grant execute on function public.accept_friend_invite(text) to authenticated;

-- ------------------------------------------------------------
-- (D) triggers を albums / album_photos に attach
-- ------------------------------------------------------------
-- BEFORE INSERT OR UPDATE で shared_with_user_ids が触れられたときだけ走る。
-- column 指定 (UPDATE OF shared_with_user_ids) は UPDATE のみに有効なので、
-- INSERT 時は無条件で走る。これは想定通り。
drop trigger if exists trg_clean_album_shared on public.albums;
create trigger trg_clean_album_shared
  before insert or update of shared_with_user_ids on public.albums
  for each row execute function public.clean_shared_user_ids();

drop trigger if exists trg_clean_photo_shared on public.album_photos;
create trigger trg_clean_photo_shared
  before insert or update of shared_with_user_ids on public.album_photos
  for each row execute function public.clean_shared_user_ids();

-- end of 0053_security_hardening.sql
