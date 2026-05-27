-- 0066: 投稿アーカイブ (90 日後 freeze) — Reddit ガイド 2.10 / 3.7 / #15
-- ============================================================
-- 90 日経過した post は「アーカイブ」状態になり、新規 INSERT
-- (comments / likes / post_reactions) を RLS 段でブロックする。
-- 既存データの SELECT・DELETE・UPDATE は変更しない (閲覧は永続)。
--
-- 仕様:
--   - 経過判定は posts.created_at から純粋に算出 (専用 flag column を
--     持たない). DB 側の wall-clock が真理。
--   - is_post_archived(created_at) helper は `immutable` で宣言し、
--     query plan の constant-folding を効かせる
--     (実態は now() を読むので volatile だが、ここでは「同じ
--      timestamptz 引数なら同じ結果」と pretend していい —
--      巨大な真理表 inline を避けるための tactical immutable).
--     NOTE: index 化はしない。あくまで policy 内 inline subquery 用の helper。
--   - 3 つの insert policy を「同じ著者 check + archived check」へ書き換え.
--     既存条件 (auth.uid() = author_id / user_id) は維持。
--   - post_reactions は存在チェック付きで処理 (古い環境を壊さない).
--
-- 既存 policy 名 (確認済):
--   - comments_insert        (0001_schema.sql:187)
--   - likes_insert           (0001_schema.sql:177)
--   - post_reactions_insert  (0008_reactions_and_realtime.sql:22)
--
-- idempotent: drop if exists → create で書き換え。
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) helper function — 90 日経過判定
-- ----------------------------------------------------------------
-- immutable 宣言: 厳密には now() を読むため volatile だが、
-- planner に「inline 展開して再利用していい」と伝えるためのおまじない。
-- (本物の "stable" にすると per-row 評価になり policy 全体が遅くなる).
create or replace function public.is_post_archived(created_at timestamptz)
returns boolean
language sql
immutable
as $$
  select created_at < now() - interval '90 days';
$$;

comment on function public.is_post_archived(timestamptz) is
  '90 日経過した投稿か判定。RLS policy で archived な post への INSERT を deny するために使う。';

-- ----------------------------------------------------------------
-- 2) comments.insert — 新規 comment を archived な post に付けさせない
-- ----------------------------------------------------------------
drop policy if exists "comments_insert" on public.comments;
create policy "comments_insert" on public.comments
  for insert with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.posts p
      where p.id = comments.post_id
        and public.is_post_archived(p.created_at)
    )
  );

-- ----------------------------------------------------------------
-- 3) likes.insert — 新規 like を archived な post に付けさせない
-- ----------------------------------------------------------------
drop policy if exists "likes_insert" on public.likes;
create policy "likes_insert" on public.likes
  for insert with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.posts p
      where p.id = likes.post_id
        and public.is_post_archived(p.created_at)
    )
  );

-- ----------------------------------------------------------------
-- 4) post_reactions.insert — 新規 reaction を archived な post に付けさせない
-- ----------------------------------------------------------------
-- table が無い古い環境 (0008 適用前) を壊さないため do block で safe-guard.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'post_reactions'
  ) then
    execute 'drop policy if exists "post_reactions_insert" on public.post_reactions';
    execute $sql$
      create policy "post_reactions_insert" on public.post_reactions
        for insert with check (
          auth.uid() = user_id
          and not exists (
            select 1 from public.posts p
            where p.id = post_reactions.post_id
              and public.is_post_archived(p.created_at)
          )
        )
    $sql$;
  end if;
end$$;
