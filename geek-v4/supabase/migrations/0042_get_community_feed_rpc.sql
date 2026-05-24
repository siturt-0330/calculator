-- ============================================================
-- 0042_get_community_feed_rpc.sql
-- ============================================================
-- 「コミュタブ」の最新投稿フィードを 1 RPC で返す。
--
-- 背景:
--   コミュタブの index.tsx は fetchMyCommunityPostsRich() を呼ぶが、
--   内部で 4 連 query を発射していた (community_members → post_communities →
--   posts → communities)。各 query 間で TCP / TLS RTT が積み重なり、
--   p50 で 800ms 程度かかっていた。
--
--   この RPC は同じデータ集合 (Post[] + community_id + author_nickname +
--   official_author) を 1 ラウンドトリップで返す。
--
-- 設計:
--   - SECURITY DEFINER で auth.users 経由のチェックを省略
--     visibility='community_only' でも RPC 内では全件取得できる
--     (返却は「自分が member の community に attach されている post」のみ)
--   - LANGUAGE plpgsql STABLE
--   - set search_path = public, pg_temp で hijack 防止
--   - すべてのテーブル存在を to_regclass で防御 (CI / 部分セットアップで死なない)
--   - 重複削除は post_id 単位で最新 attach の community_id を採用
--   - post 順は post_communities.created_at desc (= 新しく attach された順)
--
-- 返却 shape (json):
--   {
--     "posts": [
--       { ...POSTS_SELECT_COLS, community_id, author_nickname, official_author },
--       ...
--     ]
--   }
--   posts は最大 p_limit 件 (default 40)。空なら {"posts": []}。
-- ============================================================

do $$
begin
  -- 前提テーブル不在ならスキップ (CI / 部分セットアップで死なない)
  if to_regclass('public.community_members') is null
     or to_regclass('public.post_communities') is null
     or to_regclass('public.posts') is null
     or to_regclass('public.communities') is null
     or to_regclass('public.profiles') is null then
    raise notice '0042: prerequisite tables missing, skip rpc creation';
    return;
  end if;

  -- 旧シグネチャを drop (idempotent + 引数違いの上書き対策)
  begin
    execute 'drop function if exists public.get_community_feed(uuid, int)';
  exception when others then
    -- 他で参照されている場合は cascade せず黙って続ける
    raise notice '0042: drop existing get_community_feed failed: %', sqlerrm;
  end;

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
    --
    -- CTE で段階的に絞る。post_communities 側で row_number() を使い、
    -- 同一 post_id の重複行を「最新の created_at の 1 行」だけに圧縮する。
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
        -- 動画 (migration 0043 で追加)。plpgsql は create 時 column 検証無し。
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
                     'author_id', pr.author_id,
                     'community_id', pr.community_id,
                     -- author_nickname は is_anonymous=true の時は出さない
                     'author_nickname',
                       case when pr.is_anonymous then null
                            else prof.nickname end,
                     -- official_author: 公式コミュ管理者投稿 → 実名 + 所属
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
select '0042_get_community_feed_rpc 完了: get_community_feed(uuid, int) returns json (SECURITY DEFINER, STABLE)' as result;
