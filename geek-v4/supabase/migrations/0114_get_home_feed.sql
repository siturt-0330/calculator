-- ============================================================
-- 0114_get_home_feed.sql — home feed 1ページ目を 1 RTT に集約 (cold open 初速)
-- ============================================================
-- ⚠️ レビュー必須: SECURITY DEFINER で投稿本文を返す関数。RLS を完全 bypass する。
--    適用前に下記の安全策が意図どおりか必ず確認すること。
--
-- 目的 (パフォーマンス):
--   home feed (landing) の cold open は現状 3 経路 — fetchPosts (ベース posts) →
--   確定後に get_feed_page(0107, 周辺データ) + fetchCommunitiesForPosts — の
--   実効2段ウォーターフォール。本 RPC は既定 sort (= for-you = server 上は hot) の
--   1ページ目について、ベース posts + 周辺データ (communities/official_author/
--   my_like|concern|save/reactions/added_tags/poll) + nextCursor を 1 json で返す。
--   ★ get_feed_page(0107) は「postIds を受けて周辺だけ」返すが、本 RPC は候補を
--      自前で引いて「本文 + 周辺 + nextCursor」まで返す (= useFeed + useFeedPage の
--      1ページ目を兼ねる)。client は返った hot 候補プールを従来どおり再ランクする。
--
-- 安全策 (本番稼働中 get_feed_page=0107 と同一パターンを厳密コピー):
--   (S2) 可視性述語: 0107:113-114 と逐語一致の
--        (can_view_post(p.id) or p.author_id = auth.uid()) and author_visible(p.author_id)
--        — SECURITY DEFINER は RLS(0061 posts_select_visibility) を bypass するため必須。
--   (P1) home 3条件フィルタ: is_anonymous=true and is_public=true and
--        visibility in ('public','community_public') (= fetchPosts(home) と同一)。
--        ★ 0107 の can_view_post は is_anonymous/is_public を見ないので、これを
--           欠くと現行 home feed より広い post (実名/限定投稿) が漏れる。
--   IDOR gate: p_user_id が auth.uid() と不一致なら 42501 (0107:59-62)。
--   limit clamp: least(greatest(coalesce(p_limit,30),1),50) で大量行スキャン DoS を防ぐ。
--
-- ★ author_id は匿名投稿で viewer 本人以外マスク (0113:151-157 / 0076 と同形)。さらに
--   is_own boolean を別途返し、client の author_id===me 判定を server 供給へ置換する
--   (Phase2 で posts.author_id を列 revoke すると client は author_id を取得できなくなるため)。
--   get_feed_page(0107)/get_community_feed(0112) も同バッチ(0115)で同時にマスク+is_own 化
--   するので、['feed-page'] cache を 0107 と共有 seed しても 1/2 ページ目で author_id の
--   有無は食い違わない。mod の kick/ban は post.author_id 依存を廃し mod_*_by_content
--   RPC(0116)で server が author を解決する。これで client は匿名 author_id を一切受け取らない。
--
-- cursor: hot 合成 cursor '<hot_score>|<ISO created_at>' を返す (lib/api/posts.ts
--   parseHotCursor と同形式)。client の ISO_RE は 'T' 区切り + 'Z'/'+HH:MM' を要求し、
--   PG 既定の created_at::text ('YYYY-MM-DD HH24:MI:SS+00') は通らないので to_char で整形。
--   候補数が limit に達したときだけ発行 (= 次ページあり)。未満なら null (最終ページ)。
--   本 RPC は1ページ目専用 (入力 cursor 無し); 2ページ目以降は client が現行
--   fetchPosts(cursor) + get_feed_page 経路へ。
--
-- 冪等: to_regclass/to_regprocedure ガード + CREATE OR REPLACE。
-- 未適用/失敗/timeout 時は client が現行3経路へ完全 fallback (lib/api/homeFeed.ts,
-- flag EXPO_PUBLIC_HOME_FEED_RPC 既定 OFF)。
-- ============================================================

do $$
begin
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
    raise notice '0114: prerequisite tables missing, skip get_home_feed creation';
    return;
  end if;
  -- 可視性ヘルパが無い環境ではスキップ (誤って未定義関数で home feed RPC を壊さない)
  if to_regprocedure('public.can_view_post(uuid)') is null
     or to_regprocedure('public.author_visible(uuid)') is null then
    raise notice '0114: visibility helpers missing, skip get_home_feed creation';
    return;
  end if;

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
end $$;

select '0114_get_home_feed 完了 — home feed 1ページ目を 1 RTT 集約 (0107可視性述語+周辺データ+nextCursor, author_id 非マスク=0107準拠)' as note;
