-- ============================================================
-- 0112_community_feed_inline_meta.sql
-- ============================================================
-- 目的 (パフォーマンス): get_community_feed の per-post JSON に community 表示メタ
--   (id / name / icon_emoji / icon_color / icon_url / is_official) を inline する。
--
-- 背景:
--   lib/api/communities.ts の fetchMyCommunityPostsRich は get_community_feed RPC を
--   呼んだ後、icon/name 解決のためだけに communities.in() を 2 回目の sequential
--   round-trip で叩いていた。RPC は既に public.communities を LEFT JOIN 済
--   (official_author 判定用) なので、表示メタを同じ JSON に載せれば コミュフィードは
--   1 round-trip で完結する (~80-250ms/RTT の削減)。
--
-- ★ 安全性 (純追加):
--   - body は 0079_gate_community_feed.sql を完全にそのまま踏襲。
--   - IDOR ガード (p_user_id <> auth.uid() で 42501) も dedup/limit/order も無改変。
--   - 追加するのは per-post json の 'community' key 1 つのみ。author_id 等の既存
--     フィールドの挙動は一切変えない (security/privacy の挙動変更なし)。
--   - クライアントは 'community' があればそれを使い、無ければ従来の .in() に fallback
--     するので、この migration が未適用の DB でも壊れない。
--
-- 冪等性: to_regclass で前提テーブル不在ならスキップ / create or replace。
-- ============================================================

do $$
begin
  if to_regclass('public.community_members') is null
     or to_regclass('public.post_communities') is null
     or to_regclass('public.posts') is null
     or to_regclass('public.communities') is null
     or to_regclass('public.profiles') is null then
    raise notice '0112: prerequisite tables missing, skip get_community_feed update';
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
    -- IDOR ガード (0079 から踏襲): 自分以外の UUID を渡したら拒否
    if p_user_id is not null and p_user_id <> auth.uid() then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    v_limit := coalesce(p_limit, 40);
    if v_limit < 1 then v_limit := 1; end if;
    if v_limit > 200 then v_limit := 200; end if;

    if p_user_id is null then
      return json_build_object('posts', '[]'::json);
    end if;

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
                     -- ★ 0112: community 表示メタを inline (client の 2nd round-trip を廃止)
                     'community',
                       case when c.id is null then null else json_build_object(
                         'id', c.id,
                         'name', c.name,
                         'icon_emoji', c.icon_emoji,
                         'icon_color', c.icon_color,
                         'icon_url', c.icon_url,
                         'is_official', coalesce(c.is_official, false)
                       ) end,
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

  grant execute on function public.get_community_feed(uuid, int) to authenticated;
end $$;

select '0112_community_feed_inline_meta 完了: get_community_feed に community メタを inline (1 round-trip / 0079 の IDOR ガード・shape は完全保持)' as result;
