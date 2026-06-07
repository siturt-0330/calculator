-- ============================================================
-- 0130_get_my_comments.sql — マイページ「自分のコメント一覧」を auth.uid() ベースで返す RPC (de-anon Phase2)
-- ============================================================
-- 目的: lib/api/comments.ts の fetchMyComments は `comments.select(...).eq('author_id', auth user id)`
--   で自分のコメントを引いている。Phase2 (0129) で comments.author_id を REVOKE すると、列の SELECT 権限
--   が無くなり WHERE author_id=... のフィルタ自体が permission denied になる (列フィルタにも SELECT 権が要る)。
--   そこで auth.uid() を server 内で使う security definer RPC に置換する。返却に author_id は含めない
--   (自分のコメントなので秘匿ではないが、client が author_id を一切受け取らない原則を守る)。
--
-- 出力は fetchMyComments の MyCommentRow と一致: id/post_id/content/created_at/media_urls/
--   parent_comment_id に加え、出典 post (id/title/content/media_urls) を server 側で join して同梱する
--   (client の 2 段 fetch を 1 RTT に畳む)。post が閲覧不可/削除でも自分のコメント本文は返す (post=null)。
--
-- 依存 (実在確認済み): comments.author_id / posts (id,title,content,media_urls)。
--   SECURITY DEFINER なので RLS をバイパスするが、author_id = auth.uid() で必ず自分の行のみに限定する
--   (定義者権限の越権防止)。post embed も自分のコメントが指す post に限る。
--
-- 冪等: CREATE OR REPLACE (top-level 定義。do $$..$$ で包むと SQL editor の splitter が誤分割するため非使用)。
-- model: 0117_get_my_posts.sql。
-- ============================================================

create or replace function public.get_my_comments(
  p_limit int default 50
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
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  with mine as (
    select c.id, c.post_id, c.content, c.created_at, c.media_urls, c.parent_comment_id
    from public.comments c
    where c.author_id = v_viewer
    order by c.created_at desc
    limit v_limit
  )
  select coalesce(
    json_agg(
      json_build_object(
        'id',                m.id,
        'post_id',           m.post_id,
        'content',           m.content,
        'created_at',        m.created_at,
        'media_urls',        m.media_urls,
        'parent_comment_id', m.parent_comment_id,
        -- 出典 post を同梱 (削除/非存在なら null)。author_id は出さない。
        'post', (
          select json_build_object(
            'id',         p.id,
            'title',      p.title,
            'content',    p.content,
            'media_urls', p.media_urls
          )
          from public.posts p
          where p.id = m.post_id
        )
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

grant execute on function public.get_my_comments(int) to authenticated;

select '0130_get_my_comments 完了 — マイページ自分コメント一覧を auth.uid() ベース RPC 化 (author_id 非露出, revoke 耐性, 出典 post 同梱)' as note;
