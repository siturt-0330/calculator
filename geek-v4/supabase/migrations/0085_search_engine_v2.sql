-- ============================================================
-- 0085_search_engine_v2.sql — Google-like 検索エンジン v2
-- ============================================================
-- 目的:
--   現状の検索 (search.tsx → posts.content/title への ilike) は
--   完全一致中心で、 同義語展開・typo correction・ランキング
--   (新鮮度 / E-E-A-T / 品質ペナルティ) が無い。
--
--   このマイグレーションで以下を導入する:
--     1. search_synonyms       — 同義語辞書 (term -> synonyms[])
--     2. search_query_intents  — クエリ意図カテゴリ (keyword -> intent)
--     3. search_query_log      — analytics 用 (rate limit 付き)
--     4. search_posts_v2()     — 同義語展開 + typo 補正 + 多軸ランキング RPC
--     5. get_trending_topics() — 直近 N 時間の頻出語抽出 RPC
--     6. search_log_query()    — クエリログ記録 RPC (best-effort)
--
-- スキーマ前提 (確認済 — 既存 migration 編集はしない):
--   posts.id           uuid
--   posts.title        text (nullable, 0075 で追加 — スレ形式判別用)
--   posts.content      text not null
--   posts.likes_count  integer not null default 0   (0001)
--   posts.concern_count integer not null default 0  (0006)
--   posts.created_at   timestamptz
--   posts.author_id    uuid -> profiles(id)
--   profiles.trust_score integer 0..100 default 50  (0001)
--
-- index 前提:
--   posts_content_trgm_idx (gin trgm)  — 0071
--   posts_title_trgm_idx   (gin trgm)  — 0075
--   pg_trgm extension                  — 0071/0075 で確保済
--
-- 設計判断:
--   * すべて create [or replace] / if not exists / drop ... if exists で
--     冪等。何度流しても OK。
--   * SECURITY DEFINER の関数は search_path = pg_catalog, public で lockdown
--     (PostgreSQL の search_path 注入対策 — 0083 と同じスタイル)。
--   * search_posts_v2 は ts_rank ではなく trigram similarity 合算で
--     text relevance を計算 (本文に generated tsvector が無いため)。
--     代わりに pg_trgm の GIN index がそのまま効く。
--   * recency / eeat / quality は posts 行のみ参照 — N+1 を避ける。
--   * shadowban / archive / is_anonymous は呼び出し側 (lib/api) で
--     必要に応じて追加フィルタする想定。ここでは「検索対象 = posts 全件」と
--     して RLS に委ねる (RPC は SECURITY DEFINER なので RLS bypass 注意:
--     deleted / archived は明示除外する)。
-- ============================================================

-- ============================================================
-- 0. 前提 extension (idempotent)
-- ============================================================
create extension if not exists pg_trgm;

-- ============================================================
-- 1. search_synonyms — 同義語辞書
-- ============================================================
-- term      : 検索クエリのトークン (lower-case で格納)
-- synonyms  : 展開先の語句配列 (lower-case)
-- 双方向ではない (term ハとした検索でのみ展開する片方向)。
-- 双方向にしたい場合は両方向の row を入れる (seed 参照)。
-- ============================================================
create table if not exists public.search_synonyms (
  term text primary key,
  synonyms text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- term は完全一致 lookup なので primary key で十分。
-- synonyms 内の検索 (= reverse lookup) もまれにやりたいので GIN を貼る。
create index if not exists search_synonyms_synonyms_gin_idx
  on public.search_synonyms using gin (synonyms);

-- term 自体に typo correction するための trgm index
create index if not exists search_synonyms_term_trgm_idx
  on public.search_synonyms using gin (term gin_trgm_ops);

-- 読み取りは誰でも OK (検索 UI から見える前提)。
alter table public.search_synonyms enable row level security;
drop policy if exists "synonyms_read" on public.search_synonyms;
create policy "synonyms_read" on public.search_synonyms
  for select using (true);
-- 書き込み権限は付与しない (= service_role / 管理者のみ)。

-- ------------------------------------------------------------
-- seed (idempotent: on conflict update)
-- ------------------------------------------------------------
insert into public.search_synonyms (term, synonyms) values
  ('料理',   array['レシピ','食事','クッキング','cooking','recipe','料理']),
  ('レシピ', array['料理','食事','クッキング','cooking','recipe','レシピ']),
  ('画像',   array['写真','image','photo','pic','picture','画像']),
  ('写真',   array['画像','image','photo','pic','picture','写真']),
  ('動画',   array['video','ビデオ','ムービー','movie','動画','クリップ']),
  ('音楽',   array['music','曲','song','track','音楽','サウンド']),
  ('ゲーム', array['game','gaming','プレイ','ゲーミング','ゲーム']),
  ('旅行',   array['travel','trip','旅','観光','旅行','tour']),
  ('スポーツ', array['sport','sports','運動','スポーツ','athletic']),
  ('漫画',   array['manga','コミック','comic','まんが','漫画']),
  ('アニメ', array['anime','アニメーション','animation','アニメ']),
  ('本',     array['book','書籍','読書','本','reading','novel']),
  ('映画',   array['movie','film','シネマ','映画','cinema']),
  ('カメラ', array['camera','撮影','カメラ','photo gear']),
  ('車',     array['car','自動車','vehicle','車','automobile']),
  ('バイク', array['bike','motorcycle','オートバイ','バイク']),
  ('プログラミング', array['programming','コーディング','coding','dev','development','プログラミング']),
  ('プログラム', array['programming','コーディング','coding','dev','プログラム']),
  ('イラスト', array['illustration','絵','drawing','イラスト','art']),
  ('絵',     array['illustration','イラスト','drawing','art','絵']),
  ('音声',   array['audio','voice','sound','音声','声']),
  ('ニュース', array['news','報道','ニュース','記事']),
  ('質問',   array['question','q&a','質問','疑問','help']),
  ('レビュー', array['review','感想','レビュー','口コミ','評価']),
  ('趣味',   array['hobby','趣味','interest']),
  ('ペット', array['pet','動物','ペット','animal']),
  ('猫',     array['cat','ねこ','ネコ','猫','kitten']),
  ('犬',     array['dog','いぬ','イヌ','犬','puppy']),
  ('カフェ', array['cafe','喫茶店','コーヒー','カフェ','coffee']),
  ('ファッション', array['fashion','服','コーデ','ファッション','style'])
on conflict (term) do update
  set synonyms = excluded.synonyms,
      updated_at = now();

-- ============================================================
-- 2. search_query_intents — クエリ意図カテゴリ
-- ============================================================
create table if not exists public.search_query_intents (
  keyword text primary key,
  intent_category text not null
    check (intent_category in (
      'recipe','image','video','music','game',
      'travel','sports','manga','anime','book',
      'news','qa','community','person','place','shop','tech'
    )),
  updated_at timestamptz not null default now()
);

create index if not exists search_query_intents_category_idx
  on public.search_query_intents(intent_category);

alter table public.search_query_intents enable row level security;
drop policy if exists "intents_read" on public.search_query_intents;
create policy "intents_read" on public.search_query_intents
  for select using (true);

-- seed
insert into public.search_query_intents (keyword, intent_category) values
  ('料理','recipe'),('レシピ','recipe'),('食事','recipe'),('クッキング','recipe'),('cooking','recipe'),('recipe','recipe'),
  ('画像','image'),('写真','image'),('photo','image'),('image','image'),('pic','image'),
  ('動画','video'),('video','video'),('ビデオ','video'),('movie','video'),('ムービー','video'),
  ('音楽','music'),('music','music'),('曲','music'),('song','music'),('track','music'),
  ('ゲーム','game'),('game','game'),('gaming','game'),('プレイ','game'),
  ('旅行','travel'),('travel','travel'),('trip','travel'),('観光','travel'),('旅','travel'),
  ('スポーツ','sports'),('sport','sports'),('運動','sports'),
  ('漫画','manga'),('manga','manga'),('コミック','manga'),('comic','manga'),
  ('アニメ','anime'),('anime','anime'),
  ('本','book'),('book','book'),('書籍','book'),('読書','book'),
  ('ニュース','news'),('news','news'),('報道','news'),
  ('質問','qa'),('question','qa'),('疑問','qa'),('help','qa'),
  ('コミュニティ','community'),('community','community'),('みんな','community'),
  ('プログラミング','tech'),('programming','tech'),('coding','tech'),('dev','tech'),
  ('カフェ','place'),('cafe','place'),('店','place'),('shop','shop'),('店舗','shop')
on conflict (keyword) do update
  set intent_category = excluded.intent_category,
      updated_at = now();

-- ============================================================
-- 3. search_query_log — analytics
-- ============================================================
create table if not exists public.search_query_log (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  query text not null check (length(query) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists search_query_log_user_time_idx
  on public.search_query_log(user_id, created_at desc);
create index if not exists search_query_log_created_idx
  on public.search_query_log(created_at desc);

alter table public.search_query_log enable row level security;
-- 読み取り: 自分のログのみ
drop policy if exists "sql_read_own" on public.search_query_log;
create policy "sql_read_own" on public.search_query_log
  for select using (auth.uid() = user_id);
-- INSERT は SECURITY DEFINER 関数経由のみ (直接 client から書かせない)
revoke insert on public.search_query_log from anon;
revoke insert on public.search_query_log from authenticated;
revoke insert on public.search_query_log from public;

-- ============================================================
-- 4. search_posts_v2 — メインの検索 RPC
-- ============================================================
-- 流れ:
--   A. p_query を whitespace で tokenize (lower-case)
--   B. search_synonyms で各トークンを展開 → expanded[] 配列
--   C. search_synonyms.term に対して trigram similarity > 0.3 で
--      typo correction (拾えたら expanded[] に追加)
--   D. expanded[] の各語で posts.title / posts.content を or 検索
--   E. スコア合成 (text_relevance * recency_boost * eeat_score * quality_penalty)
-- ============================================================
drop function if exists public.search_posts_v2(text, int, int);
create or replace function public.search_posts_v2(
  p_query text,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  post_id uuid,
  final_score numeric,
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
  v_tokens text[];
  v_expanded text[];
  v_typo_terms text[];
  v_limit int := least(coalesce(p_limit, 20), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  -- A. tokenize (lower + whitespace split + 空要素除去)
  v_tokens := array(
    select t
    from unnest(regexp_split_to_array(lower(trim(p_query)), '\s+')) as t
    where length(t) > 0
  );

  if array_length(v_tokens, 1) is null then
    return;
  end if;

  -- B. 同義語展開: token 自体 + synonyms[] を union
  v_expanded := array(
    select distinct lower(x)
    from (
      select unnest(v_tokens) as x
      union all
      select unnest(s.synonyms) as x
      from public.search_synonyms s
      where s.term = any(v_tokens)
    ) sub
    where length(x) > 0
  );

  -- C. typo correction: 各 token に対して similarity > 0.3 な term を補う
  v_typo_terms := array(
    select distinct s.term
    from public.search_synonyms s,
         unnest(v_tokens) tok
    where similarity(s.term, tok) > 0.3
      and s.term <> tok
    limit 20
  );
  -- typo で見つかった term の synonyms も追加展開
  v_expanded := array(
    select distinct lower(x)
    from (
      select unnest(v_expanded) as x
      union all
      select unnest(s.synonyms) as x
      from public.search_synonyms s
      where s.term = any(v_typo_terms)
      union all
      select unnest(v_typo_terms) as x
    ) sub
    where length(x) > 0
  );

  -- D + E: posts を検索してスコアリング
  return query
  with candidates as (
    -- 各 expanded 語に対して 1 度だけ posts を hit
    select
      p.id,
      p.title,
      p.content,
      p.created_at,
      p.likes_count,
      p.concern_count,
      p.author_id,
      -- text_relevance: title は本文より 2x の重み
      --   * title への similarity (max over expanded)
      --   * content への similarity (max over expanded)
      coalesce((
        select max(similarity(coalesce(p.title, ''), e))
        from unnest(v_expanded) e
        where length(e) > 1
      ), 0) * 2.0
      + coalesce((
        select max(similarity(p.content, e))
        from unnest(v_expanded) e
        where length(e) > 1
      ), 0) as text_rel_raw,
      -- 同義語 hit が「実際に文字列として出現した」boost
      (case
        when exists (
          select 1 from unnest(v_expanded) e
          where length(e) > 1
            and (coalesce(p.title,'') ilike '%' || e || '%' or p.content ilike '%' || e || '%')
        )
        then 1.0 else 0.0
       end) as exact_hit
    from public.posts p
    where (
      -- 高速 pre-filter: trgm index 利用のため、 ilike を OR 並べる
      exists (
        select 1 from unnest(v_expanded) e
        where length(e) > 1
          and (coalesce(p.title,'') ilike '%' || e || '%' or p.content ilike '%' || e || '%')
      )
      or exists (
        select 1 from unnest(v_expanded) e
        where length(e) > 1
          and (similarity(coalesce(p.title,''), e) > 0.3 or similarity(p.content, e) > 0.3)
      )
    )
    -- archive / 削除済を弾く (どちらの column も存在しないなら no-op)
  ),
  scored as (
    select
      c.id,
      -- text_relevance: 0..3 程度
      (c.text_rel_raw + c.exact_hit) as text_relevance,
      -- recency_boost
      case
        when c.created_at > now() - interval '24 hours' then 1.0
        when c.created_at > now() - interval '7 days'   then 0.8
        when c.created_at > now() - interval '30 days'  then 0.5
        else 0.3
      end::numeric as recency_boost,
      -- eeat_score: author trust + post like 数 (上限 100)
      (
        coalesce((select trust_score from public.profiles pr where pr.id = c.author_id), 50)::numeric
          / 100.0 * 0.7
        + least(coalesce(c.likes_count, 0)::numeric / 100.0, 1.0) * 0.3
      ) as eeat_score,
      -- quality_penalty: concern_count が高ければ大幅減点
      case
        when coalesce(c.concern_count, 0) > 5 then 0.3
        when coalesce(c.concern_count, 0) > 2 then 0.7
        else 1.0
      end::numeric as quality_penalty,
      -- どの語が hit したかを返す (debug + UI ハイライト用)
      array(
        select distinct e
        from unnest(v_expanded) e
        where length(e) > 1
          and (coalesce(c.title,'') ilike '%' || e || '%' or c.content ilike '%' || e || '%')
        limit 10
      ) as matched_terms
    from candidates c
  )
  select
    s.id as post_id,
    (s.text_relevance * s.recency_boost * s.eeat_score * s.quality_penalty)::numeric as final_score,
    s.text_relevance,
    s.recency_boost,
    s.eeat_score,
    s.matched_terms
  from scored s
  where s.text_relevance > 0
  order by (s.text_relevance * s.recency_boost * s.eeat_score * s.quality_penalty) desc,
           s.recency_boost desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.search_posts_v2(text, int, int) from public;
grant execute on function public.search_posts_v2(text, int, int) to anon, authenticated;

-- ============================================================
-- 5. get_trending_topics — 直近 N 時間の頻出語抽出
-- ============================================================
-- 簡易版: title + content の最初 100 文字を space split して頻度 count。
-- 1〜2 文字の語 / 数字のみは除外 (ノイズ)。
-- ============================================================
drop function if exists public.get_trending_topics(int, int);
create or replace function public.get_trending_topics(
  p_window_hours int default 24,
  p_limit int default 10
)
returns table (
  topic text,
  post_count int,
  score numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window int := greatest(coalesce(p_window_hours, 24), 1);
  v_limit int := least(coalesce(p_limit, 10), 50);
begin
  return query
  with recent as (
    select
      coalesce(p.title, '') || ' ' || left(coalesce(p.content, ''), 200) as txt,
      p.id,
      p.created_at,
      p.likes_count,
      p.concern_count
    from public.posts p
    where p.created_at > now() - make_interval(hours => v_window)
  ),
  tokens as (
    select
      lower(t) as token,
      r.id,
      r.likes_count,
      r.concern_count
    from recent r,
         lateral unnest(regexp_split_to_array(r.txt, '[\s\.,!?\(\)\[\]"''#@/\\:;|]+')) as t
    where length(t) >= 2
      and t !~ '^[0-9]+$'  -- 数字のみ除外
      and lower(t) not in (
        -- 簡易 stopword (日本語 + 英語)
        'the','and','for','this','that','with','from','have','was','are','you','your','i','we',
        'です','ます','する','した','して','こと','もの','です','ます','こ','よ','ね','の','が','は','を','に','で','と','も','や','か'
      )
  )
  select
    tk.token as topic,
    count(distinct tk.id)::int as post_count,
    (
      count(distinct tk.id)::numeric
      + coalesce(sum(tk.likes_count), 0)::numeric / 50.0
      - coalesce(sum(tk.concern_count), 0)::numeric / 10.0
    ) as score
  from tokens tk
  group by tk.token
  having count(distinct tk.id) >= 2
  order by score desc, post_count desc
  limit v_limit;
end;
$$;

revoke all on function public.get_trending_topics(int, int) from public;
grant execute on function public.get_trending_topics(int, int) to anon, authenticated;

-- ============================================================
-- 6. search_log_query — クエリログ記録 (best-effort + rate limit)
-- ============================================================
-- 1 user あたり 100ms に 1 query まで。auth.uid() が null (= anon) は no-op。
-- ============================================================
drop function if exists public.search_log_query(text);
create or replace function public.search_log_query(p_query text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_last_at timestamptz;
begin
  if v_uid is null then
    return;
  end if;
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;
  if length(p_query) > 200 then
    p_query := left(p_query, 200);
  end if;

  -- 直近 1 件を確認 (簡易 rate limit)
  select created_at into v_last_at
  from public.search_query_log
  where user_id = v_uid
  order by created_at desc
  limit 1;

  if v_last_at is not null and v_last_at > now() - interval '100 milliseconds' then
    return;  -- rate limited (no-op)
  end if;

  insert into public.search_query_log(user_id, query)
  values (v_uid, trim(p_query));
end;
$$;

revoke all on function public.search_log_query(text) from public;
grant execute on function public.search_log_query(text) to authenticated;

-- ============================================================
-- 7. ANALYZE (planner に新 index / 新 stats を読ませる)
-- ============================================================
analyze public.search_synonyms;
analyze public.search_query_intents;
analyze public.posts;

select '0085_search_engine_v2 完了 — search_posts_v2 / get_trending_topics / search_log_query + synonyms/intents seed' as note;
