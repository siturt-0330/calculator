-- =============================================================================
-- 0154_contest_option_media.sql — 選択肢に画像/動画 ★未適用ドラフト
-- -----------------------------------------------------------------------------
-- 公募(②-a)/ハイブリッド(④)は作品=画像・動画が本体。予想/アンケートの選択肢にも
-- 画像/動画を添えられるようにする。メディアは既存 posts-media bucket(EXIF strip +
-- magic-byte 検証済の lib/media.ts 経由)に置き、URL を contest_options に保存する。
-- ★ 0152 で contest_options の SELECT を「author_id 以外の列 GRANT」に絞ったので、
--   新列も明示 GRANT しないと client が読めない(permission denied for column)。
-- 依存: 0151(contest_options) / 0152(列 SELECT revoke+grant)。
-- =============================================================================

alter table public.contest_options
  add column if not exists media_url  text check (media_url is null or media_url ~ '^https?://'),
  add column if not exists media_type text check (media_type is null or media_type in ('image','video'));

-- ★ 0152 の列 GRANT に新列を追加(でないと client SELECT が壊れる)
grant select (media_url, media_type) on public.contest_options to anon, authenticated;

select '0154_contest_option_media 完了 — contest_options.media_url / media_type 追加 + 列 SELECT GRANT' as note;
