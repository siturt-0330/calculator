-- ============================================================
-- 0118_get_post_comments.sql — 投稿コメントを author_id 非露出で返す RPC (de-anon Phase2 C1)
-- ============================================================
-- 目的: lib/api/comments.ts の fetchComments は comments を直 select し、author_id と
--   profiles!comments_author_id_fkey(trust_score) の FK join を引いている。Phase2 C5 で
--   comments.author_id を REVOKE すると、この列 select と FK join (= 列を辿る) が
--   permission denied になる。さらに author_id を client に渡している限り profiles_public
--   経由で擬似名→実名の de-anon 経路が残る。
--
--   そこで「コメント表示に必要な情報」を author_id を一切出さずに返す RPC を用意する:
--     - author_token = profiles.pseudonym_id (per-user 安定・非可逆トークン。0116 で追加)
--         client は pseudonymFor(author_token) で擬似名ハンドル/色を導出する。
--         ★ pseudonym_id は profiles_public に無いので token→実名の解決路が存在しない。
--     - is_own  = (コメント著者 == 閲覧者)  … 「自分のコメント」判定・削除導線用
--     - is_op   = (コメント著者 == 投稿者)  … Q&A sort で「投稿者の返信」を上位化する用
--                  (lib/utils/qaSort.ts が従来 author_id 比較でやっていたものを server 供給)
--     - trust_score = 著者の現在の信頼スコア (従来 FK join で取っていた値)
--   author_id / 実 user id は出力に一切含めない。
--
-- 認可: can_view_post(p_post_id) (0023/0038) で「投稿を閲覧できる人にだけコメントを返す」。
--   投稿が見えない viewer には空配列 (コメント経由の漏洩を防ぐ)。
--
-- 出力 shape は types/models.ts の Comment 互換 (author_id を author_token+is_own+is_op に置換):
--   id, post_id, content, avatar_color, created_at, parent_comment_id, reply_to_comment_id,
--   media_urls, author_token, trust_score, is_own, is_op
--
-- DoS 防止: 1 post あたり上限 500 件 (comments.ts の FETCH_COMMENTS_LIMIT と一致)。
-- 冪等: CREATE OR REPLACE (top-level 定義。do $$..$$ で包むと SQL editor の splitter が
--   nested dollar-quote を誤分割するため非使用)。
-- ============================================================

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
  v_viewer      uuid;
  v_limit       int;
  v_post_author uuid;
  v_result      json;
begin
  v_viewer := auth.uid();

  -- 認可: 投稿を閲覧できない人にはコメントも返さない (post の可視性に従う)
  if not public.can_view_post(p_post_id) then
    return '[]'::json;
  end if;

  v_limit := least(greatest(coalesce(p_limit, 500), 1), 500);

  -- is_op 判定用に投稿者を内部取得 (出力には出さない)
  select author_id into v_post_author from public.posts where id = p_post_id;

  with rows as (
    select
      c.id,
      c.post_id,
      c.content,
      c.avatar_color,
      c.created_at,
      c.parent_comment_id,
      c.reply_to_comment_id,
      c.media_urls,
      prof.pseudonym_id                                        as author_token,
      prof.trust_score                                         as trust_score,
      (v_viewer is not null and c.author_id = v_viewer)        as is_own,
      (v_post_author is not null and c.author_id = v_post_author) as is_op
    from public.comments c
    left join public.profiles prof on prof.id = c.author_id
    where c.post_id = p_post_id
    order by c.created_at asc
    limit v_limit
  )
  select coalesce(
    json_agg(
      json_build_object(
        'id',                  r.id,
        'post_id',             r.post_id,
        'content',             r.content,
        'avatar_color',        r.avatar_color,
        'created_at',          r.created_at,
        'parent_comment_id',   r.parent_comment_id,
        'reply_to_comment_id', r.reply_to_comment_id,
        'media_urls',          r.media_urls,
        'author_token',        r.author_token,
        'trust_score',         r.trust_score,
        'is_own',              r.is_own,
        'is_op',               r.is_op
      )
      order by r.created_at asc
    ),
    '[]'::json
  )
  into v_result
  from rows r;

  return v_result;
end;
$fn$;

grant execute on function public.get_post_comments(uuid, int) to authenticated;

select '0118_get_post_comments 完了 — コメントを author_id 非露出 (author_token=pseudonym_id / is_own / is_op / trust_score) で返す RPC' as note;
