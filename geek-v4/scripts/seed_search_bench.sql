-- scripts/seed_search_bench.sql — 検索 quality bench seed + nDCG/Recall RPC
-- ============================================================
-- 目的:
--   検索 quality を測る (query, relevant_post_ids) ペアの seed と、
--   オフライン指標 nDCG@k / Recall@k を返す RPC を提供する。
--   モデルマージ理論で言う「評価ハーネス」に相当し、ranking_weights や
--   intent override をいじる前に "現状値" を計測してから出発する。
--
-- 提供するもの:
--   1. search_bench_queries     — bench query master (intent ラベル + active flag)
--   2. search_bench_relevance   — (bench_id, post_id) → relevance_grade 0..3
--   3. seed 30 queries          — 日本語 + 英語まじり, intent 多様化
--   4. weak supervision seed    — posts.content/title に query 語が含まれる
--                                 post を grade=2 で auto-insert (limit 5)
--   5. compute_ndcg_at_k        — DCG@k / IDCG@k による nDCG (0..1)
--   6. compute_recall_at_k      — relevant set のうち top-k に何件入ったか
--   7. eval_search_bench        — admin 限定: search_posts_v4 を全 bench query で
--                                 回して mean nDCG@10 / Recall@10 / by_intent 集計
--
-- 制約:
--   * 既存 migration は編集しない (これは scripts/ 配下 = ad-hoc seed)
--   * すべて idempotent (on conflict do nothing / drop function if exists / if exists ガード)
--   * SECURITY DEFINER + set search_path = pg_catalog, public で lockdown
--   * RLS は bench tables = anyone read, admin only write
--   * search_posts_v4 が未作成 (0097 未適用) でも eval_search_bench は
--     例外を投げず { warning: "search_posts_v4 not found" } を返す
-- ============================================================

-- ============================================================
-- 0. extension 前提 (pg_trgm は 0075 で確保済だが念のため)
-- ============================================================
create extension if not exists pg_trgm;

-- ============================================================
-- 1. search_bench_queries — bench query master
-- ============================================================
create table if not exists public.search_bench_queries (
  id          serial primary key,
  query       text not null,
  intent      text not null check (intent in (
                'recipe','image','video','music','game','travel','sports',
                'manga','anime','book','news','qa','community','place',
                'shop','tech','general','recent'
              )),
  description text,
  created_at  timestamptz not null default now(),
  active      boolean not null default true
);

-- 同じ query 文字列は 1 レコードに正規化したい (冪等 seed のため)
create unique index if not exists search_bench_queries_query_uidx
  on public.search_bench_queries (lower(query));

create index if not exists search_bench_queries_intent_idx
  on public.search_bench_queries (intent) where active = true;

comment on table public.search_bench_queries is
  '検索 quality 評価用 query 集合。intent ラベル付き。eval_search_bench から参照される。';

-- ============================================================
-- 2. search_bench_relevance — judgement (bench_id, post_id) → grade
-- ============================================================
create table if not exists public.search_bench_relevance (
  bench_id        int  not null references public.search_bench_queries (id) on delete cascade,
  post_id         uuid not null references public.posts                (id) on delete cascade,
  relevance_grade int  not null check (relevance_grade between 0 and 3),
    -- 0 = irrelevant, 1 = marginal, 2 = relevant, 3 = perfect
  rationale       text,
  assigned_by     uuid references public.profiles (id) on delete set null,
  assigned_at     timestamptz not null default now(),
  primary key (bench_id, post_id)
);

create index if not exists search_bench_relevance_post_idx
  on public.search_bench_relevance (post_id);

create index if not exists search_bench_relevance_grade_idx
  on public.search_bench_relevance (bench_id, relevance_grade desc);

comment on table public.search_bench_relevance is
  '(bench_id, post_id) ペアの relevance grade (0..3)。weak supervision + 手動修正で運用。';

-- ============================================================
-- 3. RLS — read = anyone (anon/authenticated), write = admin only
-- ============================================================
alter table public.search_bench_queries   enable row level security;
alter table public.search_bench_relevance enable row level security;

-- queries
drop policy if exists search_bench_queries_read       on public.search_bench_queries;
drop policy if exists search_bench_queries_admin_all  on public.search_bench_queries;

create policy search_bench_queries_read
  on public.search_bench_queries
  for select
  to anon, authenticated
  using (true);

-- write は admin (current_user_is_admin) のみ
create policy search_bench_queries_admin_all
  on public.search_bench_queries
  for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- relevance
drop policy if exists search_bench_relevance_read      on public.search_bench_relevance;
drop policy if exists search_bench_relevance_admin_all on public.search_bench_relevance;

create policy search_bench_relevance_read
  on public.search_bench_relevance
  for select
  to anon, authenticated
  using (true);

create policy search_bench_relevance_admin_all
  on public.search_bench_relevance
  for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ============================================================
-- 4. Seed 30 queries (intent カバレッジ重視)
--   分布:
--     recipe x 2, travel x 3, recent x 2, sports x 2, tech x 4, qa x 2,
--     place x 2, anime x 2, manga x 2, game x 2, image x 1, video x 1,
--     music x 2, book x 1, news x 1, shop x 1, community x 1, general x 1
--   合計 30, 18 intent 中 17 を網羅 (general/recent/tech はメインユース想定)
-- ============================================================
insert into public.search_bench_queries (query, intent, description) values
  ('カレー レシピ',              'recipe',    '基本〜本格カレーレシピ全般'),
  ('お弁当 簡単 作り置き',       'recipe',    '時短作り置き弁当ジャンル'),
  ('東京 観光 おすすめ',         'travel',    '東京観光地スポット'),
  ('京都 紅葉 ライトアップ',     'travel',    '京都の秋季ライトアップ情報'),
  ('沖縄 ダイビング スポット',   'travel',    '沖縄離島ダイビング'),
  ('最新 ニュース',              'recent',    '時事ニュース (recency 重み確認用)'),
  ('今日 速報',                  'recent',    '直近 24h イベント (recent_event intent)'),
  ('BMW M3 排気音',              'sports',    'スポーツカー排気音マニア'),
  ('F1 2026 シーズン',           'sports',    'F1 2026 シーズン情報'),
  ('python エラー解決',          'qa',        'Python tracebacks トラブルシュート'),
  ('React Native bundling fail', 'qa',        'RN bundling 系トラブル英語混じり query'),
  ('ラーメン 神奈川',            'place',     '神奈川県ラーメン店ランキング'),
  ('カフェ 渋谷 静か',           'place',     '渋谷の作業向け静かカフェ'),
  ('アニメ 2026 春',             'anime',     '2026 春アニメ新作'),
  ('鬼滅の刃 最終回 感想',       'anime',     '鬼滅の刃ファン感想スレ'),
  ('漫画 おすすめ',              'manga',     '読み放題系おすすめ漫画'),
  ('ジャンプ 新連載',            'manga',     '少年ジャンプ新連載'),
  ('テスラ オートパイロット',    'tech',      'Tesla 自動運転技術'),
  ('GPT-5 リリース',             'tech',      'GPT-5 公開時 query'),
  ('Rust async tokio 入門',      'tech',      'Rust async 学習 query'),
  ('Apple Vision Pro レビュー',  'tech',      'VR デバイスレビュー'),
  ('ゲーム 攻略',                'game',      '汎用ゲーム攻略 query'),
  ('Splatoon 3 ブキ ランキング', 'game',      'Splatoon3 武器メタ'),
  ('夕焼け 写真',                'image',     '夕焼け写真フォト'),
  ('猫 動画 かわいい',           'video',     '猫動画ジャンル'),
  ('Jazz playlist 作業用',       'music',     'BGM 作業用ジャズ'),
  ('K-POP 新曲 MV',              'music',     'K-POP 新曲 MV'),
  ('小説 おすすめ 2026',         'book',      '2026 年小説ランキング'),
  ('地震 速報',                  'news',      '災害ニュース (recency + safety 確認用)'),
  ('スニーカー 新作 セール',     'shop',      'スニーカー販売 query'),
  ('読書 コミュニティ',          'community', '読書好きコミュニティ探し'),
  ('趣味 仲間 探し',             'general',   '汎用コミュニティ探索 query')
on conflict (lower(query)) do nothing;

-- 上記は 32 行入っているが、intent カバレッジ用に 30 → 32 まで増やしている
-- (general / community を加えたため)。on conflict do nothing で再実行安全。

-- ============================================================
-- 5. Weak supervision seed
--   各 query について、posts.content / title に query 語 (空白区切りの先頭語)
--   が含まれる post を最大 5 件 grade=2 (relevant) で insert。
--   厳密ではないが「ベースライン」として nDCG が 0 にならない最低限を作る。
--   本番運用では human review で grade=3/1/0 を上書きする想定。
-- ============================================================
do $$
declare
  q record;
  v_term text;
  v_inserted int := 0;
begin
  for q in
    select id, query
      from public.search_bench_queries
     where active = true
  loop
    -- query の先頭語 (or 全体) を ilike '%term%' で fuzzy match
    -- 空白 / 半角空白で split し、最長語を選んでマッチ精度を上げる
    select t
      into v_term
      from regexp_split_to_table(q.query, '\s+') as t
      order by length(t) desc
      limit 1;
    if v_term is null or length(v_term) < 2 then
      continue;
    end if;
    -- 既に十分な judgement が入っている query は skip (冪等)
    if (
      select count(*)
        from public.search_bench_relevance
       where bench_id = q.id
    ) >= 5 then
      continue;
    end if;
    insert into public.search_bench_relevance (bench_id, post_id, relevance_grade, rationale)
    select q.id,
           p.id,
           2,
           'weak supervision: posts.content/title contains "' || v_term || '"'
      from public.posts p
     where (p.content ilike '%' || v_term || '%' or p.title ilike '%' || v_term || '%')
     order by p.created_at desc
     limit 5
    on conflict (bench_id, post_id) do nothing;
    get diagnostics v_inserted = row_count;
  end loop;
end$$;

-- ============================================================
-- 6. compute_ndcg_at_k(p_query_id, p_returned_post_ids, p_k)
--    DCG@k = Σ (2^rel - 1) / log2(rank + 1) for rank in 1..k
--    IDCG@k = ideal DCG (relevance grade を降順 sort)
--    nDCG = DCG / IDCG, IDCG=0 のときは 0 を返す (= 評価対象なし)
-- ============================================================
drop function if exists public.compute_ndcg_at_k(int, uuid[], int);
create or replace function public.compute_ndcg_at_k(
  p_query_id            int,
  p_returned_post_ids   uuid[],
  p_k                   int default 10
)
returns numeric
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_k     int := greatest(coalesce(p_k, 10), 1);
  v_dcg   numeric := 0;
  v_idcg  numeric := 0;
  r       record;
begin
  if p_query_id is null or p_returned_post_ids is null
     or array_length(p_returned_post_ids, 1) is null then
    return 0::numeric;
  end if;

  -- DCG@k: returned[1..k] の position に対し relevance を join して計算
  for r in
    with returned as (
      select pid, ord
        from unnest(p_returned_post_ids) with ordinality as t(pid, ord)
       where ord <= v_k
    )
    select coalesce(rel.relevance_grade, 0)::int as grade,
           r.ord::int                            as rank
      from returned r
      left join public.search_bench_relevance rel
        on rel.bench_id = p_query_id
       and rel.post_id  = r.pid
  loop
    -- gain = (2^rel - 1), discount = log2(rank + 1)
    v_dcg := v_dcg + ((power(2::numeric, r.grade) - 1)
                       / (ln(r.rank + 1) / ln(2)));
  end loop;

  -- IDCG@k: bench_id の relevance を grade 降順で k 件
  for r in
    with ideal as (
      select relevance_grade::int as grade,
             row_number() over (order by relevance_grade desc) as rank
        from public.search_bench_relevance
       where bench_id = p_query_id
         and relevance_grade > 0
       order by relevance_grade desc
       limit v_k
    )
    select grade, rank::int as rank from ideal
  loop
    v_idcg := v_idcg + ((power(2::numeric, r.grade) - 1)
                         / (ln(r.rank + 1) / ln(2)));
  end loop;

  if v_idcg = 0 then
    return 0::numeric;
  end if;
  return (v_dcg / v_idcg)::numeric;
end;
$$;

revoke all on function public.compute_ndcg_at_k(int, uuid[], int) from public;
grant execute on function public.compute_ndcg_at_k(int, uuid[], int) to authenticated;

comment on function public.compute_ndcg_at_k(int, uuid[], int) is
  '検索 quality 指標 nDCG@k (0..1)。bench_id と returned post_id 配列を受け取り、'
  'search_bench_relevance を真値として DCG/IDCG を計算する。';

-- ============================================================
-- 7. compute_recall_at_k(p_query_id, p_returned_post_ids, p_k)
--    relevance >= 2 を「関連あり」とする (= 2 relevant / 3 perfect)。
--    Recall@k = (returned[1..k] のうち関連あり件数) / (全関連件数)
-- ============================================================
drop function if exists public.compute_recall_at_k(int, uuid[], int);
create or replace function public.compute_recall_at_k(
  p_query_id            int,
  p_returned_post_ids   uuid[],
  p_k                   int default 10
)
returns numeric
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_k        int := greatest(coalesce(p_k, 10), 1);
  v_total    int := 0;
  v_hit      int := 0;
begin
  if p_query_id is null or p_returned_post_ids is null
     or array_length(p_returned_post_ids, 1) is null then
    return 0::numeric;
  end if;

  -- 全関連件数 (denominator)
  select count(*)
    into v_total
    from public.search_bench_relevance
   where bench_id = p_query_id
     and relevance_grade >= 2;

  if v_total = 0 then
    return 0::numeric;
  end if;

  -- top-k の hit 件数 (numerator)
  with returned as (
    select pid, ord
      from unnest(p_returned_post_ids) with ordinality as t(pid, ord)
     where ord <= v_k
  )
  select count(*)
    into v_hit
    from returned r
    join public.search_bench_relevance rel
      on rel.bench_id = p_query_id
     and rel.post_id  = r.pid
     and rel.relevance_grade >= 2;

  return (v_hit::numeric / v_total::numeric);
end;
$$;

revoke all on function public.compute_recall_at_k(int, uuid[], int) from public;
grant execute on function public.compute_recall_at_k(int, uuid[], int) to authenticated;

comment on function public.compute_recall_at_k(int, uuid[], int) is
  '検索 quality 指標 Recall@k (0..1)。grade>=2 を関連とする。'
  'IDCG=0 等で 0 が返るケースは「評価対象なし」を意味する。';

-- ============================================================
-- 8. eval_search_bench(p_profile_name)
--    active な bench queries を search_posts_v4 で実行し、
--    nDCG@10 / Recall@10 を集計して jsonb で返す。
--    admin only (current_user_is_admin()) で SECURITY DEFINER lockdown。
--    search_posts_v4 が未存在のときは warning を含む jsonb を返す (壊れない)。
--
--    p_profile_name は将来的に ranking_weight_profiles 切替で
--    A/B 比較する用 (現状は記録のみ。実装は search_posts_v4 内の
--    get_active_ranking_weights() に従う)。
-- ============================================================
drop function if exists public.eval_search_bench(text);
create or replace function public.eval_search_bench(
  p_profile_name text default null
)
returns jsonb
language plpgsql
volatile  -- search_posts_v4 内部で search_engagement_log を書く実装になり得るため
security definer
set search_path = pg_catalog, public
as $$
declare
  v_is_admin boolean := false;
  v_has_v4   boolean := to_regprocedure(
                          'public.search_posts_v4(text, int, int, uuid, boolean, boolean)'
                        ) is not null;
  q record;
  v_ids   uuid[];
  v_ndcg  numeric;
  v_rec   numeric;
  v_acc   jsonb := '[]'::jsonb;   -- per-query result
  v_by_intent jsonb := '{}'::jsonb;
  v_query_count int := 0;
  v_ndcg_sum numeric := 0;
  v_rec_sum  numeric := 0;
  ir record;
begin
  -- admin check
  begin
    if to_regprocedure('public.current_user_is_admin()') is not null then
      execute 'select public.current_user_is_admin()' into v_is_admin;
    end if;
  exception when others then
    v_is_admin := false;
  end;

  if not v_is_admin then
    raise exception 'eval_search_bench: admin only' using errcode = '42501';
  end if;

  if not v_has_v4 then
    return jsonb_build_object(
      'warning', 'search_posts_v4 not found (0097 未適用?) — eval skipped',
      'profile_name', p_profile_name,
      'query_count', 0,
      'mean_ndcg',   null,
      'mean_recall', null,
      'by_intent',   '{}'::jsonb,
      'generated_at', now()
    );
  end if;

  -- 各 active bench query について v4 を呼び nDCG/Recall を集計
  for q in
    select id, query, intent
      from public.search_bench_queries
     where active = true
     order by id
  loop
    begin
      -- search_posts_v4(p_query, p_limit, p_offset, p_community_id, p_use_diversify, p_use_sign_election)
      execute $q$
        select array_agg(post_id order by final_score desc nulls last)
          from public.search_posts_v4($1, 10, 0, null, true, false)
      $q$
      into v_ids
      using q.query;
    exception when others then
      v_ids := '{}'::uuid[];
    end;
    if v_ids is null then
      v_ids := '{}'::uuid[];
    end if;

    v_ndcg := public.compute_ndcg_at_k(q.id,   v_ids, 10);
    v_rec  := public.compute_recall_at_k(q.id, v_ids, 10);

    v_acc := v_acc || jsonb_build_object(
      'bench_id',    q.id,
      'query',       q.query,
      'intent',      q.intent,
      'ndcg_at_10',  v_ndcg,
      'recall_at_10', v_rec,
      'returned',    coalesce(array_length(v_ids, 1), 0)
    );

    v_query_count := v_query_count + 1;
    v_ndcg_sum := v_ndcg_sum + coalesce(v_ndcg, 0);
    v_rec_sum  := v_rec_sum  + coalesce(v_rec, 0);
  end loop;

  -- by_intent 集計 (mean) — v_acc から再集計
  for ir in
    select (elem ->> 'intent') as intent,
           avg((elem ->> 'ndcg_at_10')::numeric)  as mean_ndcg,
           avg((elem ->> 'recall_at_10')::numeric) as mean_recall,
           count(*) as cnt
      from jsonb_array_elements(v_acc) as elem
     group by elem ->> 'intent'
  loop
    v_by_intent := v_by_intent || jsonb_build_object(
      ir.intent,
      jsonb_build_object(
        'mean_ndcg',   ir.mean_ndcg,
        'mean_recall', ir.mean_recall,
        'query_count', ir.cnt
      )
    );
  end loop;

  return jsonb_build_object(
    'profile_name', p_profile_name,
    'query_count',  v_query_count,
    'mean_ndcg',    case when v_query_count = 0 then null
                         else (v_ndcg_sum / v_query_count) end,
    'mean_recall',  case when v_query_count = 0 then null
                         else (v_rec_sum / v_query_count) end,
    'by_intent',    v_by_intent,
    'per_query',    v_acc,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.eval_search_bench(text) from public;
grant execute on function public.eval_search_bench(text) to authenticated;

comment on function public.eval_search_bench(text) is
  'admin: search_posts_v4 を全 active bench query で実行し、'
  'nDCG@10 / Recall@10 と by_intent 集計を jsonb で返す。'
  'search_posts_v4 が未作成なら warning 付き jsonb で safe return。';

-- ============================================================
-- 9. ANALYZE
-- ============================================================
analyze public.search_bench_queries;
analyze public.search_bench_relevance;

select 'seed_search_bench 完了 — '
       || (select count(*) from public.search_bench_queries where active)::text
       || ' active queries + '
       || (select count(*) from public.search_bench_relevance)::text
       || ' weak judgements + nDCG/Recall/eval_search_bench RPC' as note;
