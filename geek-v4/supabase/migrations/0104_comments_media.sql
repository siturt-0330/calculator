-- ============================================================
-- 0104_comments_media.sql — コメントに画像/動画を添付できるようにする
-- ------------------------------------------------------------
-- 全画面コメント作成画面 (app/post/comment.tsx) から、コメントにも
-- 画像・動画 (posts-media bucket に upload 済みの公開 URL) を添付できる
-- ようにするため、comments テーブルに media_urls 配列を追加する。
--   - 既存行は空配列 (default '{}') 扱い。
--   - クライアント (lib/api/comments.ts) は列が無くても動くよう段階 fallback
--     しているが、この migration 適用後にメディア付きコメントが保存・表示できる。
--   - RLS は行ポリシーがそのまま適用される (列追加でポリシー変更は不要)。
-- 冪等: IF NOT EXISTS で二重適用しても安全。
-- ============================================================

alter table public.comments
  add column if not exists media_urls text[] not null default '{}';

-- content の CHECK を緩和: メディア添付があれば本文は空でも可 (Instagram 風の
-- 「画像/動画だけのコメント」を許可)。本文がある場合は従来どおり 1..1000 文字。
-- (posts 側の 0075 と同じ方針。最大長 1000 は media 有無に関わらず維持する)
alter table public.comments drop constraint if exists comments_content_check;
alter table public.comments add constraint comments_content_check
  check (
    length(content) <= 1000
    and (length(content) >= 1 or coalesce(array_length(media_urls, 1), 0) > 0)
  );
