-- ============================================================
-- 0131_get_my_posts_media.sql — get_my_posts に カード描画用の title/media/video 列を追加 (de-anon Phase2)
-- ============================================================
-- 背景: 0117_get_my_posts は /mypage/posts.tsx 用に最小列 (id/content/tag_names/likes/comments/
--   is_public/created_at) だけ返していた。マイページ本体タブ app/(tabs)/mypage.tsx は同じ「自分の投稿」を
--   リッチカード (タイトル + 画像/動画サムネ) で描画するため title / media_urls / media_blurhashes /
--   video_urls / video_posters も必要。
--   de-anon Phase2 で mypage の取得を .eq('author_id', uid) から get_my_posts RPC に切替えるにあたり、
--   これらの列が RPC に無いとカードの画像/タイトルが消える (回帰)。そこで RPC を拡張する。
--
-- 互換: 関数シグネチャ get_my_posts(int) は不変。返却 JSON にキーを「追加」するだけなので、
--   既存の text-only 利用 (/mypage/posts.tsx は tag_names を読む) は影響なし。author_id は引き続き非露出。
--   全列が posts に実在: title(0075), media_urls/media_blurhashes(complete_schema), video_urls/
--   video_posters(0043)。
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
    select p.id, p.content, p.title, p.tag_names,
           p.media_urls, p.media_blurhashes, p.video_urls, p.video_posters,
           p.likes_count, p.comments_count, p.is_public, p.created_at
    from public.posts p
    where p.author_id = v_viewer
    order by p.created_at desc
    limit v_limit
  )
  select coalesce(
    json_agg(
      json_build_object(
        'id',               m.id,
        'content',          m.content,
        'title',            m.title,
        'tag_names',        m.tag_names,
        'media_urls',       m.media_urls,
        'media_blurhashes', m.media_blurhashes,
        'video_urls',       m.video_urls,
        'video_posters',    m.video_posters,
        'likes_count',      m.likes_count,
        'comments_count',   m.comments_count,
        'is_public',        m.is_public,
        'created_at',       m.created_at
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

select '0131_get_my_posts_media 完了 — get_my_posts に title/media_urls/media_blurhashes/video_urls/video_posters を追加 (mypage リッチカード回帰防止, author_id 非露出維持)' as note;
