-- ============================================================
-- 0041_get_feed_page_rpc.sql
-- ============================================================
-- 「ホームフィード (for-you / hot / new / top)」表示時に、
-- 既に取得済の post_ids 配列に対して、表示に必要な周辺データ
-- (communities / official_author / my_like|concern|save / reactions /
--  added_tags / poll) を 1 リクエストで集約して返す。
--
-- 背景:
--   既存実装では feed.tsx が以下を並列で発射していた:
--     - useLikes(postIds)            → likes table
--     - useConcerns(postIds)         → concerns table
--     - useSaves(postIds)            → saves table
--     - useReactions(postIds)        → post_reactions table
--     - useAddedTags(postIds)        → post_added_tags table
--     - usePolls(postIds)            → polls + poll_options + poll_votes
--     - communitiesByPost            → post_communities + communities
--     - attachOfficialAuthor (内部)  → post_communities + communities
--   並列発射でも個別の TCP / TLS / PostgREST round-trip が積み重なり、
--   p50 ≈ 600-900ms / p95 ≈ 1.5-2s。さらに「自分の like」「自分の vote」
--   といった ID 毎の小さなクエリが多数発生し、wire 量も増える。
--
--   この RPC は同じ集合を **1 ラウンドトリップ** で返す。
--
-- 設計:
--   - SECURITY DEFINER で関係表に直接 SELECT (RLS 経由の遅延を回避)
--     返却は public/可視 post 前提なので RLS バイパスでも漏洩しない設計
--     (post 本体は post_ids で限定しており、呼出側が既に列挙可能な範囲)
--   - LANGUAGE plpgsql STABLE
--   - set search_path = public, pg_temp で hijack 防止
--   - 主要関係テーブルを to_regclass で防御 (CI / 部分セットアップで死なない)
--   - p_user_id が null でも posts/communities/reactions/poll は集約 (my_* は false)
--   - post_ids 順序を返却で維持 (with ordinality)
--
-- 返却 shape (json):
--   {
--     "posts": [
--       {
--         ...POSTS_SELECT_COLS,
--         communities: [{ community_id, name, icon_emoji, icon_url, is_official }],
--         official_author: { name, organization } | null,
--         my_like: bool, my_concern: bool, my_save: bool,
--         reactions: [{ meme, count, mine }],
--         added_tags: [string],
--         poll: { id, question, expires_at, multi_select, total_votes,
--                 options: [{id,label,vote_count}],
--                 my_vote_option_ids: [uuid] } | null
--       },
--       ...
--     ]
--   }
--   posts は p_post_ids の順序を維持。
--   p_post_ids が空 / 存在しない post は欠落 (= 順序を保ったまま skip)。
-- ============================================================

do $$
begin
  -- 主要 prerequisite テーブル不在ならスキップ (CI / 部分セットアップで死なない)
  -- ここで列挙したテーブルは関数本体で参照される。1 つでも欠ければ作成しない。
  -- (アプリ本番では migration 0001-0023 で全て揃う想定)
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
    raise notice '0041: prerequisite tables missing, skip rpc creation';
    return;
  end if;

  -- 旧シグネチャを drop (idempotent + 引数違いの上書き対策)
  begin
    execute 'drop function if exists public.get_feed_page(uuid[], uuid)';
  exception when others then
    -- 他で参照されている場合は cascade せず黙って続ける
    raise notice '0041: drop existing get_feed_page failed: %', sqlerrm;
  end;

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
    v_result   json;
  begin
    v_post_ids := coalesce(p_post_ids, '{}'::uuid[]);

    -- 空配列なら早期 return (DB ヒット無し)
    if array_length(v_post_ids, 1) is null then
      return json_build_object('posts', '[]'::json);
    end if;

    -- ----------------------------------------------------------------
    -- 集約ロジック
    -- ----------------------------------------------------------------
    -- 1) ordered_ids: 入力順を保持するため (post_id, ord) を作る
    -- 2) post_rows  : posts を JOIN (POSTS_SELECT_COLS と同列セット)
    -- 3) communities_agg : 各 post に紐付く communities を配列で集約
    --                      (post_communities → communities) — 公式かどうかも含む
    -- 4) official_lookup : 公式管理者投稿の de-anonymize
    --                      (p.author_id = c.official_admin_user_id AND c.is_official)
    --                      複数紐付けの場合は created_at asc で最初の 1 件を採用
    -- 5) my_likes / my_concerns / my_saves : p_user_id に対する boolean
    -- 6) reactions_agg : meme 毎の count + mine
    -- 7) added_tags_agg : post_added_tags 配列 (created_at asc 順)
    -- 8) polls_agg : polls + options + my_vote_option_ids を一塊
    --
    -- 最終 select で json_agg + order by ord で入力順を維持
    -- ----------------------------------------------------------------
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
        -- 動画 (migration 0043 で追加)。
        -- 注: plpgsql の create 時 column 存在チェックは無く、関数初回呼出時の
        -- runtime に解決される。本 migration は 0043 より前に走るが、
        -- アプリ起動時には全 migration が apply 済み → column が存在する想定。
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
      -- 公式管理者投稿: posts.author_id == communities.official_admin_user_id
      -- かつ is_official=true な community に紐付いていれば de-anonymize
      -- 同一 post が複数の公式コミュに attach されている場合は最初に attach
      -- された方 (created_at asc) を採用 — 安定的に同じ表示を返すため。
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
      -- p_user_id null なら全 false (where 条件で空集合)
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
      -- 1 post に同じ tag_name が複数行ある場合は最初の 1 件を採用 (dedup)
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

  -- 認証ユーザーのみ実行可。
  -- 匿名でも posts と community メタは返せるが、my_* が常に false で
  -- 意味薄なので絞る。フィード画面自体が要ログイン (anon 不可) でもある。
  grant execute on function public.get_feed_page(uuid[], uuid) to authenticated;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0041_get_feed_page_rpc 完了: get_feed_page(uuid[], uuid) returns json (SECURITY DEFINER, STABLE)' as result;
