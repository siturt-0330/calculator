-- ============================================================
-- 0115_mask_feed_author_add_isown.sql — フィード RPC の匿名 author_id 漏洩を封じる
-- ============================================================
-- ⚠️ レビュー必須: SECURITY DEFINER で投稿本文を返す関数2本を CREATE OR REPLACE する。
--
-- 背景 (確認済みの重大な匿名性ホール):
--   get_feed_page(0107) と get_community_feed(0112) は is_anonymous=true の投稿でも
--   実 author_id を非マスクで返していた。author_id は profiles_public ビュー(0081,
--   anon/authenticated に grant)で nickname に解決できるため、「匿名で書いた人」を
--   実名特定できる de-anon ホールになっていた。これは 0076 で一度マスクしたが
--   0078(get_feed_page)/0079(get_community_feed) の gate 追加時に 0075 body ベースに
--   したためマスクが落ち、carry-forward されていた回帰。検索タブの 0113 のみ正しくマスク。
--
-- 本 migration (Phase 1 — 非破壊):
--   両 RPC の出力 author_id を 0113:151-157 / 0076 と逐語一致の CASE マスクに統一し
--   (is_anonymous かつ viewer 本人以外 → null)、さらに is_own boolean を追加する。
--   is_own は client の `post.author_id === me` 判定を server 供給へ置換するためのもの
--   (Phase 2 で posts.author_id を列 revoke すると client は author_id を取得できなくなる)。
--   ★ body はそれぞれ 0107 / 0112 を完全に踏襲し、変更は (a) v_viewer:=auth.uid() の追加、
--      (b) author_id 出力の CASE マスク、(c) 'is_own' 1 キー追加、の3点のみ。可視性述語・
--      IDOR gate・clamp・order・dedup・official_author 解決は一切変えない。
--   official_author は両 RPC とも CTE/case で「マスク前の実 author_id」で解決済なので、
--   出力 author_id をマスクしても公式投稿の表示は壊れない (検証済)。
--
-- 冪等: CREATE OR REPLACE (top-level 定義。do $$..$$ で包むと一部 SQL editor の statement
--   splitter が nested dollar-quote を誤分割し "syntax error at uuid" になるため非使用)。
-- ============================================================

-- ★ 関数は top-level で定義 (do $$..$$ で包むと SQL editor の splitter が nested
--   dollar-quote を誤分割するため)。plpgsql body は遅延束縛なので前提 table/helper は実行時解決。

-- ==========================================================
-- get_feed_page — 0107 body を踏襲 + author_id マスク + is_own
-- ==========================================================
create or replace function public.get_feed_page(
    p_post_ids uuid[],
    p_user_id uuid
  )
  returns json
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_viewer   uuid;
    v_post_ids uuid[];
    v_count    int;
    v_result   json;
  begin
    -- 0078 IDOR gate: 他人の p_user_id を渡せないよう auth.uid() と一致を要求。
    if p_user_id is not null and p_user_id != auth.uid() then
      raise exception 'forbidden: p_user_id must match auth.uid()'
        using errcode = '42501';
    end if;
    -- 匿名 author_id マスク / is_own 判定の authoritative source は auth.uid()
    v_viewer := auth.uid();

    v_post_ids := coalesce(p_post_ids, '{}'::uuid[]);
    v_count := coalesce(array_length(v_post_ids, 1), 0);

    if v_count = 0 then
      return json_build_object('posts', '[]'::json);
    end if;

    if v_count > 100 then
      raise exception 'get_feed_page: p_post_ids too long (%, max 100)', v_count
        using errcode = '22023';
    end if;

    with ordered_ids as (
      select t.post_id, t.ord
        from unnest(v_post_ids) with ordinality as t(post_id, ord)
    ),
    post_rows as (
      select
        p.id,
        p.content,
        p.title,
        p.last_activity_at,
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
        o.ord
      from ordered_ids o
      join public.posts p on p.id = o.post_id
        -- ★ 0107: posts_select_visibility (0061) と同じ可視性述語を関数内で再適用。
        and (public.can_view_post(p.id) or p.author_id = auth.uid())
        and public.author_visible(p.author_id)
    ),
    communities_agg as (
      select
        pc.post_id,
        json_agg(
          json_build_object(
            'community_id', c.id,
            'name',         c.name,
            'icon_emoji',   c.icon_emoji,
            'icon_url',     c.icon_url,
            'is_official',  coalesce(c.is_official, false)
          )
          order by c.is_official desc nulls last, c.name
        ) as communities
      from public.post_communities pc
      join public.communities c on c.id = pc.community_id
      where pc.post_id = any(v_post_ids)
      group by pc.post_id
    ),
    official_lookup as (
      select distinct on (pc.post_id)
        pc.post_id,
        json_build_object(
          'name',         coalesce(c.official_admin_display_name, ''),
          'organization', coalesce(c.official_organization, '')
        ) as official_author
      from public.post_communities pc
      join public.communities c on c.id = pc.community_id
      join public.posts p on p.id = pc.post_id
      where pc.post_id = any(v_post_ids)
        and c.is_official is true
        and c.official_admin_user_id is not null
        and c.official_admin_user_id = p.author_id
      order by pc.post_id, pc.created_at asc
    ),
    my_likes_set as (
      select l.post_id
        from public.likes l
       where p_user_id is not null
         and l.user_id = p_user_id
         and l.post_id = any(v_post_ids)
    ),
    my_concerns_set as (
      select cn.post_id
        from public.concerns cn
       where p_user_id is not null
         and cn.user_id = p_user_id
         and cn.post_id = any(v_post_ids)
    ),
    my_saves_set as (
      select s.post_id
        from public.saves s
       where p_user_id is not null
         and s.user_id = p_user_id
         and s.post_id = any(v_post_ids)
    ),
    reactions_raw as (
      select
        r.post_id,
        r.meme,
        count(*)::int as cnt,
        bool_or(p_user_id is not null and r.user_id = p_user_id) as mine
      from public.post_reactions r
      where r.post_id = any(v_post_ids)
      group by r.post_id, r.meme
    ),
    reactions_agg as (
      select
        rr.post_id,
        json_agg(
          json_build_object(
            'meme',  rr.meme,
            'count', rr.cnt,
            'mine',  rr.mine
          )
          order by rr.cnt desc, rr.meme
        ) as reactions
      from reactions_raw rr
      group by rr.post_id
    ),
    added_tags_raw as (
      select
        pat.post_id,
        pat.tag_name,
        min(pat.created_at) as first_seen
      from public.post_added_tags pat
      where pat.post_id = any(v_post_ids)
      group by pat.post_id, pat.tag_name
    ),
    added_tags_agg as (
      select
        atr.post_id,
        json_agg(atr.tag_name order by atr.first_seen) as added_tags
      from added_tags_raw atr
      group by atr.post_id
    ),
    polls_base as (
      select
        pl.id,
        pl.post_id,
        pl.question,
        pl.expires_at,
        pl.multi_select,
        pl.total_votes
      from public.polls pl
      where pl.post_id = any(v_post_ids)
    ),
    poll_options_agg as (
      select
        po.poll_id,
        json_agg(
          json_build_object(
            'id',         po.id,
            'label',      po.label,
            'vote_count', po.vote_count
          )
          order by po.ordinal asc
        ) as options
      from public.poll_options po
      where po.poll_id in (select id from polls_base)
      group by po.poll_id
    ),
    my_poll_votes_agg as (
      select
        pv.poll_id,
        json_agg(pv.option_id) as my_vote_option_ids
      from public.poll_votes pv
      where p_user_id is not null
        and pv.user_id = p_user_id
        and pv.poll_id in (select id from polls_base)
      group by pv.poll_id
    ),
    polls_agg as (
      select
        pb.post_id,
        json_build_object(
          'id',                 pb.id,
          'question',           pb.question,
          'expires_at',         pb.expires_at,
          'multi_select',       pb.multi_select,
          'total_votes',        pb.total_votes,
          'options',            coalesce(poa.options, '[]'::json),
          'my_vote_option_ids', coalesce(mpv.my_vote_option_ids, '[]'::json)
        ) as poll
      from polls_base pb
      left join poll_options_agg poa on poa.poll_id = pb.id
      left join my_poll_votes_agg mpv on mpv.poll_id = pb.id
    )
    select json_build_object(
      'posts',
      coalesce(
        (
          select json_agg(
                   json_build_object(
                     'id',                  pr.id,
                     'content',             pr.content,
                     'title',               pr.title,
                     'last_activity_at',    pr.last_activity_at,
                     'media_urls',          pr.media_urls,
                     'media_blurhashes',    pr.media_blurhashes,
                     'video_urls',          pr.video_urls,
                     'video_durations',     pr.video_durations,
                     'video_posters',       pr.video_posters,
                     'tag_names',           pr.tag_names,
                     'likes_count',         pr.likes_count,
                     'comments_count',      pr.comments_count,
                     'score',               pr.score,
                     'hot_score',           pr.hot_score,
                     'concern_count',       pr.concern_count,
                     'kind',                pr.kind,
                     'source_url',          pr.source_url,
                     'is_public',           pr.is_public,
                     'trust_score_at_post', pr.trust_score_at_post,
                     'is_anonymous',        pr.is_anonymous,
                     'content_warning',     pr.content_warning,
                     'cw_category',         pr.cw_category,
                     'visibility',          pr.visibility,
                     'created_at',          pr.created_at,
                     -- ★ 匿名 author_id マスク (0113/0076 と同形): viewer 本人以外 NULL。
                     'author_id',
                       case
                         when pr.is_anonymous
                          and (v_viewer is null or v_viewer is distinct from pr.author_id)
                         then null
                         else pr.author_id
                       end,
                     -- is_own: author_id===me 判定の server 供給 (列 revoke 後も残る唯一の手段)
                     'is_own',              (v_viewer is not null and pr.author_id = v_viewer),
                     'communities',         coalesce(ca.communities, '[]'::json),
                     'official_author',     ol.official_author,
                     'my_like',             (ml.post_id is not null),
                     'my_concern',          (mc.post_id is not null),
                     'my_save',             (ms.post_id is not null),
                     'reactions',           coalesce(ra.reactions, '[]'::json),
                     'added_tags',          coalesce(ata.added_tags, '[]'::json),
                     'poll',                pla.poll
                   )
                   order by pr.ord asc
                 )
            from post_rows pr
            left join communities_agg ca on ca.post_id = pr.id
            left join official_lookup ol on ol.post_id = pr.id
            left join my_likes_set ml    on ml.post_id = pr.id
            left join my_concerns_set mc on mc.post_id = pr.id
            left join my_saves_set ms    on ms.post_id = pr.id
            left join reactions_agg ra   on ra.post_id = pr.id
            left join added_tags_agg ata on ata.post_id = pr.id
            left join polls_agg pla      on pla.post_id = pr.id
        ),
        '[]'::json
      )
    )
    into v_result;

    return v_result;
  end;
  $fn$;

  grant execute on function public.get_feed_page(uuid[], uuid) to authenticated;

  -- ==========================================================
  -- get_community_feed — 0112 body を踏襲 + author_id マスク + is_own
  -- ==========================================================
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
    v_viewer uuid;
    v_limit int;
    v_result json;
  begin
    -- IDOR ガード (0079 から踏襲): 自分以外の UUID を渡したら拒否
    if p_user_id is not null and p_user_id <> auth.uid() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_viewer := auth.uid();

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
                     -- ★ 匿名 author_id マスク (0113/0076 と同形): viewer 本人以外 NULL。
                     'author_id',
                       case
                         when pr.is_anonymous
                          and (v_viewer is null or v_viewer is distinct from pr.author_id)
                         then null
                         else pr.author_id
                       end,
                     -- is_own: author_id===me 判定の server 供給
                     'is_own', (v_viewer is not null and pr.author_id = v_viewer),
                     'community_id', pr.community_id,
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

select '0115_mask_feed_author_add_isown 完了 — get_feed_page / get_community_feed の匿名 author_id をマスク + is_own 追加 (0113 と統一)' as note;
