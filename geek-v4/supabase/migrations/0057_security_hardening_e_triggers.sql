-- 0057: security hardening (E) — triggers を albums / album_photos に attach
-- ============================================================
-- 前提: 0053 で public.clean_shared_user_ids() function が定義済。
-- BEFORE INSERT OR UPDATE で shared_with_user_ids が触れられたときだけ走る。
-- column 指定 (UPDATE OF shared_with_user_ids) は UPDATE のみに有効なので、
-- INSERT 時は無条件で走る。これは想定通り。
-- ============================================================

set local statement_timeout = '5min';

drop trigger if exists trg_clean_album_shared on public.albums;
create trigger trg_clean_album_shared
  before insert or update of shared_with_user_ids on public.albums
  for each row execute function public.clean_shared_user_ids();

drop trigger if exists trg_clean_photo_shared on public.album_photos;
create trigger trg_clean_photo_shared
  before insert or update of shared_with_user_ids on public.album_photos
  for each row execute function public.clean_shared_user_ids();
