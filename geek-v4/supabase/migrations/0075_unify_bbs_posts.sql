-- ============================================================
-- 0075_unify_bbs_posts.sql — BBS スレ ↔ 投稿 統合
-- ============================================================
-- 目的: bbs_threads / bbs_replies / bbs_reply_reactions を posts /
--       comments / comment_reactions に統合する。 UUID 保持で deep-link 互換。
-- 戦略: ON CONFLICT DO NOTHING で idempotent。 元 table は drop しない
--       (rollback 用に 1-2 週間保持、 0080 で drop)
--
-- 決定事項:
--   - スレッドはホームフィードに混ざる (posts.title is not null で識別)
--   - コメントに reaction stamp を拡張 (BBS 機能を comment 全体へ)
--   - UUID 1:1 保持で /bbs/[id] と /post/[id] のどちらでもアクセス可能
--   - bbs_threads / bbs_replies / bbs_reply_reactions は drop せず保持
--     (1-2 週間 rollback 余地、後続 0080 で drop)
--
-- 冪等性:
--   - 全ての ALTER は IF NOT EXISTS / IF EXISTS でガード
--   - 全ての INSERT は ON CONFLICT DO NOTHING
--   - 全ての CREATE は IF NOT EXISTS
--   → 2 回 apply してもエラー無し
-- ============================================================

begin;

-- ============================================================
-- Step 0: 前提 extension 確保 (gin_trgm_ops 用)
-- ============================================================
-- title 用 GIN trgm index を作るため pg_trgm が必要。 0071 で既に作成済の
-- 環境では idempotent (no-op)。 まだ未作成の環境では今ここで作成する。
-- (0075 を 0071 より先に apply するパス、 単独 dev 環境などで pg_trgm 抜けの
-- 防御。)
-- ============================================================
create extension if not exists pg_trgm;

-- ============================================================
-- Step 1: posts に title (NULLABLE) と last_activity_at を追加
-- ============================================================
-- title is null    = 通常の post (本文 only)
-- title is not null = BBS スレ移行 or 新規スレ形式 post
alter table public.posts
  add column if not exists title text check (title is null or length(title) between 1 and 80),
  add column if not exists last_activity_at timestamptz;

-- 検索 (search.tsx の post title 検索用)
create index if not exists posts_title_trgm_idx on public.posts using gin (title gin_trgm_ops);
-- BBS 風 "最新の動き" sort 用
create index if not exists posts_last_activity_idx on public.posts(last_activity_at desc nulls last);

-- ============================================================
-- Step 1.5: posts_content_check を緩和 — スレ形式 (title あり) は content 空 OK
-- ============================================================
-- 旧制約 (0001): check (length(content) between 1 and 2000)
-- → BBS thread 移行で content='' を insert すると 23514 エラー。
--
-- 新ルール:
--   - 通常の post: title=null + content 1〜2000 char (従来)
--   - スレ形式 post: title あり + content 任意 (空 OK)
-- ============================================================
alter table public.posts drop constraint if exists posts_content_check;
alter table public.posts add constraint posts_content_check
  check (
    title is not null                          -- スレ形式: title があれば content 空 OK
    or (length(content) between 1 and 2000)   -- 通常 post: 1〜2000 char
  );

-- ============================================================
-- Step 2: comments の content cap を 500 → 1000 に bump
-- ============================================================
-- BBS reply は 1000 char まで許可していた (bbs_replies の check 参照)。
-- 統合先の comments も同じ上限に揃える。
alter table public.comments drop constraint if exists comments_content_check;
alter table public.comments add constraint comments_content_check check (length(content) between 1 and 1000);

-- ============================================================
-- Step 3: posts に community_id_legacy (一時 staging 列) を追加
-- ============================================================
-- bbs_threads.community_id は単一参照だが、 posts は post_communities (M:N)。
-- 一旦 staging 列に流し、 Step 7 で post_communities に展開してから Step 8 で drop。
alter table public.posts add column if not exists community_id_legacy uuid;

-- ============================================================
-- Step 4: bbs_threads → posts 移行
-- ============================================================
-- - UUID 保持 (deep-link 互換)
-- - content は空文字 (BBS スレは本文無し、 タイトルのみ)
-- - title の内部 [vN] prefix は除去 (lib/api/bbs.ts:cleanTitle 同等)
-- - category → tag_names 配列に変換 (空 category は空配列)
-- - is_anonymous true / is_public true で BBS スレの既存挙動を踏襲
-- - media_urls / media_blurhashes は空配列
-- - last_activity_at = last_reply_at or created_at
-- - score / hot_score は 0 (後続の cron で再計算)
insert into public.posts (
  id, author_id, content, title, tag_names, is_anonymous, is_public,
  media_urls, media_blurhashes,
  visibility, community_id_legacy,
  created_at, updated_at,
  last_activity_at, score, hot_score
)
select
  bt.id, bt.author_id,
  '' as content,
  -- 内部 [vN] prefix を除去 (lib/api/bbs.ts:cleanTitle 同等)
  regexp_replace(coalesce(bt.title, ''), '^\s*\[v\d+\]\s*', '') as title,
  case
    when bt.category is null or trim(bt.category) = '' then array[]::text[]
    else array[bt.category]::text[]
  end as tag_names,
  true as is_anonymous,
  true as is_public,
  array[]::text[] as media_urls,
  array[]::text[] as media_blurhashes,
  bt.visibility,
  bt.community_id as community_id_legacy,
  bt.created_at, bt.updated_at,
  coalesce(bt.last_reply_at, bt.created_at) as last_activity_at,
  0 as score, 0 as hot_score
from public.bbs_threads bt
on conflict (id) do nothing;

-- ============================================================
-- Step 5: bbs_replies → comments 移行
-- ============================================================
-- - UUID 保持
-- - thread_id → post_id (1:1 対応、 Step 4 で posts 側に同じ UUID で挿入済)
-- - content は念のため left(.., 1000) で truncate (Step 2 で 1000 まで許可)
-- - color → avatar_color (rename)
insert into public.comments (id, post_id, author_id, content, avatar_color, created_at)
select br.id, br.thread_id, br.author_id, left(br.content, 1000), br.color, br.created_at
from public.bbs_replies br
on conflict (id) do nothing;

-- ============================================================
-- Step 6: comments_count backfill on migrated posts
-- ============================================================
-- BBS から移行された posts (title is not null) のみ対象。
-- 既存の通常 post の comments_count はトリガで維持されているので触らない。
update public.posts p
   set comments_count = sub.c
  from (select post_id, count(*) c from public.comments group by post_id) sub
 where sub.post_id = p.id and p.title is not null;

-- ============================================================
-- Step 7: community_id_legacy → post_communities 移行
-- ============================================================
-- 単一 community 紐付け → M:N テーブルへ展開
insert into public.post_communities (post_id, community_id, created_at)
select id, community_id_legacy, created_at
from public.posts
where community_id_legacy is not null
on conflict do nothing;

-- ============================================================
-- Step 8: staging 列を drop
-- ============================================================
alter table public.posts drop column if exists community_id_legacy;

-- ============================================================
-- Step 9: comment_reactions 新規 table
-- ============================================================
-- BBS の reaction stamp 機能を全 comment に拡張。
-- shape は bbs_reply_reactions と完全一致 (reply_id → comment_id rename のみ)。
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  meme       text not null check (length(meme) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, meme)
);

alter table public.comment_reactions enable row level security;

-- RLS: 全公開 read / 自分のだけ insert / 自分のだけ delete (bbs_reply_reactions と同じ)
drop policy if exists "cr_read"   on public.comment_reactions;
drop policy if exists "cr_insert" on public.comment_reactions;
drop policy if exists "cr_delete" on public.comment_reactions;
create policy "cr_read"   on public.comment_reactions for select using (true);
create policy "cr_insert" on public.comment_reactions for insert with check (auth.uid() = user_id);
create policy "cr_delete" on public.comment_reactions for delete using (auth.uid() = user_id);

create index if not exists comment_reactions_comment_idx on public.comment_reactions(comment_id);

-- ============================================================
-- Step 10: bbs_reply_reactions → comment_reactions 移行
-- ============================================================
-- reply_id → comment_id (Step 5 で 1:1 UUID で comments へ移行済)
insert into public.comment_reactions (comment_id, user_id, meme, created_at)
select reply_id, user_id, meme, coalesce(created_at, now())
from public.bbs_reply_reactions
on conflict do nothing;

-- ============================================================
-- Step 11: realtime publication に comment_reactions を追加
-- ============================================================
-- supabase_realtime に未登録の table を subscribe すると CHANNEL_ERROR で
-- channel 全死するため、ここで明示的に登録 (CLAUDE.md § 5.3 参照)。
-- DO ブロックで「既に登録済み」例外を握りつぶす (冪等)。
do $$
begin
  alter publication supabase_realtime add table public.comment_reactions;
exception
  when duplicate_object then
    raise notice '0075: comment_reactions already in supabase_realtime publication';
  when others then
    -- publication が無い環境 (CI / 部分セットアップ) では黙って skip
    raise notice '0075: skip realtime publication add: %', sqlerrm;
end $$;

commit;

-- ============================================================
-- Step 12: get_feed_page RPC を更新
-- ============================================================
-- 既存 0041 / 0073 (cap 付き) の body をそのまま踏襲し、 SELECT clause に
-- p.title と p.last_activity_at の 2 列を追加するだけ。
-- 関数の DDL はトランザクション外 (CREATE OR REPLACE FUNCTION は per-statement)。
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
    raise notice '0075: prerequisite tables missing, skip rpc update';
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

    -- 入力上限 (0073 で導入): 100 件超は reject
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
        p.title,                -- ★ 0075 追加: BBS 統合用タイトル
        p.last_activity_at,     -- ★ 0075 追加: 最終アクティビティ時刻
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
                     'title',               pr.title,                -- ★ 0075 追加
                     'last_activity_at',    pr.last_activity_at,     -- ★ 0075 追加
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

  -- create or replace で grant は維持されるが、明示再付与で安全側に
  grant execute on function public.get_feed_page(uuid[], uuid) to authenticated;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0075_unify_bbs_posts 完了 — bbs tables は rollback 用に keep' as note;
