-- ============================================================
-- 0087_page_experience.sql — Page Experience / コンテンツのユーザビリティ
-- ============================================================
-- 目的:
--   Google の "Page Experience" シグナルに相当する「コンテンツのユーザビリティ」
--   を SQL で評価し、検索 / フィードの ranking タイブレーカーとして使う。
--
--   評価ファクター:
--     length_score        — 文字数の最適性 (50-2000 字 が peak)
--     media_score         — 写真 / 動画 添付があるか
--     link_health_score   — 本文の http リンクが多すぎる post を低評価 (spam 対策)
--     engagement_velocity — 作成 24h 内に like がついた速度
--   合算した usability_score (0..1) を view で公開する。
--
-- 既存 schema (確認済 — 既存 migration 編集はしない):
--   posts.id           uuid
--   posts.content      text not null
--   posts.media_urls   text[] not null default '{}'  (画像 — 0001)
--   posts.video_urls   text[] not null default '{}'  (動画 — 0043)
--   posts.created_at   timestamptz
--   posts.author_id    uuid -> profiles(id)
--   posts.likes_count  integer (cached count)
--   likes              table (user_id, post_id) PK  (0001)
--                      ※ "post_likes" ではなく "likes"
--   profiles.trust_score integer 0..100 default 50  (0001)
--
-- 既存 index 前提 (確認済):
--   likes_post_idx on public.likes(post_id)         — 0014
--   posts_created_at_idx on public.posts(created_at desc) — 0001
--
-- 設計判断:
--   * すべて create [or replace] / drop ... if exists で冪等。
--   * column 追加 ( quality_score 等) は行わない — 仕様の 5 番は optional で、
--     trigger 維持コストが高いため view 経由のみで提供する。
--   * SECURITY DEFINER の関数は search_path = pg_catalog, public で lockdown
--     (PostgreSQL search_path 注入対策 — 0083 / 0085 と同じスタイル)。
--   * view 自体は public.posts の RLS を bypass しない (view は invoker の権限で動く)。
--     get_post_quality / trending_in_window の RPC は SECURITY DEFINER だが、
--     archived / deleted を除外する条件は組み込まない (現状 column が無いため)。
--   * パフォーマンス: post_quality_score view は post 単位の単純集計のみで、
--     サブクエリ count(*) は likes_post_idx (0014) を利用するので O(log n)。
--     大量行を捌くケースは trending_in_window で window 句を絞る前提。
-- ============================================================

-- ============================================================
-- 1. post_quality_score — view (公開)
-- ============================================================
-- 各 post に対して 4 ファクターの個別スコア + 合算 usability_score を返す。
-- 値域はすべて 0..1 で正規化。
-- ============================================================
drop view if exists public.post_quality_score cascade;
create or replace view public.post_quality_score as
select
  p.id as post_id,

  -- 1) 文字数の最適性 (短すぎず長すぎず: 50-2000 字 が peak)
  --    posts.content の length 制約は 1..1000 (0001) → 5000 までいくケースは
  --    将来の制約緩和を見据えて分岐を残す。
  case
    when length(coalesce(p.content, '')) between 50 and 2000 then 1.0
    when length(coalesce(p.content, '')) between 20 and 5000 then 0.7
    else 0.4
  end::numeric as length_score,

  -- 2) メディア有無 (media_urls or video_urls が空でなければ加点)
  --    元仕様の image_url / video_url は本 schema には無いため、
  --    text[] の cardinality で判定する。
  case
    when cardinality(coalesce(p.media_urls, '{}'::text[])) > 0
      or cardinality(coalesce(p.video_urls, '{}'::text[])) > 0
    then 1.0
    else 0.85
  end::numeric as media_score,

  -- 3) リンク健全性 (http リンクの個数で減点 — spam 対策)
  --    regexp_split_to_array で 'https?://' 区切りにし、配列長 - 1 = 出現回数。
  --    content が null の場合 coalesce で空文字に。
  case
    when coalesce(array_length(regexp_split_to_array(coalesce(p.content, ''), 'https?://'), 1), 1) - 1 > 5 then 0.5
    when coalesce(array_length(regexp_split_to_array(coalesce(p.content, ''), 'https?://'), 1), 1) - 1 > 2 then 0.8
    else 1.0
  end::numeric as link_health_score,

  -- 4) engagement velocity (24h 以内: いいね数 / 10 を 0..1 で normalize、超過は 1.0 cap)
  --    24h を超えた古い post は 0.5 の neutral 値。
  --    likes table は (user_id, post_id) PK + likes_post_idx (0014) があるので
  --    count(*) は post_id seek で済む。
  case
    when p.created_at > now() - interval '24 hours' then
      least(
        1.0,
        coalesce(
          (select count(*)::numeric from public.likes l where l.post_id = p.id),
          0
        ) / 10.0
      )
    else 0.5
  end::numeric as engagement_velocity,

  -- 5) usability_score: 上記 4 ファクターの加重平均
  --    weights: length 0.3 / media 0.2 / link 0.3 / velocity 0.2
  (
    (case
      when length(coalesce(p.content, '')) between 50 and 2000 then 1.0
      when length(coalesce(p.content, '')) between 20 and 5000 then 0.7
      else 0.4
     end) * 0.3
    +
    (case
      when cardinality(coalesce(p.media_urls, '{}'::text[])) > 0
        or cardinality(coalesce(p.video_urls, '{}'::text[])) > 0
      then 1.0 else 0.85
     end) * 0.2
    +
    (case
      when coalesce(array_length(regexp_split_to_array(coalesce(p.content, ''), 'https?://'), 1), 1) - 1 > 5 then 0.5
      when coalesce(array_length(regexp_split_to_array(coalesce(p.content, ''), 'https?://'), 1), 1) - 1 > 2 then 0.8
      else 1.0
     end) * 0.3
    +
    (case
      when p.created_at > now() - interval '24 hours' then
        least(
          1.0,
          coalesce(
            (select count(*)::numeric from public.likes l2 where l2.post_id = p.id),
            0
          ) / 10.0
        )
      else 0.5
     end) * 0.2
  )::numeric as usability_score
from public.posts p;

comment on view public.post_quality_score is
  'Page Experience / コンテンツのユーザビリティスコア。length / media / link_health / engagement_velocity から usability_score を 0..1 で算出';

-- view 自体の SELECT 権限 (RLS は invoker 側の posts に適用される)
grant select on public.post_quality_score to anon, authenticated;

-- ============================================================
-- 2. get_post_quality(p_post_id) — RPC
-- ============================================================
-- 透明性 (transparency) 用: あるポストの usability_score の内訳を返す。
-- public な情報なので auth 不要。
-- ============================================================
drop function if exists public.get_post_quality(uuid);
create or replace function public.get_post_quality(p_post_id uuid)
returns table (
  post_id uuid,
  length_score numeric,
  media_score numeric,
  link_health_score numeric,
  engagement_velocity numeric,
  usability_score numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    pqs.post_id,
    pqs.length_score,
    pqs.media_score,
    pqs.link_health_score,
    pqs.engagement_velocity,
    pqs.usability_score
  from public.post_quality_score pqs
  where pqs.post_id = p_post_id;
$$;

revoke all on function public.get_post_quality(uuid) from public;
grant execute on function public.get_post_quality(uuid) to anon, authenticated;

-- ============================================================
-- 3. trending_in_window(p_window_hours, p_limit) — RPC
-- ============================================================
-- 直近 N 時間の posts を engagement_velocity DESC で並べる。
-- スポーツ得点 / 時事ネタの「最新」要件用。
-- recency と usability の両方で sort (engagement → usability → 新しさ)。
-- ============================================================
drop function if exists public.trending_in_window(int, int);
create or replace function public.trending_in_window(
  p_window_hours int default 24,
  p_limit int default 20
)
returns table (
  post_id uuid,
  created_at timestamptz,
  author_id uuid,
  engagement_velocity numeric,
  usability_score numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window int := greatest(coalesce(p_window_hours, 24), 1);
  v_limit  int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  return query
  select
    p.id as post_id,
    p.created_at,
    p.author_id,
    pqs.engagement_velocity,
    pqs.usability_score
  from public.posts p
  join public.post_quality_score pqs on pqs.post_id = p.id
  where p.created_at > now() - make_interval(hours => v_window)
  order by
    pqs.engagement_velocity desc,
    pqs.usability_score    desc,
    p.created_at           desc
  limit v_limit;
end;
$$;

revoke all on function public.trending_in_window(int, int) from public;
grant execute on function public.trending_in_window(int, int) to anon, authenticated;

-- ============================================================
-- 4. v_search_signals — view (集約)
-- ============================================================
-- 既存 / 将来の search v2/v3 RPC が参照しやすいよう、
-- post + author trust + usability を 1 行で出す view。
-- ============================================================
drop view if exists public.v_search_signals cascade;
create or replace view public.v_search_signals as
select
  p.id          as post_id,
  p.created_at,
  p.author_id,
  pr.trust_score as author_trust,
  pqs.usability_score
from public.posts p
left join public.profiles pr           on pr.id = p.author_id
left join public.post_quality_score pqs on pqs.post_id = p.id;

comment on view public.v_search_signals is
  '検索 ranking 用の集約 view: post_id / created_at / author_id / author_trust / usability_score';

grant select on public.v_search_signals to anon, authenticated;

-- ============================================================
-- 5. ANALYZE
-- ============================================================
-- view 経由なので table の stats を refresh する。
-- likes_post_idx (0014) と posts_created_at_idx (0001) が effective である
-- ことを planner に再認識させる。
analyze public.posts;
analyze public.likes;

select '0087_page_experience 完了 — post_quality_score / v_search_signals views + get_post_quality / trending_in_window RPC' as note;
