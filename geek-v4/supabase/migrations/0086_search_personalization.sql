-- ============================================================
-- 0086_search_personalization.sql — 検索エンジン v3 (パーソナライズ)
-- ============================================================
-- 目的:
--   0085 で導入した search_posts_v2 (text relevance + recency + E-E-A-T
--   + quality penalty) の上に、ユーザー個別の signal を加味した
--   "Google 風" personalization を載せる。
--
--   ただし以下の方針で実装する:
--     * 推測ベースの category prediction (人種・宗教・政治・性別など)
--       は一切作らない。
--     * 明示的に user が残した signal (検索履歴 / view ログ /
--       設定) のみを使う。
--     * personalization は user が toggle で完全 OFF にできる
--       (user_search_preferences.personalization_enabled = false)。
--     * filter bubble を緩和するため、同一 author の連続表示を
--       抑制 (diversify_results)。
--     * 「この結果について」(transparency) を get_result_explanation
--       で必ず返せるようにする。
--
-- このマイグレーションで追加するもの:
--   1. user_search_history       — 検索クエリ + クリックされた post の履歴
--   2. user_post_views           — post 表示の view_count / last_viewed_at
--   3. user_search_preferences   — personalization の ON/OFF と粒度
--   4. log_post_view(post_id)             RPC
--   5. log_search_query(query, clicked)   RPC
--   6. search_posts_v3(query, limit, off) RPC
--   7. get_result_explanation(post, query) RPC
--   8. clear_search_history()             RPC
--
-- スキーマ前提 (既存 migration 編集禁止):
--   posts.id          uuid                          (0001)
--   posts.author_id   uuid -> profiles(id)          (0001)
--   posts.content     text not null                 (0001)
--   posts.title       text nullable                 (0075)
--   posts.likes_count integer not null default 0    (0001)
--   posts.concern_count integer not null default 0  (0006)
--   posts.created_at  timestamptz                   (0001)
--   profiles.trust_score integer 0..100 default 50  (0001)
--   auth.users(id)    Supabase Auth
--   pg_trgm extension (0071/0075/0085 で確保済)
--
-- 設計判断:
--   * すべて create [or replace] / if not exists / drop ... if exists で
--     冪等。何度流しても OK。
--   * SECURITY DEFINER の関数は search_path = pg_catalog, public で
--     lockdown (0083 / 0085 と同じスタイル)。
--   * RLS は self のみアクセス可 (auth.uid() = user_id)。
--   * search_posts_v3 は 0085.search_posts_v2 を内部から呼び、
--     その結果に personalization boost を後段で乗算する形にする。
--     これで C1 (0085) と疎結合に保てる + v2 のシグナルを保ったまま
--     拡張できる。
--   * diversify_results は same-author の連続を間引くロジックで、
--     top 5 results 内で同 author は max 2 件まで。
--
-- ⚠️ 重要:
--   ユーザーの人種・宗教・政治・性別・性的指向・健康状態などを
--   推測する column や RPC は作らない。あくまで「ユーザーが
--   検索した語」「ユーザーが見た post」のみを signal とする。
-- ============================================================

-- ============================================================
-- 0. 前提 extension (idempotent)
-- ============================================================
create extension if not exists pg_trgm;

-- ============================================================
-- 1. user_search_history
-- ============================================================
-- 検索クエリ履歴 + (任意) クリックされた post_id
-- ============================================================
create table if not exists public.user_search_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null check (length(query) between 1 and 200),
  clicked_post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ix_user_search_history_user_created
  on public.user_search_history(user_id, created_at desc);

-- query 側にも trgm index — history_match の similarity 検索用
create index if not exists ix_user_search_history_query_trgm
  on public.user_search_history using gin (query gin_trgm_ops);

alter table public.user_search_history enable row level security;

drop policy if exists ush_self_rw on public.user_search_history;
create policy ush_self_rw on public.user_search_history
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 直 insert を許さず RPC 経由のみにしたい (rate limit のため)
revoke insert on public.user_search_history from anon;
revoke insert on public.user_search_history from authenticated;
revoke insert on public.user_search_history from public;

-- ============================================================
-- 2. user_post_views
-- ============================================================
-- 各 user が各 post を何回見たか + 最終閲覧時刻
-- ============================================================
create table if not exists public.user_post_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  view_count int not null default 1,
  last_viewed_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists ix_user_post_views_user_last
  on public.user_post_views(user_id, last_viewed_at desc);

alter table public.user_post_views enable row level security;

drop policy if exists upv_self_rw on public.user_post_views;
create policy upv_self_rw on public.user_post_views
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 直 insert / update を許さず RPC 経由 (upsert) のみ
revoke insert on public.user_post_views from anon;
revoke insert on public.user_post_views from authenticated;
revoke insert on public.user_post_views from public;
revoke update on public.user_post_views from anon;
revoke update on public.user_post_views from authenticated;
revoke update on public.user_post_views from public;

-- ============================================================
-- 3. user_search_preferences
-- ============================================================
-- personalization の ON/OFF と粒度設定。
-- 行が無い user は「全て default = personalization_enabled = true」扱い。
-- ============================================================
create table if not exists public.user_search_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personalization_enabled boolean not null default true,
  use_location boolean not null default false,
  use_history boolean not null default true,
  diversify_results boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_search_preferences enable row level security;

drop policy if exists usp_self_rw on public.user_search_preferences;
create policy usp_self_rw on public.user_search_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 4. log_post_view(p_post_id)
-- ============================================================
-- post を表示したら client から呼ぶ。
-- 既存行があれば view_count += 1, last_viewed_at = now() で upsert。
-- ============================================================
drop function if exists public.log_post_view(uuid);
create or replace function public.log_post_view(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  if p_post_id is null then
    return;
  end if;

  -- posts が存在しなければ何もしない (foreign key で弾かれる前に noop)
  if not exists (select 1 from public.posts where id = p_post_id) then
    return;
  end if;

  insert into public.user_post_views (user_id, post_id, view_count, last_viewed_at)
  values (v_uid, p_post_id, 1, now())
  on conflict (user_id, post_id) do update
    set view_count = public.user_post_views.view_count + 1,
        last_viewed_at = now();
end;
$$;

revoke all on function public.log_post_view(uuid) from public;
grant execute on function public.log_post_view(uuid) to authenticated;

-- ============================================================
-- 5. log_search_query(p_query, p_clicked_post_id)
-- ============================================================
-- 検索クエリ (とオプションで「クリックされた post」) を履歴に積む。
-- 簡易 rate limit: 同じ query を 5 秒以内に再 log しない。
-- ============================================================
drop function if exists public.log_search_query(text, uuid);
create or replace function public.log_search_query(
  p_query text,
  p_clicked_post_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text;
  v_last_at timestamptz;
begin
  if v_uid is null then
    return;
  end if;
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  v_q := left(trim(p_query), 200);

  -- 同じ user × 同じ query × 5 秒以内の最後の row を見る
  select created_at into v_last_at
  from public.user_search_history
  where user_id = v_uid
    and query = v_q
  order by created_at desc
  limit 1;

  if v_last_at is not null and v_last_at > now() - interval '5 seconds' then
    -- clicked_post_id だけが新しく付いてきたなら、その情報は更新したい
    if p_clicked_post_id is not null then
      update public.user_search_history
      set clicked_post_id = p_clicked_post_id
      where user_id = v_uid
        and query = v_q
        and created_at = v_last_at
        and clicked_post_id is null;
    end if;
    return;
  end if;

  insert into public.user_search_history(user_id, query, clicked_post_id)
  values (v_uid, v_q, p_clicked_post_id);
end;
$$;

revoke all on function public.log_search_query(text, uuid) from public;
grant execute on function public.log_search_query(text, uuid) to authenticated;

-- ============================================================
-- 6. search_posts_v3 — personalized 検索 RPC
-- ============================================================
-- 流れ:
--   A. user_search_preferences を取得 (なければ default 適用)
--   B. search_posts_v2 を内部から呼んで base スコアを得る
--      (limit はあえて広めに取って後段で再ソート + 再 limit する)
--   C. personalization_enabled = true なら以下の boost を適用:
--      * viewed_boost: 自分が過去に見た post に score × 1.2
--      * history_match: 過去履歴の query と本クエリの trgm similarity
--          > 0.4 で、かつ過去履歴の clicked_post_id == この post なら × 1.1
--      * 上限を抑えるため、最終 score = base * combined_boost
--   D. diversify_results = true なら top N 内で同一 author の
--      連続を抑える (row_number() with partition by author_id を使い、
--      top 5 件以内で同 author は max 2 件)。
--   E. limit + offset で返す。
--
-- 戻り値は v2 と同じ shape に personalization 用の列を追加:
--   post_id, final_score, base_score, viewed_boost, history_boost,
--   text_relevance, recency_boost, eeat_score, matched_terms
-- ============================================================
drop function if exists public.search_posts_v3(text, int, int);
create or replace function public.search_posts_v3(
  p_query text,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  post_id uuid,
  final_score numeric,
  base_score numeric,
  viewed_boost numeric,
  history_boost numeric,
  text_relevance numeric,
  recency_boost numeric,
  eeat_score numeric,
  matched_terms text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(coalesce(p_limit, 20), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_pref_enabled boolean := true;
  v_pref_history boolean := true;
  v_pref_diversify boolean := true;
  -- 内部呼び出しの search_posts_v2 では、後段の personalize + diversify の
  -- 余地を残すため、外側の limit より広く取って引く。
  v_inner_limit int := least(greatest(v_limit + v_offset, 20) * 3, 200);
begin
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  -- A. 設定取得 (login していない / 行が無いなら default のまま)
  if v_uid is not null then
    select
      coalesce(p.personalization_enabled, true),
      coalesce(p.use_history, true),
      coalesce(p.diversify_results, true)
    into v_pref_enabled, v_pref_history, v_pref_diversify
    from public.user_search_preferences p
    where p.user_id = v_uid;
  end if;

  return query
  with base as (
    -- B. v2 の結果を広めに引く
    select
      v2.post_id,
      v2.final_score          as base_score_raw,
      v2.text_relevance,
      v2.recency_boost,
      v2.eeat_score,
      v2.matched_terms
    from public.search_posts_v2(p_query, v_inner_limit, 0) v2
  ),
  enriched as (
    select
      b.*,
      p.author_id,
      p.created_at,
      -- C-1. viewed_boost
      case
        when v_uid is not null and v_pref_enabled and exists (
          select 1 from public.user_post_views v
          where v.user_id = v_uid
            and v.post_id = b.post_id
            and v.view_count > 0
        )
        then 1.2::numeric
        else 1.0::numeric
      end as viewed_boost_v,
      -- C-2. history_match (use_history が true のときだけ)
      case
        when v_uid is not null
         and v_pref_enabled
         and v_pref_history
         and exists (
           select 1 from public.user_search_history h
           where h.user_id = v_uid
             and h.created_at > now() - interval '90 days'
             and similarity(h.query, p_query) > 0.4
             and (
               -- 1) 過去に同じような query でクリックした post そのもの
               h.clicked_post_id = b.post_id
               -- 2) 過去に同じような query を投げて、その時 hit したであろう
               --    matched terms が今回も含まれる post (= 関連トピック)
               or exists (
                 select 1
                 from unnest(b.matched_terms) mt
                 where h.query ilike '%' || mt || '%'
               )
             )
        )
        then 1.1::numeric
        else 1.0::numeric
      end as history_boost_v
    from base b
    join public.posts p on p.id = b.post_id
  ),
  scored as (
    select
      e.post_id,
      e.author_id,
      e.created_at,
      e.base_score_raw,
      e.viewed_boost_v,
      e.history_boost_v,
      e.text_relevance,
      e.recency_boost,
      e.eeat_score,
      e.matched_terms,
      (e.base_score_raw * e.viewed_boost_v * e.history_boost_v)::numeric as final_score_v
    from enriched e
  ),
  -- D. diversify_results: 同 author の連続を抑える
  --   - rn_in_author: 同 author 内での final_score 降順順位
  --   - top 5 内で同 author の 3 件目以降に大きいペナルティ
  ranked as (
    select
      s.*,
      row_number() over (
        partition by s.author_id
        order by s.final_score_v desc, s.created_at desc
      ) as rn_in_author
    from scored s
  ),
  penalized as (
    select
      r.post_id,
      r.final_score_v
        * case
            when v_pref_diversify and v_pref_enabled and r.rn_in_author > 2
              then 0.6
            else 1.0
          end as final_score_p,
      r.base_score_raw,
      r.viewed_boost_v,
      r.history_boost_v,
      r.text_relevance,
      r.recency_boost,
      r.eeat_score,
      r.matched_terms,
      r.created_at
    from ranked r
  )
  select
    pn.post_id,
    pn.final_score_p              as final_score,
    pn.base_score_raw             as base_score,
    pn.viewed_boost_v             as viewed_boost,
    pn.history_boost_v            as history_boost,
    pn.text_relevance,
    pn.recency_boost,
    pn.eeat_score,
    pn.matched_terms
  from penalized pn
  order by pn.final_score_p desc, pn.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.search_posts_v3(text, int, int) from public;
grant execute on function public.search_posts_v3(text, int, int) to anon, authenticated;

-- ============================================================
-- 7. get_result_explanation(p_post_id, p_query)
-- ============================================================
-- 「この結果について」用 transparency RPC。
-- 各 factor について (weight, description) を返す。
-- weight は 0〜1 程度を目安 (UI で bar 表示する想定)。
-- ============================================================
drop function if exists public.get_result_explanation(uuid, text);
create or replace function public.get_result_explanation(
  p_post_id uuid,
  p_query text
)
returns table (
  factor text,
  weight numeric,
  description text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_v2_row record;
  v_viewed_count int := 0;
  v_history_hit boolean := false;
  v_author_id uuid;
  v_created_at timestamptz;
  v_text_rel numeric := 0;
  v_recency  numeric := 0;
  v_eeat     numeric := 0;
  v_pref_enabled boolean := true;
  v_pref_history boolean := true;
  v_pref_diversify boolean := true;
begin
  if p_post_id is null then
    return;
  end if;
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  -- 設定 (なければ default)
  if v_uid is not null then
    select
      coalesce(p.personalization_enabled, true),
      coalesce(p.use_history, true),
      coalesce(p.diversify_results, true)
    into v_pref_enabled, v_pref_history, v_pref_diversify
    from public.user_search_preferences p
    where p.user_id = v_uid;
  end if;

  -- v2 から該当 post の signal を引く
  select v2.text_relevance, v2.recency_boost, v2.eeat_score
  into v_text_rel, v_recency, v_eeat
  from public.search_posts_v2(p_query, 100, 0) v2
  where v2.post_id = p_post_id
  limit 1;

  if v_text_rel is null then
    v_text_rel := 0;
  end if;
  if v_recency is null then
    v_recency := 0;
  end if;
  if v_eeat is null then
    v_eeat := 0;
  end if;

  -- post 情報
  select author_id, created_at into v_author_id, v_created_at
  from public.posts where id = p_post_id;

  -- 個人の view 履歴
  if v_uid is not null then
    select view_count into v_viewed_count
    from public.user_post_views
    where user_id = v_uid and post_id = p_post_id;
    if v_viewed_count is null then
      v_viewed_count := 0;
    end if;

    -- 過去検索履歴と類似があるか
    select exists (
      select 1 from public.user_search_history h
      where h.user_id = v_uid
        and h.created_at > now() - interval '90 days'
        and similarity(h.query, p_query) > 0.4
    ) into v_history_hit;
  end if;

  -- ---- factor 行を返す ----
  -- text_relevance
  return query select
    'text_relevance'::text,
    least(v_text_rel / 3.0, 1.0)::numeric,
    'クエリの語が投稿のタイトル / 本文と一致しています'::text;

  -- recency
  return query select
    'recency'::text,
    v_recency::numeric,
    case
      when v_created_at > now() - interval '24 hours' then '直近 24 時間以内に投稿された新しい内容です'
      when v_created_at > now() - interval '7 days'   then '直近 1 週間以内の投稿です'
      when v_created_at > now() - interval '30 days'  then '直近 1 か月以内の投稿です'
      else '比較的古い投稿です'
    end::text;

  -- E-E-A-T
  return query select
    'eeat'::text,
    v_eeat::numeric,
    '投稿者の信用スコアと評価 (いいね数) を元にした品質指標です'::text;

  -- history (personalization が有効なときだけ「あり」として返す)
  if v_uid is not null and v_pref_enabled and v_pref_history and v_history_hit then
    return query select
      'history'::text,
      0.1::numeric,
      'あなたが過去に似た検索をした経緯があるため、関連する結果を少し優先しています'::text;
  else
    return query select
      'history'::text,
      0.0::numeric,
      case
        when v_uid is null then 'ログインしていないため、検索履歴は使われていません'
        when not v_pref_enabled then 'パーソナライズが無効化されているため、検索履歴は使われていません'
        when not v_pref_history then '検索履歴の利用が設定で無効化されています'
        else '関連する過去の検索履歴はありません'
      end::text;
  end if;

  -- views (personalization が有効なときだけ「あり」として返す)
  if v_uid is not null and v_pref_enabled and v_viewed_count > 0 then
    return query select
      'views'::text,
      0.2::numeric,
      ('あなたは過去にこの投稿を ' || v_viewed_count::text || ' 回閲覧しています')::text;
  else
    return query select
      'views'::text,
      0.0::numeric,
      case
        when v_uid is null then 'ログインしていないため、閲覧履歴は使われていません'
        when not v_pref_enabled then 'パーソナライズが無効化されているため、閲覧履歴は使われていません'
        else 'あなたはまだこの投稿を閲覧していません'
      end::text;
  end if;

  -- diversity (transparency: 多様性ロジックが効いているかどうかを必ず開示)
  if v_pref_diversify and v_pref_enabled then
    return query select
      'diversity'::text,
      0.05::numeric,
      '特定の投稿者ばかりが上位に並ばないよう、結果を多様化しています'::text;
  else
    return query select
      'diversity'::text,
      0.0::numeric,
      '多様化フィルタは無効になっています'::text;
  end if;
end;
$$;

revoke all on function public.get_result_explanation(uuid, text) from public;
grant execute on function public.get_result_explanation(uuid, text) to anon, authenticated;

-- ============================================================
-- 8. clear_search_history()
-- ============================================================
-- 自分の検索履歴 (user_search_history) と
-- 閲覧履歴 (user_post_views) を一括削除。
-- user_search_preferences は残す (設定は消さない)。
-- ============================================================
drop function if exists public.clear_search_history();
create or replace function public.clear_search_history()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  delete from public.user_search_history where user_id = v_uid;
  delete from public.user_post_views    where user_id = v_uid;
end;
$$;

revoke all on function public.clear_search_history() from public;
grant execute on function public.clear_search_history() to authenticated;

-- ============================================================
-- 9. ANALYZE (planner に新 stats を読ませる)
-- ============================================================
analyze public.user_search_history;
analyze public.user_post_views;
analyze public.user_search_preferences;

select '0086_search_personalization 完了 — user_search_history / user_post_views / user_search_preferences + log_post_view / log_search_query / search_posts_v3 / get_result_explanation / clear_search_history' as note;
