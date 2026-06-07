-- ============================================================
-- 0126_feed_rpc_avatar.sql — フィード RPC 3本に avatar_url / avatar_emoji / pseudonym_id を追加
-- ============================================================
-- ⚠️ レビュー必須: SECURITY DEFINER で投稿本文を返す関数3本を CREATE OR REPLACE する。
--
-- 目的:
--   匿名 author の表示用に、各 post の json に server 側 join で
--     'avatar_url'   = profiles.avatar_url   (0081)
--     'avatar_emoji' = profiles.avatar_emoji (0081)
--     'pseudonym_id' = profiles.pseudonym_id (0116)
--   を追加する。解決は post の実 author_id (= 既に各 CTE に select 済) との
--   server-side join で行い、author_id 自体は **出力に一切足さない**
--   (既存の匿名マスク CASE をそのまま維持する)。
--
-- 対象 RPC と元定義 (body はそれぞれ完全に踏襲し、変更は下記の追加のみ):
--   - get_home_feed       ← 0114_get_home_feed.sql
--   - get_feed_page       ← 0115_mask_feed_author_add_isown.sql
--   - get_community_feed  ← 0115_mask_feed_author_add_isown.sql
--
-- 各 RPC への変更 (これ以外は一切変えない):
--   (a) per-post の json_build_object に 'avatar_url' / 'avatar_emoji' /
--       'pseudonym_id' の3キーを追加 (値は prof.<col>)。
--   (b) get_home_feed / get_feed_page は最終 SELECT に profiles join が無いので
--       `left join public.profiles prof on prof.id = <postrow alias>.author_id`
--       を追加 (author_id は CTE に select 済 = join key は存在。出力には出さない)。
--       get_community_feed は既に prof エイリアスの left join があるので **再利用**。
--   ★ left join なので profiles 行が欠けた post も従来どおり出る (3フィールドは null)。
--
-- de-anon 不変条件: pseudonym_id は profiles_public(0081) には絶対に追加しない
--   (この RPC は SECURITY DEFINER で profiles から直接読むので OK。0116 のルール参照)。
--   可視性述語・IDOR gate・clamp・order・dedup・author_id マスク・is_own・
--   official_author 解決は一切変えない。
--
-- 冪等: CREATE OR REPLACE (top-level 定義。do $$..$$ で包むと一部 SQL editor の statement
--   splitter が nested dollar-quote を誤分割し "syntax error at uuid" になるため非使用)。
-- ============================================================

-- ★ 関数は top-level で定義 (do $$..$$ で包むと SQL editor の splitter が nested
--   dollar-quote を誤分割するため)。plpgsql body は遅延束縛なので前提 table/helper は実行時解決。

-- ==========================================================
-- get_home_feed — 0114 body を踏襲 + avatar_url / avatar_emoji / pseudonym_id
-- ==========================================================
  create or replace function public.get_home_feed(
    p_user_id uuid default null,
    p_limit   int  default 30
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
    -- IDOR gate (0107:59-62): 他人の p_user_id を渡せないよう auth.uid() と一致を要求。
    if p_user_id is not null and p_user_id != auth.uid() then
      raise exception 'forbidden: p_user_id must match auth.uid()'
        using errcode = '42501';
    end if;
    -- 匿名 author_id マスク / is_own 判定の authoritative source は auth.uid() (p_user_id は信用しない)
    v_viewer := auth.uid();

    -- limit clamp (DoS 防止)。fetchPosts(for-you) の effectiveLimit=ceil(20*1.5)=30 が既定。
    v_limit := least(greatest(coalesce(p_limit, 30), 1), 50);

    with hot_pool as (
      -- ★ ベース posts: fetchPosts(home, effectiveSort='hot') を server 側で再現。
      --   home 3条件 + 0107 可視性述語 + hot order + limit。0107 post_rows と同じ列 + qa_mode
      --   (qa_mode は fetchPosts/POSTS_SELECT_COLS に含まれるので ['feed'] cache と整合させる)。
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
        p.qa_mode,
        p.created_at,
        p.author_id
      from public.posts p
      where p.is_anonymous = true
        and p.is_public = true
        and p.visibility in ('public', 'community_public')
        -- ★ 0107:113-114 と同一の可視性述語 (SECURITY DEFINER の RLS bypass 対策)
        and (public.can_view_post(p.id) or p.author_id = auth.uid())
        and public.author_visible(p.author_id)
      order by p.hot_score desc nulls last, p.created_at desc
      limit v_limit
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
      where pc.post_id in (select id from hot_pool)
      group by pc.post_id
    ),
    -- official_author は hot_pool の実 author_id で解決 (author_id は出力でも非マスクなので順序は不問だが
    -- 0107 と同じく post 著者 = 公式管理者のときだけ付与する)
    official_lookup as (
      select distinct on (pc.post_id)
        pc.post_id,
        json_build_object(
          'name',         coalesce(c.official_admin_display_name, ''),
          'organization', coalesce(c.official_organization, '')
        ) as official_author
      from public.post_communities pc
      join public.communities c on c.id = pc.community_id
      join hot_pool hp on hp.id = pc.post_id
      where c.is_official is true
        and c.official_admin_user_id is not null
        and c.official_admin_user_id = hp.author_id
      order by pc.post_id, pc.created_at asc
    ),
    my_likes_set as (
      select l.post_id
        from public.likes l
       where p_user_id is not null
         and l.user_id = p_user_id
         and l.post_id in (select id from hot_pool)
    ),
    my_concerns_set as (
      select cn.post_id
        from public.concerns cn
       where p_user_id is not null
         and cn.user_id = p_user_id
         and cn.post_id in (select id from hot_pool)
    ),
    my_saves_set as (
      select s.post_id
        from public.saves s
       where p_user_id is not null
         and s.user_id = p_user_id
         and s.post_id in (select id from hot_pool)
    ),
    reactions_raw as (
      select
        r.post_id,
        r.meme,
        count(*)::int as cnt,
        bool_or(p_user_id is not null and r.user_id = p_user_id) as mine
      from public.post_reactions r
      where r.post_id in (select id from hot_pool)
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
      where pat.post_id in (select id from hot_pool)
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
      where pl.post_id in (select id from hot_pool)
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
                     'id',                  hp.id,
                     'content',             hp.content,
                     'title',               hp.title,
                     'last_activity_at',    hp.last_activity_at,
                     'media_urls',          hp.media_urls,
                     'media_blurhashes',    hp.media_blurhashes,
                     'video_urls',          hp.video_urls,
                     'video_durations',     hp.video_durations,
                     'video_posters',       hp.video_posters,
                     'tag_names',           hp.tag_names,
                     'likes_count',         hp.likes_count,
                     'comments_count',      hp.comments_count,
                     'score',               hp.score,
                     'hot_score',           hp.hot_score,
                     'concern_count',       hp.concern_count,
                     'kind',                hp.kind,
                     'source_url',          hp.source_url,
                     'is_public',           hp.is_public,
                     'trust_score_at_post', hp.trust_score_at_post,
                     'is_anonymous',        hp.is_anonymous,
                     'content_warning',     hp.content_warning,
                     'cw_category',         hp.cw_category,
                     'visibility',          hp.visibility,
                     'qa_mode',             hp.qa_mode,
                     'created_at',          hp.created_at,
                     -- ★ 匿名 author_id マスク (0113:151-157 / 0076 と同形): viewer 本人以外 NULL。
                     --   official_author は hot_official CTE で実 author_id 解決済なので壊れない。
                     'author_id',
                       case
                         when hp.is_anonymous
                          and (v_viewer is null or v_viewer is distinct from hp.author_id)
                         then null
                         else hp.author_id
                       end,
                     -- is_own: client の author_id===me 判定を server 供給へ置換 (列 revoke 後も残る唯一の手段)
                     'is_own',              (v_viewer is not null and hp.author_id = v_viewer),
                     -- ★ 0126: 匿名 author の表示用 (実 author_id で server join。author_id は出力に出さない)
                     'avatar_url',          prof.avatar_url,
                     'avatar_emoji',        prof.avatar_emoji,
                     'pseudonym_id',        prof.pseudonym_id,
                     'communities',         coalesce(ca.communities, '[]'::json),
                     'official_author',     ol.official_author,
                     'my_like',             (ml.post_id is not null),
                     'my_concern',          (mc.post_id is not null),
                     'my_save',             (ms.post_id is not null),
                     'reactions',           coalesce(ra.reactions, '[]'::json),
                     'added_tags',          coalesce(ata.added_tags, '[]'::json),
                     'poll',                pla.poll
                   )
                   order by hp.hot_score desc nulls last, hp.created_at desc
                 )
            from hot_pool hp
            left join public.profiles prof on prof.id = hp.author_id
            left join communities_agg ca on ca.post_id = hp.id
            left join official_lookup ol on ol.post_id = hp.id
            left join my_likes_set ml    on ml.post_id = hp.id
            left join my_concerns_set mc on mc.post_id = hp.id
            left join my_saves_set ms    on ms.post_id = hp.id
            left join reactions_agg ra   on ra.post_id = hp.id
            left join added_tags_agg ata on ata.post_id = hp.id
            left join polls_agg pla      on pla.post_id = hp.id
        ),
        '[]'::json
      ),
      -- nextCursor: hot 合成 cursor '<hot_score>|<ISO created_at>' (posts.ts parseHotCursor 互換)。
      -- 候補数が v_limit に達したときだけ発行。to_char で 'T' 区切り + 'Z' を付ける
      -- (PG 既定の 'YYYY-MM-DD HH24:MI:SS+00' は client の ISO_RE を通らないため必須)。
      'nextCursor',
      (
        select case
          when (select count(*) from hot_pool) = v_limit then
            (
              select concat(
                       coalesce(hp.hot_score, 0)::text,
                       '|',
                       to_char(hp.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                     )
              from hot_pool hp
              order by hp.hot_score desc nulls last, hp.created_at desc
              limit 1 offset (v_limit - 1)
            )
          else null
        end
      )
    )
    into v_result;

    return v_result;
  end;
  $fn$;

  grant execute on function public.get_home_feed(uuid, int) to authenticated;

-- ==========================================================
-- get_feed_page — 0115 body を踏襲 + avatar_url / avatar_emoji / pseudonym_id
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
                     -- ★ 0126: 匿名 author の表示用 (実 author_id で server join。author_id は出力に出さない)
                     'avatar_url',          prof.avatar_url,
                     'avatar_emoji',        prof.avatar_emoji,
                     'pseudonym_id',        prof.pseudonym_id,
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
            left join public.profiles prof on prof.id = pr.author_id
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
  -- get_community_feed — 0115 body を踏襲 + avatar_url / avatar_emoji / pseudonym_id
  --   (既存 prof エイリアスの left join を再利用。2本目の join は足さない)
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
                     -- ★ 0126: 匿名 author の表示用 (既存 prof join を再利用。author_id は出力に出さない)
                     'avatar_url', prof.avatar_url,
                     'avatar_emoji', prof.avatar_emoji,
                     'pseudonym_id', prof.pseudonym_id,
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

select '0126_feed_rpc_avatar 完了 — get_home_feed / get_feed_page / get_community_feed の per-post json に avatar_url / avatar_emoji / pseudonym_id を追加 (server-side profiles join, author_id マスクは維持)' as note;
