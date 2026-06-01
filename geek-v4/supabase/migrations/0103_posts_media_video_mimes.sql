-- ============================================================
-- 0103_posts_media_video_mimes.sql
-- ------------------------------------------------------------
-- 「動画が投稿できない」問題の保険(サーバ側ブロッカーの排除)。
--
-- 背景:
--   本番 posts-media bucket に動画が一度も上がっていない (video_urls を
--   持つ投稿が 0 件)。クライアント側のアップロード経路は修正済みだが、
--   bucket の allowed_mime_types に動画 MIME が含まれていないと、
--   storage 側で 400 (mime type ... is not allowed) として弾かれ、
--   どれだけクライアントを直しても upload は成功しない。
--
--   bucket を定義するマイグレーションは 0043 のみ で、そこには動画 MIME が
--   含まれている。ただし本番 DB に 0043 の bucket 更新が確実に適用されて
--   いるかは外部 (anon key) からは検証できないため、ここで idempotent に
--   再アサートして「動画 MIME + 100MB」を保証する。
--   既存マイグレーション (0043) は編集しない方針なので新規ファイルで担保する。
--
-- 冪等性:
--   0043 が既に適用済みで設定が正しければ、同じ値での上書きとなり実害なし。
--   設定が画像のみだった場合のみ、ここで動画 MIME が追加される。
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'posts-media',
  'posts-media',
  true,
  100 * 1024 * 1024,  -- 動画に合わせて 100MB (lib/media.ts の MAX_VIDEO_BYTES と一致)
  array[
    -- 画像
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    -- 動画 (iOS QuickTime / Android・Web MP4 / Web WebM / m4v)
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
