-- ============================================================
-- 0125_deanon_rpcs.sql — de-anon Phase 2 / Stage 1 (追加のみ・既存を壊さない)
-- ------------------------------------------------------------
-- 目的: 匿名投稿/コメントの author_id をクライアントに渡さずに済むよう、
--       「pseudonym_id トークン + is_own」で返す SECURITY DEFINER RPC を 2 本追加する。
--       これらは client 改修 (Stage 2) が使う土台。適用しても既存挙動は一切変わらない
--       (新規関数の追加のみ)。実際の漏洩封鎖 (REVOKE) は Stage 3 で別ファイル。
--
-- 依存 (実在確認済み): can_view_post (0023/0038), author_visible (0061),
--   profiles.pseudonym_id (0116, profiles_public には無い=逆引き不能)。
--
-- ★ SECURITY DEFINER なので RLS をバイパスする。可視性は can_view_post /
--   author_visible で必ず明示ガードする (定義者権限の越権防止)。
-- 冪等: create or replace。重複適用で error にならない。
-- ============================================================

-- ------------------------------------------------------------
-- 1) get_pseudo_profile_posts — 擬似プロフィールの公開投稿一覧
--    入力は pseudonym_id (ランダム uuid トークン)。実 author_id はサーバ内でだけ
--    解決し、返り値には一切含めない。is_own のみ返す。
-- ------------------------------------------------------------
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
  v_author uuid;
  v_avatar_url text;
  v_avatar_emoji text;
  v_limit  int;
  v_posts json;
begin
  v_viewer := auth.uid();
  v_limit  := least(greatest(coalesce(p_limit, 30), 1), 60);

  -- token → 実 author_id + アバターは server 内でだけ解決 (author_id は client に返さない)
  select id, avatar_url, avatar_emoji
    into v_author, v_avatar_url, v_avatar_emoji
  from public.profiles where pseudonym_id = p_pseudonym_id;
  if v_author is null then
    return json_build_object('avatar_url', null, 'avatar_emoji', null, 'posts', '[]'::json);
  end if;

  with their_posts as (
    select p.id, p.content, p.title, p.media_urls, p.media_blurhashes,
           p.video_urls, p.video_posters, p.likes_count, p.comments_count,
           p.is_public, p.created_at,
           (v_viewer is not null and p.author_id = v_viewer) as is_own
    from public.posts p
    where p.author_id = v_author
      and (
        p.author_id = v_viewer                                  -- 自分の投稿は非公開も見える
        or (public.can_view_post(p.id) and public.author_visible(p.author_id))
      )
    order by p.created_at desc
    limit v_limit
  )
  select coalesce(json_agg(
           json_build_object(
             'id', tp.id, 'content', tp.content, 'title', tp.title,
             'media_urls', tp.media_urls, 'media_blurhashes', tp.media_blurhashes,
             'video_urls', tp.video_urls, 'video_posters', tp.video_posters,
             'likes_count', tp.likes_count, 'comments_count', tp.comments_count,
             'is_public', tp.is_public, 'created_at', tp.created_at,
             'is_own', tp.is_own
           ) order by tp.created_at desc
         ), '[]'::json)
    into v_posts
  from their_posts tp;

  -- 擬似プロフィールのヘッダ用に avatar も同梱 (author_id は出さない)
  return json_build_object(
    'avatar_url', v_avatar_url,
    'avatar_emoji', v_avatar_emoji,
    'posts', v_posts
  );
end;
$fn$;
grant execute on function public.get_pseudo_profile_posts(uuid, int) to anon, authenticated;

-- ------------------------------------------------------------
-- 2) get_post_comments — コメントを author_token(pseudonym_id) + is_own で返す
--    author_id は返さない。pseudonym_id は profiles_public に無いので
--    token→nickname の逆引き経路が構造的に存在しない。
-- ------------------------------------------------------------
create or replace function public.get_post_comments(
  p_post_id uuid,
  p_limit int default 500
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
  v_limit  := least(greatest(coalesce(p_limit, 500), 1), 500);

  -- 親 post が閲覧可能なときだけコメントを返す (定義者権限の越権防止)
  if not (
    public.can_view_post(p_post_id)
    or exists (select 1 from public.posts p where p.id = p_post_id and p.author_id = v_viewer)
  ) then
    return json_build_object('comments', '[]'::json);
  end if;

  with rows as (
    select c.id, c.post_id, c.content, c.avatar_color, c.created_at,
           c.parent_comment_id, c.reply_to_comment_id, c.media_urls,
           prof.trust_score   as trust_score,
           prof.avatar_url    as avatar_url,      -- 本人アイコン (擬似人格として表示)
           prof.avatar_emoji  as avatar_emoji,
           prof.pseudonym_id  as pseudonym_id,   -- ★ author_id は返さない (擬似ハンドルの種)
           (v_viewer is not null and c.author_id = v_viewer) as is_own
    from public.comments c
    join public.profiles prof on prof.id = c.author_id
    where c.post_id = p_post_id
    order by c.created_at asc
    limit v_limit
  )
  select json_build_object('comments', coalesce(json_agg(
           json_build_object(
             'id', r.id, 'post_id', r.post_id, 'content', r.content,
             'avatar_color', r.avatar_color, 'created_at', r.created_at,
             'parent_comment_id', r.parent_comment_id,
             'reply_to_comment_id', r.reply_to_comment_id,
             'media_urls', r.media_urls, 'trust_score', r.trust_score,
             'avatar_url', r.avatar_url, 'avatar_emoji', r.avatar_emoji,
             'pseudonym_id', r.pseudonym_id, 'is_own', r.is_own
           ) order by r.created_at asc
         ), '[]'::json))
    into v_result
  from rows r;

  return v_result;
end;
$fn$;
grant execute on function public.get_post_comments(uuid, int) to anon, authenticated;

select '0125 完了 — get_pseudo_profile_posts / get_post_comments を追加 (追加のみ・既存挙動は不変)。Stage 2 (client) が使う土台。' as note;
