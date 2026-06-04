-- ============================================================
-- 0119_get_pseudo_profile_posts.sql — 擬似名プロフィールの投稿一覧 RPC (de-anon Phase2 C1)
-- ============================================================
-- 目的: app/user/[id].tsx (擬似名プロフィール) は route param の id を author_id とみなし、
--   components/mypage/UserPostsList.tsx の fetchPostsByAuthor が
--   `posts.select(...).eq('author_id', id)` で当人の公開投稿を引いている。
--
--   de-anon Phase2 では:
--     - コメント/投稿のハンドルをタップした時に渡す id を 実 author_id → pseudonym_id に変える
--       (author_token = pseudonym_id を get_post_comments / feed が返す)。
--     - C5 で posts.author_id を REVOKE すると .eq('author_id', ...) が permission denied になる。
--   そこで pseudonym_id を受け取り、server 内部で pseudonym_id → 実 author_id を解決して
--   当人の「閲覧者から見える投稿」を返す RPC を用意する。author_id は出力に含めない。
--
-- 可視性 (SECURITY DEFINER なので RLS は自動適用されない → 明示的に再現):
--   - 自分自身のプロフィールなら非公開投稿も含める (author_id = viewer)。
--   - 他人なら can_view_post(post_id) (0023/0038) が true の投稿のみ (is_public /
--     community_public 等の既存ポリシーと一致)。
--
-- 出力 shape は UserPostsList の UserPost と一致 (author_id なし):
--   id, content, title, media_urls, likes_count, comments_count, is_public, created_at
--
-- 冪等: CREATE OR REPLACE (top-level 定義。do $$..$$ は SQL editor の splitter 対策で非使用)。
-- ============================================================

create or replace function public.get_pseudo_profile_posts(
  p_pseudonym_id uuid,
  p_limit int default 30
)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_viewer uuid;
  v_target uuid;
  v_limit  int;
  v_result json;
begin
  v_viewer := auth.uid();
  v_limit  := least(greatest(coalesce(p_limit, 30), 1), 100);

  -- pseudonym_id → 実 author_id を内部解決 (出力には author_id を出さない)
  select id into v_target from public.profiles where pseudonym_id = p_pseudonym_id;
  if v_target is null then
    return '[]'::json;
  end if;

  with rows as (
    select
      p.id,
      p.content,
      p.title,
      p.media_urls,
      p.likes_count,
      p.comments_count,
      p.is_public,
      p.created_at
    from public.posts p
    where p.author_id = v_target
      -- 自分の投稿は全て / 他人は可視のもののみ
      and (
        (v_viewer is not null and p.author_id = v_viewer)
        or public.can_view_post(p.id)
      )
    order by p.created_at desc
    limit v_limit
  )
  select coalesce(
    json_agg(
      json_build_object(
        'id',             r.id,
        'content',        r.content,
        'title',          r.title,
        'media_urls',     r.media_urls,
        'likes_count',    r.likes_count,
        'comments_count', r.comments_count,
        'is_public',      r.is_public,
        'created_at',     r.created_at
      )
      order by r.created_at desc
    ),
    '[]'::json
  )
  into v_result
  from rows r;

  return v_result;
end;
$fn$;

grant execute on function public.get_pseudo_profile_posts(uuid, int) to authenticated;

select '0119_get_pseudo_profile_posts 完了 — 擬似名(pseudonym_id)の公開投稿一覧を author_id 非露出で返す RPC' as note;
