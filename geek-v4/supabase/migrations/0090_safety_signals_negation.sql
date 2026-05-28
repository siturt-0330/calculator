-- ============================================================
-- 0090_safety_signals_negation.sql — Safety / Clickbait / Toxicity signal を Task Negation 用に導出
-- ============================================================
-- 目的:
--   検索 / フィードランキング (将来の v4 RPC = 0097) における
--   "Task Negation": ある post が「ユーザーが避けたい性質」を
--   どれだけ持つかをスコア化し、最終スコアから *負係数で減算* する
--   ための signal を view + RPC で公開する。
--
--   このマイグレーションが提供するもの:
--     1. post_safety_score view
--          - clickbait_score        (タイトル / 本文の煽り判定 0..1)
--          - spam_score             (URL 連投 / hashtag・mention 過多 0..1)
--          - low_signal_score       (極端に短い + media 無し 0..1)
--          - concern_density        (concern / likes 比率 0..1)
--          - composite_safety_negation (上記 4 つの max 0..1)
--     2. community_safety_aggregate view
--          - community_id, post_count, avg_safety_negation
--          - 運用 UI で community 単位の品質を観察する
--     3. RPC get_post_safety(p_post_id)
--          - transparency 用 ("この結果について" の safety factor 内訳)
--     4. RPC flag_post_safety(p_post_id, p_signal, p_value, p_reason)
--          - admin がマニュアルで signal を override する
--     5. post_safety_manual_override table
--          - admin override の保存先、composite view で優先される
--
-- 設計判断:
--   * すべて create [or replace] / if not exists / drop ... if exists で
--     冪等。何度流しても OK。
--   * SECURITY DEFINER の関数は search_path = pg_catalog, public で
--     lockdown (0083 / 0085 / 0086 / 0087 と同じスタイル)。
--   * 文字列マッチは Postgres の `~*` (case-insensitive POSIX regex)
--     を使う。ilike とは違って 1 つの pattern に複数語を OR で
--     書ける (= スキャン 1 回で済む)。
--   * post_safety_score view は SECURITY INVOKER (= default) で動くので
--     posts の RLS が呼び出し側の view 経由でも効く。
--     RPC は SECURITY DEFINER だが、参照する posts/profiles は public で
--     読み取り可能なため RLS bypass 問題は発生しない。
--   * RPC は negation 値を *正の数 0..1* で返す。v4 RPC (0097) は
--     `final_score = base_score - composite_safety_negation * w_negation`
--     という形で減算する (= 負係数で取り込む)。
--   * concern_density は concern_count / max(likes_count + 1, 5) を
--     min(1.0, x) で cap。likes が 0 でも 1 と base にして
--     除算 0 を回避し、低 engagement 投稿で過敏に negation が出ない
--     よう底値 5 でならす。
--
-- 既存 schema 前提 (確認済 — 既存 migration 編集はしない):
--   posts.id            uuid                                  (0001)
--   posts.title         text nullable                         (0075)
--   posts.content       text not null                         (0001)
--   posts.media_urls    text[] not null default '{}'          (0001)
--   posts.video_urls    text[] not null default '{}'          (0043)
--   posts.likes_count   integer not null default 0            (0001)
--   posts.concern_count integer not null default 0            (0006)
--   posts.created_at    timestamptz                           (0001)
--   posts.author_id     uuid -> profiles(id)                  (0001)
--   profiles.trust_score integer 0..100 default 50            (0001)
--   profiles.is_admin   boolean not null default false        (0012 / 0027)
--   post_communities(post_id, community_id) PK                (0023)
--   public.is_admin() : SECURITY DEFINER helper               (0027)
-- ============================================================

-- ============================================================
-- 1. post_safety_manual_override — table
-- ============================================================
-- admin が個別 post の特定 signal (clickbait / spam / low_signal) を
-- マニュアルで override するときの保存先。view 側が優先採用する。
-- ============================================================
create table if not exists public.post_safety_manual_override (
  post_id   uuid        not null references public.posts(id) on delete cascade,
  signal    text        not null
              check (signal in ('clickbait','spam','low_signal')),
  value     numeric     not null
              check (value >= 0 and value <= 1),
  reason    text        not null
              check (length(reason) between 1 and 500),
  set_by    uuid        not null references public.profiles(id) on delete set null,
  set_at    timestamptz not null default now(),
  primary key (post_id, signal)
);

create index if not exists post_safety_manual_override_post_idx
  on public.post_safety_manual_override(post_id);
create index if not exists post_safety_manual_override_set_at_idx
  on public.post_safety_manual_override(set_at desc);

alter table public.post_safety_manual_override enable row level security;

-- 読み取りは admin のみ
drop policy if exists "psmo_read_admin" on public.post_safety_manual_override;
create policy "psmo_read_admin" on public.post_safety_manual_override
  for select using (public.is_admin());

-- 書き込みは SECURITY DEFINER 関数経由のみ
drop policy if exists "psmo_write_admin" on public.post_safety_manual_override;
create policy "psmo_write_admin" on public.post_safety_manual_override
  for all using (public.is_admin()) with check (public.is_admin());

-- 直接 INSERT / UPDATE / DELETE は revoke (RPC 経由で書く)
revoke insert, update, delete on public.post_safety_manual_override from anon;
revoke insert, update, delete on public.post_safety_manual_override from authenticated;
revoke insert, update, delete on public.post_safety_manual_override from public;

comment on table public.post_safety_manual_override is
  'Admin が個別 post の safety signal を override するための table。post_safety_score view が優先採用する';

-- ============================================================
-- 2. post_safety_score — view
-- ============================================================
-- 各 post に対して 4 signal + 合成 composite_safety_negation を返す。
-- 値域はすべて 0..1 (= negation の大きさ)。
--
-- 各 signal の計算:
--   clickbait_score:
--     - タイトルに「!!!」「衝撃」「絶対」「神」「ヤバい」「驚愕」「マジで」等の
--       煽り語 + title 長さが短い + 本文/title 比が小さい場合に高い。
--     - regex で 1 つでも hit したら 0.6 を base、短タイトル (< 30 字) で +0.2、
--       本文/title 比 < 3.0 で +0.2、cap 1.0。
--   spam_score:
--     - 本文中の URL 出現回数 (>= 3) で +0.4、hashtag 数 (>= 5) で +0.3、
--       mention 数 (>= 5) で +0.3。同一 URL の繰り返しは粗く検知。cap 1.0。
--   low_signal_score:
--     - content が 20 字未満 で base 0.5、media_urls / video_urls が空なら +0.4、
--       title も空なら +0.1。cap 1.0。
--   concern_density:
--     - concern_count / max(likes_count + 1, 5) を min(1.0, x) で cap。
--   composite_safety_negation:
--     - 上記 4 signal の greatest() (= max)。1 つでも高ければ
--       negation を強める設計。manual override は signal 別に優先する。
-- ============================================================
drop view if exists public.post_safety_score cascade;
create or replace view public.post_safety_score as
with
  raw as (
    select
      p.id          as post_id,
      coalesce(p.title, '')   as title_txt,
      coalesce(p.content, '') as content_txt,
      coalesce(p.likes_count, 0)    as likes_count,
      coalesce(p.concern_count, 0)  as concern_count,
      cardinality(coalesce(p.media_urls, '{}'::text[])) as media_n,
      cardinality(coalesce(p.video_urls, '{}'::text[])) as video_n
    from public.posts p
  ),
  override as (
    select
      post_id,
      max(case when signal = 'clickbait'  then value end) as o_clickbait,
      max(case when signal = 'spam'       then value end) as o_spam,
      max(case when signal = 'low_signal' then value end) as o_low_signal
    from public.post_safety_manual_override
    group by post_id
  ),
  computed as (
    select
      r.post_id,
      r.title_txt,
      r.content_txt,
      r.likes_count,
      r.concern_count,
      r.media_n,
      r.video_n,

      -- ----- clickbait -----
      -- タイトルの煽り語マッチ (case-insensitive POSIX regex)
      -- ユーザー指定の煽り語: !!! / 衝撃 / 絶対 / 神 / ヤバい / 驚愕 / マジで
      -- (やばい / まじで のかな表記も拾う)
      case when r.title_txt ~* '(!!!|衝撃|絶対|神|ヤバい|やばい|驚愕|マジで|まじで)' then 1 else 0 end
        as clickbait_hit,
      -- 短いタイトル (< 30 字)
      case when length(r.title_txt) > 0 and length(r.title_txt) < 30 then 1 else 0 end
        as title_short,
      -- 本文/title 比が小さい (< 3.0) — title が大きく content が短い = 釣り
      case
        when length(r.title_txt) > 0
         and length(r.content_txt)::numeric / greatest(length(r.title_txt), 1)::numeric < 3.0
        then 1 else 0
      end as low_body_ratio,

      -- ----- spam -----
      -- URL 出現回数 ('https?://' で split し、配列長 - 1 = 個数)
      greatest(
        coalesce(array_length(regexp_split_to_array(r.content_txt, 'https?://'), 1), 1) - 1,
        0
      ) as url_count,
      -- 異なる URL の数 (regexp_matches は g フラグで 1 マッチ 1 行を返す。
      -- 各行は text[] (capture group の配列) なので m[1] を取り出して distinct count)
      (
        select count(distinct m[1])::int
        from regexp_matches(r.content_txt, 'https?://[^\s<>"'']+', 'gi') as t(m)
      ) as url_distinct,
      -- hashtag 数 (#word) — 行数 = 出現回数
      (
        select count(*)::int
        from regexp_matches(r.content_txt, '#[^\s#@]+', 'g') as t(m)
      ) as hashtag_count,
      -- mention 数 (@word) — 行数 = 出現回数
      (
        select count(*)::int
        from regexp_matches(r.content_txt, '@[A-Za-z0-9_]+', 'g') as t(m)
      ) as mention_count,

      -- ----- low_signal -----
      case when length(r.content_txt) < 20 then 1 else 0 end as content_too_short,
      case when r.media_n = 0 and r.video_n = 0 then 1 else 0 end as no_media
    from raw r
  ),
  scored as (
    select
      c.post_id,

      -- clickbait_score
      least(
        1.0::numeric,
        (case when c.clickbait_hit = 1 then 0.6 else 0.0 end)
        + (case when c.clickbait_hit = 1 and c.title_short = 1 then 0.2 else 0.0 end)
        + (case when c.clickbait_hit = 1 and c.low_body_ratio = 1 then 0.2 else 0.0 end)
      )::numeric as clickbait_score_raw,

      -- spam_score
      least(
        1.0::numeric,
        (case
           when c.url_count >= 3
             and c.url_distinct >= 1
             and c.url_count - c.url_distinct >= 1  -- 同 URL 繰り返しが 1 以上
           then 0.5
           when c.url_count >= 3 then 0.4
           when c.url_count >= 2 then 0.2
           else 0.0
         end)::numeric
        + (case
             when c.hashtag_count >= 8 then 0.4
             when c.hashtag_count >= 5 then 0.3
             when c.hashtag_count >= 3 then 0.1
             else 0.0
           end)::numeric
        + (case
             when c.mention_count >= 8 then 0.4
             when c.mention_count >= 5 then 0.3
             when c.mention_count >= 3 then 0.1
             else 0.0
           end)::numeric
      )::numeric as spam_score_raw,

      -- low_signal_score
      least(
        1.0::numeric,
        (case when c.content_too_short = 1 then 0.5 else 0.0 end)
        + (case when c.content_too_short = 1 and c.no_media = 1 then 0.4 else 0.0 end)
        + (case when c.content_too_short = 1 and length(c.title_txt) = 0 then 0.1 else 0.0 end)
      )::numeric as low_signal_score_raw,

      -- concern_density: concern / max(likes + 1, 5)
      least(
        1.0::numeric,
        c.concern_count::numeric
          / greatest(c.likes_count + 1, 5)::numeric
      )::numeric as concern_density
    from computed c
  )
select
  s.post_id,

  -- manual override が存在すればそれを優先、なければ計算値
  coalesce(o.o_clickbait,  s.clickbait_score_raw)  as clickbait_score,
  coalesce(o.o_spam,       s.spam_score_raw)        as spam_score,
  coalesce(o.o_low_signal, s.low_signal_score_raw) as low_signal_score,
  s.concern_density,

  -- composite: 4 signal の max
  greatest(
    coalesce(o.o_clickbait,  s.clickbait_score_raw),
    coalesce(o.o_spam,       s.spam_score_raw),
    coalesce(o.o_low_signal, s.low_signal_score_raw),
    s.concern_density
  )::numeric as composite_safety_negation
from scored s
left join override o on o.post_id = s.post_id;

comment on view public.post_safety_score is
  'Post 毎の Task Negation signal: clickbait / spam / low_signal / concern_density と合成 composite_safety_negation (0..1)。manual override が優先される。';

grant select on public.post_safety_score to anon, authenticated;

-- ============================================================
-- 3. community_safety_aggregate — view (運用 UI 用)
-- ============================================================
-- community 単位で post_count と avg_safety_negation を集計する。
-- 値が高い community ほど「煽り / spam / 低信号」が多い = 要観察。
-- ============================================================
drop view if exists public.community_safety_aggregate cascade;
create or replace view public.community_safety_aggregate as
select
  pc.community_id,
  count(*)::int                          as post_count,
  avg(pss.composite_safety_negation)::numeric as avg_safety_negation
from public.post_communities pc
join public.post_safety_score pss on pss.post_id = pc.post_id
group by pc.community_id;

comment on view public.community_safety_aggregate is
  'community 単位の post_count + 平均 composite_safety_negation。運用 UI / モデレーション判断用。';

grant select on public.community_safety_aggregate to anon, authenticated;

-- ============================================================
-- 4. get_post_safety(p_post_id) — RPC (transparency)
-- ============================================================
-- 「この結果について」UI で各 signal の内訳を見せるための public RPC。
-- 公開情報のみを返すので auth 不要。
-- ============================================================
drop function if exists public.get_post_safety(uuid);
create or replace function public.get_post_safety(p_post_id uuid)
returns table (
  clickbait        numeric,
  spam             numeric,
  low_signal       numeric,
  concern_density  numeric,
  composite        numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    pss.clickbait_score    as clickbait,
    pss.spam_score         as spam,
    pss.low_signal_score   as low_signal,
    pss.concern_density    as concern_density,
    pss.composite_safety_negation as composite
  from public.post_safety_score pss
  where pss.post_id = p_post_id;
$$;

revoke all on function public.get_post_safety(uuid) from public;
grant execute on function public.get_post_safety(uuid) to anon, authenticated;

comment on function public.get_post_safety(uuid) is
  'Post の safety signal 内訳を返す transparency RPC。"この結果について" UI で使用。';

-- ============================================================
-- 5. flag_post_safety — RPC (admin only)
-- ============================================================
-- admin がマニュアルで signal を override する。
-- signal は 'clickbait' | 'spam' | 'low_signal' のみ。
-- value は 0..1 にクランプ、reason は必須。
-- 既存 row があれば update、無ければ insert (upsert)。
-- ============================================================
drop function if exists public.flag_post_safety(uuid, text, numeric, text);
create or replace function public.flag_post_safety(
  p_post_id uuid,
  p_signal  text,
  p_value   numeric,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_val numeric;
begin
  -- admin check (RLS とは別に二重に確認 — defense in depth)
  if v_uid is null or not public.is_admin() then
    raise exception 'forbidden: admin only';
  end if;

  if p_post_id is null then
    raise exception 'invalid argument: p_post_id is null';
  end if;
  if p_signal is null or p_signal not in ('clickbait','spam','low_signal') then
    raise exception 'invalid argument: p_signal must be one of clickbait/spam/low_signal';
  end if;
  if p_value is null then
    raise exception 'invalid argument: p_value is null';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'invalid argument: p_reason is required';
  end if;

  -- clamp value to 0..1
  v_val := greatest(0::numeric, least(1::numeric, p_value));

  insert into public.post_safety_manual_override (post_id, signal, value, reason, set_by, set_at)
  values (p_post_id, p_signal, v_val, left(trim(p_reason), 500), v_uid, now())
  on conflict (post_id, signal) do update
    set value  = excluded.value,
        reason = excluded.reason,
        set_by = excluded.set_by,
        set_at = now();
end;
$$;

revoke all on function public.flag_post_safety(uuid, text, numeric, text) from public;
revoke all on function public.flag_post_safety(uuid, text, numeric, text) from anon;
grant execute on function public.flag_post_safety(uuid, text, numeric, text) to authenticated;

comment on function public.flag_post_safety(uuid, text, numeric, text) is
  'Admin only: post の safety signal を手動 override する upsert RPC。signal は clickbait/spam/low_signal のみ。';

-- ============================================================
-- 6. ANALYZE (planner に新 stats を読ませる)
-- ============================================================
analyze public.posts;

select '0090_safety_signals_negation 完了 — post_safety_score / community_safety_aggregate views + get_post_safety / flag_post_safety RPC + post_safety_manual_override table' as note;
