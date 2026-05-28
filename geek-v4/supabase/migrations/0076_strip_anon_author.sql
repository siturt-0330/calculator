-- ============================================================
-- 0076_strip_anon_author.sql — 匿名性の保護 (Audit H#2)
-- ============================================================
-- 背景:
--   is_anonymous=true の投稿でも API response に author_id が含まれており、
--   profiles 経由で nickname を JOIN で取得することが可能だった。
--   これは「好きを匿名で」というプロダクトの core promise を破壊する critical
--   なリーク。RLS で profiles が世界読みであることと組合わさり、結果として
--   「匿名投稿の真の作者」が誰でも判定可能だった。
--
-- 修正方針:
--   get_feed_page / get_community_feed の RPC で、最終 SELECT の json_build_object
--   段階で author_id を以下条件で NULL に置換する:
--     - is_anonymous = true AND
--     - auth.uid() IS DISTINCT FROM author_id  (= 自分の投稿は素通し)
--
--   公式管理者投稿 (official_author non-null) も「is_anonymous = false」前提で
--   運用されているため、上記マスクは矛盾しない。official_author の判定自体は
--   CTE 内部で内部 author_id を使って先に計算済み (=マスク前) なので、表示は
--   従来どおり可能。
--
-- セキュリティ上の決定:
--   - 自分自身の投稿 (auth.uid() = author_id) は author_id を返す。これは
--     クライアントが「これは私の投稿だ」と判定するため。
--   - auth.uid() が null (= 認証なし RPC 呼び出し) の場合、自分の投稿か否か
--     判定できないので、安全側 (= author_id を NULL に) 倒す。
--
-- アンチスパム / モデレーション:
--   real author_id が必要なフローは別の SECURITY DEFINER admin RPC を経由
--   すること。本 RPC は通常ユーザー向けの読み取り API として、author_id を
--   匿名投稿から完全に剥がす。
--   (admin RPC は別 migration で導入。is_admin(auth.uid()) gate 必須)
--
-- フォローアップ (この migration では対応しない):
--   - クライアントの POSTS_SELECT_COLS から author_id を除く / 別経路に切り出す
--     (lib/api/posts.ts などの SELECT で author_id を直接 fetch している箇所)
--   - profiles RLS をさらに絞る (現在は世界読みで nickname / avatar 取得可)
--
-- 冪等性:
--   - create or replace function で関数定義のみ上書き
--   - DO ブロックで prerequisite table 不在時は skip
-- ============================================================

-- ============================================================
-- Step 1: get_feed_page — 0075 Step 12 の body を踏襲し、SELECT 段階で
--         author_id を匿名条件で NULL マスク
-- ============================================================

do $$
begin
  -- prerequisite テーブル不在ならスキップ (CI / 部分セットアップで死なない)
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
    raise notice '0076: prerequisite tables missing, skip get_feed_page update';
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
    v_viewer   uuid;
  begin
    v_post_ids := coalesce(p_post_ids, '{}'::uuid[]);
    v_count := coalesce(array_length(v_post_ids, 1), 0);

    -- 空配列なら早期 return (DB ヒット無し)
    if v_count = 0 then
      return json_build_object('posts', '[]'::json);
    end if;

    -- 入力上限 (0073 で導入): 100 件超は reject
    if v_count > 100 then
      raise exception 'get_feed_page: p_post_ids too long (%, max 100)', v_count
        using errcode = '22023';  -- invalid_parameter_value
    end if;

    -- 0076: 自分の投稿か判定するため、auth.uid() を取得 (authoritative)
    -- p_user_id を信用せず auth.uid() を見るのは、SECURITY DEFINER 配下でも
    -- 呼び出しユーザーの id は auth.uid() に保持されているため。
    v_viewer := auth.uid();

    with ordered_ids as (
      select t.post_id, t.ord
        from unnest(v_post_ids) with ordinality as t(post_id, ord)
    ),
    post_rows as (
      select
        p.id,
        p.content,
        p.title,                -- 0075 追加: BBS 統合用タイトル
        p.last_activity_at,     -- 0075 追加: 最終アクティビティ時刻
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
      -- 0076 重要: official_author の判定は CTE 内部で real author_id (p.author_id)
      -- を使って先に評価する。後段の json_build_object で author_id を NULL マスクしても、
      -- official_author 自体は正しく付与される (公式管理者投稿は is_anonymous=false 前提)。
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
                     -- 0076: 匿名投稿の author_id を NULL にマスク。
                     -- 自分の投稿 (auth.uid() = author_id) は素通しする。
                     -- viewer = null (未認証) の場合は安全側で null を返す。
                     'author_id',
                       case
                         when pr.is_anonymous is true
                          and (v_viewer is null or v_viewer is distinct from pr.author_id)
                         then null
                         else pr.author_id
                       end,
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

  -- create or replace で grant は維持されるが、明示再付与で安全側に
  grant execute on function public.get_feed_page(uuid[], uuid) to authenticated;
end $$;

-- ============================================================
-- Step 2: get_community_feed — 0042 の body を踏襲し、author_id を匿名マスク
-- ============================================================
-- author_nickname は 0042 ですでに gating 済み (is_anonymous なら null)。
-- ここでは author_id の同等のマスクを追加する。
-- ============================================================

do $$
begin
  -- 前提テーブル不在ならスキップ
  if to_regclass('public.community_members') is null
     or to_regclass('public.post_communities') is null
     or to_regclass('public.posts') is null
     or to_regclass('public.communities') is null
     or to_regclass('public.profiles') is null then
    raise notice '0076: prerequisite tables missing, skip get_community_feed update';
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
    v_viewer uuid;
  begin
    -- limit を 1..200 の範囲に正規化 (DoS 防止)
    v_limit := coalesce(p_limit, 40);
    if v_limit < 1 then v_limit := 1; end if;
    if v_limit > 200 then v_limit := 200; end if;

    -- 引数チェック: p_user_id が null なら空を返す
    if p_user_id is null then
      return json_build_object('posts', '[]'::json);
    end if;

    -- 0076: 自分の投稿か判定するため、auth.uid() を取得 (authoritative)
    v_viewer := auth.uid();

    with my_communities as (
      select community_id
        from public.community_members
       where user_id = p_user_id
    ),
    pc_overfetch as (
      -- limit*4 を上限に overfetch (重複 dedup 後の保険)
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
    -- posts を join。POSTS_SELECT_COLS と同じ列セットを返す
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
    -- 最終 select で json 化。author / community を LATERAL join で merge。
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
                     -- 0076: 匿名投稿の author_id を NULL にマスク。
                     -- 自分の投稿 (auth.uid() = author_id) は素通し。
                     'author_id',
                       case
                         when pr.is_anonymous is true
                          and (v_viewer is null or v_viewer is distinct from pr.author_id)
                         then null
                         else pr.author_id
                       end,
                     'community_id', pr.community_id,
                     -- author_nickname は is_anonymous=true の時は出さない (0042 から踏襲)
                     'author_nickname',
                       case when pr.is_anonymous then null
                            else prof.nickname end,
                     -- official_author: 公式コミュ管理者投稿 → 実名 + 所属
                     -- 判定は内部 author_id (pr.author_id) で行うため、上記の
                     -- マスクとは独立に正しく解決される。
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

  -- 認証ユーザーのみ実行可
  grant execute on function public.get_community_feed(uuid, int) to authenticated;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0076_strip_anon_author 完了 — anon posts now mask author_id (self-view excepted)' as note;
