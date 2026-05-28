-- ============================================================
-- 0079_gate_community_feed.sql
-- ============================================================
-- Audit B#2 (IDOR): get_community_feed(p_user_id, p_limit) は p_user_id を
-- 信頼しすぎており、攻撃者は victim の UUID を渡すだけでその user が所属する
-- community 一覧 (private invite-only 含む) を列挙できた。
--
-- 修正方針:
--   - SECURITY DEFINER は維持 (visibility=community_only post の取得に必要)
--   - 関数頭で auth gate を挟む:
--       p_user_id が NULL でなく、かつ auth.uid() と一致しないなら raise.
--     これにより呼び出し側は自分自身の community feed しか取れなくなる。
--   - 既存の body (0042_get_community_feed_rpc.sql) は完全に保持。
--     正規化 / dedup / json shape は一切変えない。
--
-- 互換性:
--   - シグネチャ (uuid, int) は不変。client は再生成不要。
--   - 自分自身の UUID を渡す or NULL を渡す既存呼び出しは挙動変わらず。
--   - 他人の UUID を渡していたコードがあれば 42501 (insufficient_privilege)
--     で fail する。これは設計通り (IDOR を塞ぐのが目的)。
--
-- Idempotent:
--   - to_regclass で前提テーブル不在ならスキップ。
--   - create or replace なので何度流しても OK。
-- ============================================================

do $$
begin
  -- 前提テーブル不在ならスキップ (CI / 部分セットアップで死なない)
  if to_regclass('public.community_members') is null
     or to_regclass('public.post_communities') is null
     or to_regclass('public.posts') is null
     or to_regclass('public.communities') is null
     or to_regclass('public.profiles') is null then
    raise notice '0079: prerequisite tables missing, skip rpc gating';
    return;
  end if;

  create or replace function public.get_community_feed(
    p_user_id uuid,
    p_limit int default 40
  )
  returns json
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_limit int;
    v_result json;
  begin
    -- ★ Audit B#2 fix: IDOR ガード
    -- p_user_id を渡してきた呼び出しが自分自身でないなら拒否。
    -- (NULL は従来通り「空 result」扱いするので下の guard でハンドル)
    if p_user_id is not null and p_user_id <> auth.uid() then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    -- limit を 1..200 の範囲に正規化 (DoS 防止)
    v_limit := coalesce(p_limit, 40);
    if v_limit < 1 then v_limit := 1; end if;
    if v_limit > 200 then v_limit := 200; end if;

    -- 引数チェック: p_user_id が null なら空を返す
    if p_user_id is null then
      return json_build_object('posts', '[]'::json);
    end if;

    -- 1) my community_ids
    -- 2) post_communities から post_id を新しい attach 順で取得
    --    重複 (同一 post が複数コミュに attach) は最新の attach を採用
    -- 3) posts (POSTS_SELECT_COLS と同列セット)
    -- 4) communities + profiles の join
    -- 5) official_author 判定: c.is_official AND c.official_admin_user_id = p.author_id
    with my_communities as (
      select community_id
        from public.community_members
       where user_id = p_user_id
    ),
    pc_overfetch as (
      select pc.post_id, pc.community_id, pc.created_at,
             row_number() over (
               partition by pc.post_id
               order by pc.created_at desc
             ) as rn
        from public.post_communities pc
       where pc.community_id in (select community_id from my_communities)
       order by pc.created_at desc
       limit greatest(v_limit * 4, 80)
    ),
    pc_dedup as (
      select post_id, community_id, created_at
        from pc_overfetch
       where rn = 1
       order by created_at desc
       limit v_limit
    ),
    post_rows as (
      select
        p.id,
        p.content,
        p.media_urls,
        p.media_blurhashes,
        p.video_urls,
        p.video_durations,
        p.video_posters,
        p.tag_names,
        p.likes_count,
        p.comments_count,
        p.score,
        p.hot_score,
        p.concern_count,
        p.kind,
        p.source_url,
        p.is_public,
        p.trust_score_at_post,
        p.is_anonymous,
        p.content_warning,
        p.cw_category,
        p.visibility,
        p.created_at,
        p.author_id,
        pcd.community_id,
        pcd.created_at as attach_at
        from pc_dedup pcd
        join public.posts p on p.id = pcd.post_id
    )
    select json_build_object(
      'posts',
      coalesce(
        (
          select json_agg(
                   json_build_object(
                     'id', pr.id,
                     'content', pr.content,
                     'media_urls', pr.media_urls,
                     'media_blurhashes', pr.media_blurhashes,
                     'video_urls', pr.video_urls,
                     'video_durations', pr.video_durations,
                     'video_posters', pr.video_posters,
                     'tag_names', pr.tag_names,
                     'likes_count', pr.likes_count,
                     'comments_count', pr.comments_count,
                     'score', pr.score,
                     'hot_score', pr.hot_score,
                     'concern_count', pr.concern_count,
                     'kind', pr.kind,
                     'source_url', pr.source_url,
                     'is_public', pr.is_public,
                     'trust_score_at_post', pr.trust_score_at_post,
                     'is_anonymous', pr.is_anonymous,
                     'content_warning', pr.content_warning,
                     'cw_category', pr.cw_category,
                     'visibility', pr.visibility,
                     'created_at', pr.created_at,
                     'author_id', pr.author_id,
                     'community_id', pr.community_id,
                     'author_nickname',
                       case when pr.is_anonymous then null
                            else prof.nickname end,
                     'official_author',
                       case
                         when c.is_official is true
                          and c.official_admin_user_id is not null
                          and c.official_admin_user_id = pr.author_id
                         then json_build_object(
                                'name', coalesce(c.official_admin_display_name, ''),
                                'organization', coalesce(c.official_organization, '')
                              )
                         else null
                       end
                   )
                   order by pr.attach_at desc
                 )
            from post_rows pr
            left join public.communities c on c.id = pr.community_id
            left join public.profiles prof on prof.id = pr.author_id
        ),
        '[]'::json
      )
    )
    into v_result;

    return v_result;
  end;
  $fn$;

  -- 認証ユーザーのみ実行可 (既存 grant を維持)
  grant execute on function public.get_community_feed(uuid, int) to authenticated;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0079_gate_community_feed 完了: IDOR ガード (auth.uid() != p_user_id で 42501 raise)' as result;
