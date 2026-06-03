-- ============================================================
-- 0113_get_discovery_payload.sql — 検索タブ「特集/Discovery」を 1 RTT に集約
-- ============================================================
-- ⚠️ レビュー必須: これは SECURITY DEFINER で投稿本文を返す関数です。
--    適用前に下記の安全策が意図どおりか必ず確認してください。
--
-- 目的 (パフォーマンス):
--   (tabs)/search.tsx の DiscoveryView は空クエリ時に ~7 本の独立 round-trip を
--   fan-out していた (hot / for-you / おすすめ / 急上昇 / 公式 / my-community-ids /
--   trending)。本 RPC は server 側で完結する 5 セクション
--     { hot, recommended, rising, official, my_community_ids }
--   を 1 ラウンドトリップ・1 json で返す。trending は別の軽量 RPC のまま。
--   ★ hot は HotPostsRow と ForYouShelf の共有プール (ForYou は端末ローカルで再ランク)。
--
-- 安全策 (本番稼働中 get_feed_page=0107 と同一パターンを厳密コピー):
--   (S2) 可視性述語: SECURITY DEFINER は RLS を bypass するため、0107:113-114 と
--        同じ `(can_view_post(p.id) or p.author_id = auth.uid()) and author_visible(p.author_id)`
--        を posts join に明示 → private / community_only / shadowbanned 投稿の漏えい防止。
--   (P1) 3 条件フィルタ: `is_anonymous = true and is_public = true and
--        visibility in ('public','community_public')` (= fetchPosts(home) と同一)。
--   (S1) 匿名 author_id マスク: discovery は全件匿名なので、official_author を実 author_id で
--        先に解決した後、出力 author_id は viewer 本人以外には NULL にする (0107 は未マスクだが
--        本 RPC はより厳格側に倒す = 匿名性の核を守る)。
--   IDOR gate: p_user_id が auth.uid() と不一致なら 42501 (0079/0107 と同じ)。
--
--   community 3 リストは各クライアント fetcher のフィルタを個別に複製 (統一しない):
--     recommended = visibility in('open','request') / member_count desc, created_at desc
--     rising      = visibility in('open','request') and last_post_at is not null / last_post_at desc
--     official    = is_official = true / member_count desc, created_at desc  (visibility 制限なし=現行通り)
--   ※ invite コミュは recommended/rising から除外され続ける (private コミュの存在漏えい防止)。
--
-- 冪等: CREATE OR REPLACE (top-level 定義。do $$..$$ で包むと一部 SQL editor の statement
--   splitter が nested dollar-quote を誤分割し "syntax error at uuid" になるため非使用)。
-- クライアントは RPC 不在/失敗時に従来の per-shelf 経路へ fallback するので、
-- この migration 未適用でも壊れない (lib/api/discovery.ts)。
-- ============================================================

-- ★ 関数は top-level で定義 (do $$..$$ で包むと SQL editor の splitter が nested
--   dollar-quote を誤分割するため)。plpgsql body は遅延束縛なので前提 table/helper は実行時解決。

  create or replace function public.get_discovery_payload(
    p_user_id           uuid default null,
    p_hot_limit         int default 18,
    p_recommended_limit int default 8,
    p_rising_limit      int default 10,
    p_official_limit    int default 10
  )
  returns json
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_viewer  uuid;
    v_hot     int;
    v_rec     int;
    v_ris     int;
    v_off     int;
    v_result  json;
  begin
    -- IDOR gate (0079/0107 と同じ): 他人の p_user_id を渡せない。
    if p_user_id is not null and p_user_id <> auth.uid() then
      raise exception 'forbidden: p_user_id must match auth.uid()' using errcode = '42501';
    end if;
    v_viewer := auth.uid();

    -- limit clamps (DoS 防止)
    v_hot := least(greatest(coalesce(p_hot_limit, 18), 1), 50);
    v_rec := least(greatest(coalesce(p_recommended_limit, 8), 1), 50);
    v_ris := least(greatest(coalesce(p_rising_limit, 10), 1), 50);
    v_off := least(greatest(coalesce(p_official_limit, 10), 1), 50);

    with hot_pool as (
      select
        p.id, p.content, p.title, p.last_activity_at,
        p.media_urls, p.media_blurhashes,
        p.video_urls, p.video_durations, p.video_posters,
        p.tag_names, p.likes_count, p.comments_count, p.score, p.hot_score,
        p.concern_count, p.kind, p.source_url, p.is_public,
        p.trust_score_at_post, p.is_anonymous, p.content_warning, p.cw_category,
        p.visibility, p.qa_mode, p.created_at, p.author_id
      from public.posts p
      where p.is_anonymous = true
        and p.is_public = true
        and p.visibility in ('public', 'community_public')
        -- ★ 0107:113-114 と同一の可視性述語 (RLS bypass 対策)
        and (public.can_view_post(p.id) or p.author_id = auth.uid())
        and public.author_visible(p.author_id)
      order by p.hot_score desc nulls last, p.created_at desc
      limit v_hot
    ),
    -- official_author は「マスク前の実 author_id」で先に解決する
    hot_official as (
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
    hot_json as (
      select coalesce(
        json_agg(
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
            -- ★ 匿名 author_id マスク: viewer 本人以外には NULL (0076 方針)
            'author_id',
              case
                when hp.is_anonymous
                 and (v_viewer is null or v_viewer is distinct from hp.author_id)
                then null
                else hp.author_id
              end,
            'official_author',     ho.official_author
          )
          order by hp.hot_score desc nulls last, hp.created_at desc
        ),
        '[]'::json
      ) as v
      from hot_pool hp
      left join hot_official ho on ho.post_id = hp.id
    ),
    recommended as (
      select coalesce(json_agg(to_json(c) order by c.member_count desc nulls last, c.created_at desc), '[]'::json) as v
      from (
        select * from public.communities
        where visibility in ('open', 'request')
        order by member_count desc nulls last, created_at desc
        limit v_rec
      ) c
    ),
    rising as (
      select coalesce(json_agg(to_json(c) order by c.last_post_at desc), '[]'::json) as v
      from (
        select * from public.communities
        where visibility in ('open', 'request') and last_post_at is not null
        order by last_post_at desc
        limit v_ris
      ) c
    ),
    official as (
      select coalesce(json_agg(to_json(c) order by c.member_count desc nulls last, c.created_at desc), '[]'::json) as v
      from (
        select * from public.communities
        where is_official = true
        order by member_count desc nulls last, created_at desc
        limit v_off
      ) c
    ),
    mine as (
      select coalesce(json_agg(cm.community_id), '[]'::json) as v
      from public.community_members cm
      where p_user_id is not null and cm.user_id = p_user_id
    )
    select json_build_object(
      'hot',              (select v from hot_json),
      'recommended',      (select v from recommended),
      'rising',           (select v from rising),
      'official',         (select v from official),
      'my_community_ids', (select v from mine)
    ) into v_result;

    return v_result;
  end;
  $fn$;

  grant execute on function public.get_discovery_payload(uuid, int, int, int, int) to authenticated;

select '0113_get_discovery_payload 完了: 検索 discovery を 1 RTT 集約 (0107 可視性述語+匿名マスク+3条件フィルタ)' as note;
