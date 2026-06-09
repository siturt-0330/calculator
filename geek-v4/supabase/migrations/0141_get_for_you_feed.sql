-- ============================================================
-- 0141_get_for_you_feed.sql — 個人化フィード RPC (Value Model)
-- ============================================================
-- Instagram Explore の多段ファネルを Supabase/PostgreSQL で実現:
--
--   Stage 1 候補選択 (150件):
--     過去7日・公開・可視性チェック・既読除外 → hot_score 降順
--
--   Stage 2 Value Model スコアリング:
--     for_you_score = タグ親和性ボーナス×4
--                   + ln(likes+1)×2
--                   + ln(comments+1)×1.5
--                   - concern_penalty (max 3.0)
--                   + 鮮度スコア×2 (8h half-life)
--                   + コールドスタートブースト (2h=5pt, 6h=2pt)
--
--   Stage 3 多様性:
--     dominant tag (tag_names[1]) ごとに最大3件
--     → filter bubble を防止しつつ興味タグを優先
--
--   Cold Start (affinity 未設定ユーザー):
--     hot_score 順 fallback → get_home_feed と同等
--
--   既読除外:
--     post_impressions で3日以内に2回以上見た投稿を除外
--
-- 出力形式: get_home_feed(0114) と同一の JSON
--   { posts: [...], nextCursor: "hot_score|ISO_ts" }
-- 1ページ目専用; 2ページ目以降は fetchPosts(cursor) + get_feed_page へ。
--
-- ⚠️ SECURITY DEFINER: RLS を bypass するため 0114 と同一の可視性述語
--    (can_view_post + author_visible) を適用必須。
-- ============================================================

create or replace function public.get_for_you_feed(
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
  v_viewer       uuid;
  v_limit        int;
  v_result       json;
  v_has_affinity boolean;
begin
  -- IDOR gate (0107/0114 と同一パターン)
  if p_user_id is not null and p_user_id != auth.uid() then
    raise exception 'forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;
  v_viewer := auth.uid();
  v_limit  := least(greatest(coalesce(p_limit, 30), 1), 50);

  -- cold start 検出: user_tag_affinity が1件でも存在すれば personalized モード
  select exists(
    select 1 from public.user_tag_affinity
    where user_id = v_viewer
    limit 1
  ) into v_has_affinity;

  with
  -- 1. ユーザーの上位タグ親和性 (最大 30 件)
  user_affinities as (
    select tag_name, affinity_score
    from public.user_tag_affinity
    where user_id = v_viewer
    order by affinity_score desc
    limit 30
  ),
  -- 2. 直近3日で2回以上見た投稿 (再閲覧除外リスト)
  seen_posts as (
    select post_id
    from public.post_impressions
    where user_id = v_viewer
      and last_seen_at > now() - interval '3 days'
      and seen_count > 1
  ),
  -- 3. 候補プール: 過去7日・公開・可視性チェック・既読除外 (上位 150 件)
  --    hot_score で上位 150 件に絞ってから Value Model で再ランク
  base_candidates as (
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
      p.author_id,
      -- タグ親和性ボーナス: マッチしたタグの平均スコア
      coalesce(
        (select avg(ua.affinity_score)
         from user_affinities ua
         where ua.tag_name = any(p.tag_names)),
        0.0
      ) as tag_affinity_bonus,
      -- コールドスタートブースト: 新規投稿への保証露出
      --   2h 以内 → 5pt、6h 以内 → 2pt (popularity bias 対策)
      case
        when p.created_at > now() - interval '2 hours' then 5.0
        when p.created_at > now() - interval '6 hours' then 2.0
        else 0.0
      end as cold_boost
    from public.posts p
    where p.is_anonymous = true
      and p.is_public = true
      and p.visibility in ('public', 'community_public')
      -- ★ 0107/0114 と同一の可視性述語 (SECURITY DEFINER の RLS bypass 対策)
      and (public.can_view_post(p.id) or p.author_id = auth.uid())
      and public.author_visible(p.author_id)
      and p.created_at > now() - interval '7 days'
      -- 3日以内に2回以上見た投稿を除外
      and p.id not in (select post_id from seen_posts)
    order by p.hot_score desc nulls last
    limit 150
  ),
  -- 4. Value Model スコアリング
  --    cold start ユーザーは hot_score のみ (get_home_feed と同等の体験)
  scored as (
    select *,
      case
        when v_has_affinity then
          -- Personalized Value Model (Instagram Value Model の簡略版):
          -- タグ親和性: ユーザーが興味を持つタグの投稿を浮上させる
          -- エンゲージメント: log スケールで likes/comments を評価
          -- concern_penalty: 低品質コンテンツを抑制 (max 3.0 で cap)
          -- 鮮度 (8h half-life): 古い投稿を自然に沈める
          -- cold_boost: 新規投稿の初期露出を保証
          tag_affinity_bonus * 4.0
          + ln(greatest(likes_count::real, 0) + 1) * 2.0
          + ln(greatest(comments_count::real, 0) + 1) * 1.5
          - least(concern_count::real * 0.3, 3.0)
          + (1.0 / (1.0 + extract(epoch from (now() - created_at)) / 28800.0)) * 2.0
          + cold_boost
        else
          -- Cold start: hot_score をそのまま使用
          coalesce(hot_score, 0)
      end as for_you_score
    from base_candidates
  ),
  -- 5. 多様性: dominant tag (tag_names[1]) ごと最大3件
  --    同一タグの投稿が連続しないよう分散させる
  diverse as (
    select *,
      row_number() over (
        partition by coalesce(tag_names[1], '__none__')
        order by for_you_score desc
      ) as tag_rank
    from scored
  ),
  -- 6. 最終候補: 上位 v_limit 件
  foryou_pool as (
    select *
    from diverse
    where tag_rank <= 3
    order by for_you_score desc
    limit v_limit
  ),
  -- ── 以下 get_home_feed(0114) と同一の周辺データ JOIN ────────────────
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
    where pc.post_id in (select id from foryou_pool)
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
    join foryou_pool fp on fp.id = pc.post_id
    where c.is_official is true
      and c.official_admin_user_id is not null
      and c.official_admin_user_id = fp.author_id
    order by pc.post_id, pc.created_at asc
  ),
  my_likes_set as (
    select l.post_id from public.likes l
    where p_user_id is not null
      and l.user_id = p_user_id
      and l.post_id in (select id from foryou_pool)
  ),
  my_concerns_set as (
    select cn.post_id from public.concerns cn
    where p_user_id is not null
      and cn.user_id = p_user_id
      and cn.post_id in (select id from foryou_pool)
  ),
  my_saves_set as (
    select s.post_id from public.saves s
    where p_user_id is not null
      and s.user_id = p_user_id
      and s.post_id in (select id from foryou_pool)
  ),
  reactions_raw as (
    select
      r.post_id, r.meme,
      count(*)::int as cnt,
      bool_or(p_user_id is not null and r.user_id = p_user_id) as mine
    from public.post_reactions r
    where r.post_id in (select id from foryou_pool)
    group by r.post_id, r.meme
  ),
  reactions_agg as (
    select rr.post_id,
      json_agg(
        json_build_object('meme', rr.meme, 'count', rr.cnt, 'mine', rr.mine)
        order by rr.cnt desc, rr.meme
      ) as reactions
    from reactions_raw rr
    group by rr.post_id
  ),
  added_tags_raw as (
    select pat.post_id, pat.tag_name, min(pat.created_at) as first_seen
    from public.post_added_tags pat
    where pat.post_id in (select id from foryou_pool)
    group by pat.post_id, pat.tag_name
  ),
  added_tags_agg as (
    select atr.post_id,
      json_agg(atr.tag_name order by atr.first_seen) as added_tags
    from added_tags_raw atr
    group by atr.post_id
  ),
  polls_base as (
    select pl.id, pl.post_id, pl.question, pl.expires_at, pl.multi_select, pl.total_votes
    from public.polls pl
    where pl.post_id in (select id from foryou_pool)
  ),
  poll_options_agg as (
    select po.poll_id,
      json_agg(
        json_build_object('id', po.id, 'label', po.label, 'vote_count', po.vote_count)
        order by po.ordinal asc
      ) as options
    from public.poll_options po
    where po.poll_id in (select id from polls_base)
    group by po.poll_id
  ),
  my_poll_votes_agg as (
    select pv.poll_id, json_agg(pv.option_id) as my_vote_option_ids
    from public.poll_votes pv
    where p_user_id is not null
      and pv.user_id = p_user_id
      and pv.poll_id in (select id from polls_base)
    group by pv.poll_id
  ),
  polls_agg as (
    select pb.post_id,
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
            'id',                  fp.id,
            'content',             fp.content,
            'title',               fp.title,
            'last_activity_at',    fp.last_activity_at,
            'media_urls',          fp.media_urls,
            'media_blurhashes',    fp.media_blurhashes,
            'video_urls',          fp.video_urls,
            'video_durations',     fp.video_durations,
            'video_posters',       fp.video_posters,
            'tag_names',           fp.tag_names,
            'likes_count',         fp.likes_count,
            'comments_count',      fp.comments_count,
            'score',               fp.score,
            'hot_score',           fp.hot_score,
            'concern_count',       fp.concern_count,
            'kind',                fp.kind,
            'source_url',          fp.source_url,
            'is_public',           fp.is_public,
            'trust_score_at_post', fp.trust_score_at_post,
            'is_anonymous',        fp.is_anonymous,
            'content_warning',     fp.content_warning,
            'cw_category',         fp.cw_category,
            'visibility',          fp.visibility,
            'qa_mode',             fp.qa_mode,
            'created_at',          fp.created_at,
            -- ★ 匿名 author_id マスク (0113/0114 と同一パターン)
            'author_id',
              case
                when fp.is_anonymous
                 and (v_viewer is null or v_viewer is distinct from fp.author_id)
                then null
                else fp.author_id
              end,
            'is_own',              (v_viewer is not null and fp.author_id = v_viewer),
            'communities',         coalesce(ca.communities, '[]'::json),
            'official_author',     ol.official_author,
            'my_like',             (ml.post_id is not null),
            'my_concern',          (mc.post_id is not null),
            'my_save',             (ms.post_id is not null),
            'reactions',           coalesce(ra.reactions, '[]'::json),
            'added_tags',          coalesce(ata.added_tags, '[]'::json),
            'poll',                pla.poll
          )
          order by fp.for_you_score desc
        )
        from foryou_pool fp
        left join communities_agg ca  on ca.post_id  = fp.id
        left join official_lookup ol  on ol.post_id  = fp.id
        left join my_likes_set ml     on ml.post_id  = fp.id
        left join my_concerns_set mc  on mc.post_id  = fp.id
        left join my_saves_set ms     on ms.post_id  = fp.id
        left join reactions_agg ra    on ra.post_id  = fp.id
        left join added_tags_agg ata  on ata.post_id = fp.id
        left join polls_agg pla       on pla.post_id = fp.id
      ),
      '[]'::json
    ),
    -- nextCursor: hot_score|ISO_ts 形式 (fetchPosts cursor と互換)
    -- for_you_feed は1ページ目専用; 2ページ目以降は fetchPosts(cursor) 経路を使用
    'nextCursor',
    (
      select case
        when (select count(*) from foryou_pool) = v_limit then
          (
            select concat(
                     coalesce(fp.hot_score, 0)::text,
                     '|',
                     to_char(fp.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                   )
            from foryou_pool fp
            order by fp.for_you_score desc
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

grant execute on function public.get_for_you_feed(uuid, int) to authenticated;

select '0141_get_for_you_feed 完了 — Value Model 個人化フィード (150候補→Value Model→多様性→既読除外)' as note;
