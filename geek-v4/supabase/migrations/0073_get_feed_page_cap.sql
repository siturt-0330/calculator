-- ============================================================
-- 0071_get_feed_page_cap.sql
-- ============================================================
-- get_feed_page (migration 0041) に「p_post_ids が異常に長い時の cap + raise」
-- を追加するため、関数本体を作り直す。
--
-- 背景:
--   0041 の get_feed_page は 11 個の CTE をチェーンする。p_post_ids が
--   100 件を超えると CTE 内の any(v_post_ids) join が plan 時に O(N) で
--   ふくらみ、 (a) DB CPU が跳ね上がる (b) p99 レイテンシが秒オーダーになる
--   現象が観測された。クライアント側 (lib/api/feedPage.ts) でも MAX_POST_IDS_PER_CALL
--   で cap しているが、defense-in-depth として server 側でも明示的に弾く。
--
-- 設計:
--   - 100 件超を raise exception で reject (= クライアントは error.message 経由で検知)
--   - 旧 0041 の body をそのまま踏襲 (差分は冒頭の length check のみ)
--   - SECURITY DEFINER / STABLE / search_path の hardening は維持
--   - drop function せず create or replace でシグネチャ温存 (権限変更不要)
--
-- ロールバック手順:
--   この migration を削除して 0041 を再 apply すれば直前の挙動に戻る。
-- ============================================================

do $$
begin
  -- 0041 で作成された関数が存在しない (= prerequisite テーブル無し) なら何もしない
  if to_regclass('public.posts') is null
     or to_regclass('public.likes') is null
     or to_regclass('public.concerns') is null
     or to_regclass('public.saves') is null
     or to_regclass('public.post_reactions') is null
     or to_regclass('public.post_added_tags') is null
     or to_regclass('public.polls') is null
     or to_regclass('public.poll_options') is null
     or to_regclass('public.poll_votes') is null
     or to_regclass('public.post_communities') is null
     or to_regclass('public.communities') is null then
    raise notice '0071: prerequisite tables missing, skip cap patch';
    return;
  end if;

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
    v_post_ids uuid[];
    v_count    int;
    v_result   json;
  begin
    v_post_ids := coalesce(p_post_ids, '{}'::uuid[]);
    v_count := coalesce(array_length(v_post_ids, 1), 0);

    -- 空配列なら早期 return (DB ヒット無し)
    if v_count = 0 then
      return json_build_object('posts', '[]'::json);
    end if;

    -- ★ 入力上限 (0071 追加): 100 件超は reject。クライアントは破滅的に長い
    --   配列を送らない契約。攻撃 / バグから DB CPU を守る defense-in-depth。
    if v_count > 100 then
      raise exception 'get_feed_page: p_post_ids too long (%, max 100)', v_count
        using errcode = '22023';  -- invalid_parameter_value
    end if;

    with ordered_ids as (
      select t.post_id, t.ord
        from unnest(v_post_ids) with ordinality as t(post_id, ord)
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
        o.ord
      from ordered_ids o
      join public.posts p on p.id = o.post_id
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
                     'author_id',           pr.author_id,
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

  -- 既存の grant を明示的に再付与 (create or replace で消えないが念のため)
  grant execute on function public.get_feed_page(uuid[], uuid) to authenticated;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0071_get_feed_page_cap 完了: get_feed_page に p_post_ids <= 100 cap を追加' as result;
