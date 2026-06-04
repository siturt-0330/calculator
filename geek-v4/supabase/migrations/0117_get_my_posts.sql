-- ============================================================
-- 0117_get_my_posts.sql — マイページ「自分の投稿一覧」を auth.uid() ベースで返す RPC (de-anon Phase2 2a-1)
-- ============================================================
-- 目的: app/mypage/posts.tsx の fetchMyPosts は `posts.select(...).eq('author_id', auth user id)`
--   で自分の投稿を引いている。Phase2 2b で posts.author_id を REVOKE すると、列の SELECT 権限が
--   無くなり WHERE author_id=... のフィルタ自体が permission denied になる (列フィルタにも SELECT 権が要る)。
--   そこで auth.uid() を server 内で使う security definer RPC に置換する。返却に author_id は含めない
--   (自分の投稿なので秘匿ではないが、client が author_id を一切受け取らない原則を守る)。
--
-- 出力列は fetchMyPosts (mypage/posts.tsx:32-40) の Item と一致: id/content/tag_names/
--   likes_count/comments_count/is_public/created_at。非公開(is_public=false)も自分の分は含む。
--
-- 冪等: CREATE OR REPLACE (top-level 定義。do $$..$$ で包むと SQL editor の splitter が誤分割するため非使用)。
-- ============================================================

create or replace function public.get_my_posts(
  p_limit int default 100
)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_viewer uuid;
  v_limit  int;
  v_result json;
begin
  v_viewer := auth.uid();
  if v_viewer is null then
    return '[]'::json;
  end if;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 200);

  with mine as (
    select p.id, p.content, p.tag_names, p.likes_count, p.comments_count, p.is_public, p.created_at
    from public.posts p
    where p.author_id = v_viewer
    order by p.created_at desc
    limit v_limit
  )
  select coalesce(
    json_agg(
      json_build_object(
        'id',             m.id,
        'content',        m.content,
        'tag_names',      m.tag_names,
        'likes_count',    m.likes_count,
        'comments_count', m.comments_count,
        'is_public',      m.is_public,
        'created_at',     m.created_at
      )
      order by m.created_at desc
    ),
    '[]'::json
  )
  into v_result
  from mine m;

  return v_result;
end;
$fn$;

grant execute on function public.get_my_posts(int) to authenticated;

select '0117_get_my_posts 完了 — マイページ自分投稿一覧を auth.uid() ベース RPC 化 (author_id 非露出, revoke 耐性)' as note;
