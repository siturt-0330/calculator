-- ============================================================
-- 0142_quote_posts.sql — 引用投稿 (Quote Post)
-- ============================================================
-- X の「引用ツイート」相当。投稿が別の投稿を引用できる。
-- posts.quote_post_id → posts(id) の自己参照FK。
-- 引用投稿は通常投稿と同じ posts 行で表現し、
-- quote_post_id が NULL でない行が引用投稿。
-- ============================================================

alter table public.posts
  add column if not exists quote_post_id uuid
    references public.posts(id) on delete set null;

create index if not exists idx_posts_quote_post_id
  on public.posts (quote_post_id)
  where quote_post_id is not null;

-- 引用元の引用カウントを取得するビュー (オプション)
create or replace view public.post_quote_counts as
  select quote_post_id as post_id, count(*)::int as quote_count
  from public.posts
  where quote_post_id is not null
  group by quote_post_id;

-- get_home_feed / get_for_you_feed はすでに posts.* を返しているので
-- quote_post_id は自動的に含まれる。
-- 引用元の投稿本文はクライアントが post_id で別途取得するか、
-- get_feed_page RPC で一括取得する設計にする。

select '0142_quote_posts 完了 — posts.quote_post_id FK追加' as note;
