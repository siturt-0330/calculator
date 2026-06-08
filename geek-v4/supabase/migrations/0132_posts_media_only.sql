-- ============================================================
-- 0132_posts_media_only.sql — メディアのみ投稿(本文テキスト空)を許可
-- ------------------------------------------------------------
-- 症状: 動画/画像だけを添付して本文テキスト空で投稿すると
--   「投稿に失敗しました。再度お試しください。」になる(動画はStorageに上がるが
--    posts への INSERT だけ失敗 = 孤児メディアが残る)。
--
-- 原因: posts_content_check (0075_unify_bbs_posts.sql) が
--     check ( title is not null or length(content) between 1 and 2000 )
--   で、media-only (content='' / title=null) を errcode 23514 で弾いていた。
--   comments は 0104_comments_media.sql で「media があれば本文空OK」に緩和済みだが
--   posts が取り残されていた(非対称)。
--
-- 対応: comments と同方針で、media_urls か video_urls があれば content 空を許可する。
--   クライアント(app/post/create.tsx)は既に media-only 投稿を許可しているので、
--   このDB制約の緩和だけで動画/画像のみ投稿が通る(アプリ側の変更は不要)。
--
-- 冪等: drop constraint if exists → add constraint。CHECK は同一行の別カラムを参照可。
--   ★本番は Supabase SQL エディタで手動適用が必要(他 migration と同様)。
-- ============================================================

alter table public.posts drop constraint if exists posts_content_check;

alter table public.posts add constraint posts_content_check
  check (
    title is not null
    or length(content) between 1 and 2000
    or coalesce(array_length(media_urls, 1), 0) > 0
    or coalesce(array_length(video_urls, 1), 0) > 0
  );

select '0132 完了 — posts: メディア(画像/動画)のみ投稿(本文空)を許可 (content 非空 CHECK を media-aware に緩和。comments 0104 と同方針)' as note;
