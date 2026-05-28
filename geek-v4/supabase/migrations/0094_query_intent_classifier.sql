-- ============================================================
-- 0094_query_intent_classifier.sql
--   検索クエリの意図 (intent) を categorical に推定し、
--   intent ごとに ranking weight (lambda) を切り替えるレイヤ
-- ============================================================
-- 目的:
--   モデルマージにおける「task vector」概念を「intent 別タスク」に応用する。
--   例:
--     intent = 'recent'    → freshness / recency の重みを大きくする
--     intent = 'qa'        → eeat / text_relevance の重みを大きくする
--     intent = 'community' → usability (community 関連 boost) を大きくする
--     intent = 'recipe'    → usability + eeat を大きくする
--     intent = 'news'      → recency + freshness を大きくする
--     intent = 'place'     → recency を中程度に大きくする
--     intent = 'shop'      → eeat を中程度に大きくする
--
--   0085 で導入した search_query_intents (keyword -> intent_category) と、
--   0088 で導入した ranking_weights (profile, signal_key, lambda) の間に、
--   「intent 別に lambda を倍率で上書きする」レイヤを差し込む。
--
--   さらに、時事ネタ (例: 「ワールドカップ」「選挙」) を keyword + decay
--   テーブルで管理し、クエリにそれが含まれていれば freshness signal を boost
--   する仕組みを足す。admin が手動で keyword と expires_at を入れる運用。
--
-- このマイグレーションで追加するもの:
--   1. RPC classify_query_intent(p_query text)
--        — クエリを tokenize し、search_query_intents で intent を集計、
--          confidence = (このトピックのトークン数) / (全トークン数) で
--          上位 3 件を返す。0 件なら ('general', 1.0)。
--   2. table intent_weight_modifiers
--        — (intent_category, signal_key) → multiplier (base lambda に掛ける)
--   3. seed intent_weight_modifiers (recent/news/recipe/qa/community/place/shop)
--   4. table recent_event_keywords
--        — 時事ネタ keyword (boost / added_at / expires_at)
--   5. RPC is_recent_event_query(p_query text)
--        — query に live な keyword が含まれていれば true
--   6. RPC get_weights_for_query(p_query text)
--        — classify_query_intent でトップ intent を取得し、0088 の active
--          profile の base lambda に対して intent_weight_modifiers で
--          confidence による linear interpolate な上書きを掛けて返す。
--          is_recent_event_query が true なら freshness signal にさらに
--          recent_event boost (max boost を選択) を掛ける。
--
-- 既存スキーマ前提 (確認済、編集禁止):
--   public.search_query_intents(keyword pk, intent_category text)     — 0085
--     intent_category check 一覧:
--       'recipe','image','video','music','game','travel','sports',
--       'manga','anime','book','news','qa','community','person',
--       'place','shop','tech'
--   public.ranking_weights(profile_id, signal_key, lambda, ...)       — 0088
--   public.ranking_weight_profiles(id, profile_name, is_active)       — 0088
--   public.current_user_is_admin()                                    — 0020
--   public.get_active_ranking_weights() :: (signal_key, lambda, threshold) — 0088
--
-- 設計判断:
--   * すべて create [if not exists] / on conflict ... do update で冪等。
--   * SECURITY DEFINER の関数は search_path = pg_catalog, public で lockdown。
--   * RLS:
--       - intent_weight_modifiers: 誰でも read / admin のみ write
--       - recent_event_keywords:   誰でも read / admin のみ write
--   * confidence による linear interpolate は
--       effective_lambda = base_lambda * (1 + (multiplier - 1) * confidence)
--     とする。confidence=1.0 で完全に multiplier、confidence=0 で base のまま。
--   * 「location / personal categorical (政治・宗教・性別など) は扱わない」。
--     CLAUDE.md のプライバシー方針に従い、これら categorical を多用する
--     intent (例: 'religion', 'gender', 'political') は seed に含めない。
--     既に 0085 の intent_category check で対応カテゴリは
--       recipe / image / video / music / game / travel / sports / manga /
--       anime / book / news / qa / community / person / place / shop / tech
--     のみに絞られているため、ここでは更に person を modifier から除外
--     (個人特定的な categorical 推定は ranking から外す)。
--   * 'recent' という intent は 0085 の check 制約に存在しないため、
--     intent_weight_modifiers では「擬似 intent」として扱う。
--     classify_query_intent は実 intent_category の文字列のみを返すので、
--     'recent' modifier は is_recent_event_query() からの bypass 用に使う
--     (= 単独で intent='recent' を返すのは is_recent_event_query 経由のみ)。
--   * 末尾 select 'note' で完了通知。
-- ============================================================

-- ============================================================
-- 1. RPC classify_query_intent(p_query text)
-- ============================================================
-- 戻り値: table(intent text, confidence numeric)
-- ロジック:
--   A. p_query を whitespace で tokenize (lower-case + 空要素除外)
--   B. search_query_intents を keyword で join し、token ごとに
--      intent_category を求める
--   C. intent_category 別の hit token 数 / 全 token 数 = confidence
--   D. confidence 降順で上位 3 件を返す
--   E. 0 件なら ('general', 1.0)
-- ============================================================
drop function if exists public.classify_query_intent(text);
create or replace function public.classify_query_intent(p_query text)
returns table (
  intent     text,
  confidence numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tokens     text[];
  v_total      int;
begin
  if p_query is null or length(trim(p_query)) = 0 then
    return query select 'general'::text, 1.0::numeric;
    return;
  end if;

  -- A. tokenize
  v_tokens := array(
    select t
      from unnest(regexp_split_to_array(lower(trim(p_query)), '\s+')) as t
     where length(t) > 0
  );

  v_total := coalesce(array_length(v_tokens, 1), 0);
  if v_total = 0 then
    return query select 'general'::text, 1.0::numeric;
    return;
  end if;

  -- B-D. intent_category 別の hit 数 / 全 token 数 を confidence として算出
  --   * person は categorical 個人推定なので除外 (プライバシー方針)
  --   * 上位 3 件のみ
  return query
  with hits as (
    select sqi.intent_category as ic
      from unnest(v_tokens) tok
      join public.search_query_intents sqi
        on sqi.keyword = tok
     where sqi.intent_category <> 'person'
  ),
  agg as (
    select ic,
           (count(*)::numeric / v_total::numeric) as conf
      from hits
     group by ic
  ),
  ranked as (
    select ic, conf
      from agg
     order by conf desc, ic asc
     limit 3
  )
  select ic::text as intent, conf::numeric as confidence
    from ranked;

  -- E. 0 件なら general/1.0
  if not found then
    return query select 'general'::text, 1.0::numeric;
  end if;
end;
$$;

revoke all on function public.classify_query_intent(text) from public;
grant execute on function public.classify_query_intent(text) to anon, authenticated;

comment on function public.classify_query_intent(text) is
  'クエリを tokenize し search_query_intents で集計、(intent, confidence) 上位 3 件を返す。0 件なら general/1.0';

-- ============================================================
-- 2. intent_weight_modifiers — intent 別 signal lambda 倍率
-- ============================================================
-- multiplier:
--   - 1.0   = base lambda そのまま (= no-op)
--   - > 1.0 = 該当 intent では signal を強める
--   - 0 < x < 1.0 = 該当 intent では signal を弱める
-- get_weights_for_query は confidence を使って linear interpolate する:
--   effective_lambda = base * (1 + (multiplier - 1) * confidence)
-- ============================================================
create table if not exists public.intent_weight_modifiers (
  intent_category text not null check (length(intent_category) between 1 and 64),
  signal_key      text not null check (length(signal_key) between 1 and 64),
  multiplier      numeric not null default 1.0,
  active          boolean not null default true,
  notes           text,
  updated_at      timestamptz not null default now(),
  primary key (intent_category, signal_key)
);

create index if not exists ix_intent_weight_modifiers_active
  on public.intent_weight_modifiers(intent_category)
  where active = true;

comment on table public.intent_weight_modifiers is
  '(intent_category, signal_key) → multiplier。base lambda にかける倍率で intent 別ランキングを実現する';

alter table public.intent_weight_modifiers enable row level security;

-- read: 誰でも OK
drop policy if exists iwm_read_all on public.intent_weight_modifiers;
create policy iwm_read_all on public.intent_weight_modifiers
  for select
  using (true);

-- write: admin のみ
drop policy if exists iwm_admin_write on public.intent_weight_modifiers;
create policy iwm_admin_write on public.intent_weight_modifiers
  for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ============================================================
-- 3. seed intent_weight_modifiers
-- ============================================================
-- 仕様で指定された組:
--   ('recent', 'recency', 2.0)
--   ('recent', 'freshness', 2.5)
--   ('news', 'recency', 2.0)
--   ('news', 'freshness', 2.0)
--   ('recipe', 'usability', 2.0)
--   ('recipe', 'eeat', 1.5)
--   ('qa', 'eeat', 2.0)
--   ('qa', 'text_relevance', 1.5)
--   ('community', 'usability', 1.2)
--   ('place', 'recency', 1.3)
--   ('shop', 'eeat', 1.5)
-- ============================================================
insert into public.intent_weight_modifiers(intent_category, signal_key, multiplier, active, notes)
values
  ('recent',    'recency',        2.0, true, '時事ネタ — recency 大幅 boost'),
  ('recent',    'freshness',      2.5, true, '時事ネタ — freshness 最大 boost'),
  ('news',      'recency',        2.0, true, 'news intent — recency 大幅 boost'),
  ('news',      'freshness',      2.0, true, 'news intent — freshness 大幅 boost'),
  ('recipe',    'usability',      2.0, true, 'recipe intent — usability (画像/レイアウト品質)'),
  ('recipe',    'eeat',           1.5, true, 'recipe intent — 投稿者 trust も中程度に重視'),
  ('qa',        'eeat',           2.0, true, 'qa intent — 信頼度を最重視'),
  ('qa',        'text_relevance', 1.5, true, 'qa intent — 質問と回答の語彙一致'),
  ('community', 'usability',      1.2, true, 'community intent — community 関連の usability を微増'),
  ('place',     'recency',        1.3, true, 'place intent — 最新の店舗情報を優先'),
  ('shop',      'eeat',           1.5, true, 'shop intent — 投稿者の信頼度を中程度に重視')
on conflict (intent_category, signal_key) do update
   set multiplier = excluded.multiplier,
       active     = excluded.active,
       notes      = excluded.notes,
       updated_at = now();

-- ============================================================
-- 4. recent_event_keywords — 時事ネタ keyword + decay
-- ============================================================
-- admin が手で keyword を追加。expires_at までは「時事ネタ」として扱われ、
-- query にこの keyword が含まれていれば freshness signal を boost する。
-- boost 値は keyword ごとに調整可能 (default 1.5)。
-- ============================================================
create table if not exists public.recent_event_keywords (
  keyword    text primary key check (length(keyword) between 1 and 64),
  boost      numeric not null default 1.5,
  added_at   timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  notes      text
);

create index if not exists ix_recent_event_keywords_expires
  on public.recent_event_keywords(expires_at);

comment on table public.recent_event_keywords is
  '時事ネタ keyword (例: 「ワールドカップ」「選挙」)。expires_at までは freshness boost が掛かる。admin が手で追加';

alter table public.recent_event_keywords enable row level security;

-- read: 誰でも OK
drop policy if exists rek_read_all on public.recent_event_keywords;
create policy rek_read_all on public.recent_event_keywords
  for select
  using (true);

-- write: admin のみ
drop policy if exists rek_admin_write on public.recent_event_keywords;
create policy rek_admin_write on public.recent_event_keywords
  for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ============================================================
-- 5. RPC is_recent_event_query(p_query text)
-- ============================================================
-- 戻り値: boolean
-- query を lower-case に正規化し、live な (expires_at > now()) keyword が
-- ひとつでも含まれていれば true。
-- ============================================================
drop function if exists public.is_recent_event_query(text);
create or replace function public.is_recent_event_query(p_query text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lower text;
  v_hit   boolean;
begin
  if p_query is null or length(trim(p_query)) = 0 then
    return false;
  end if;

  v_lower := lower(trim(p_query));

  select exists (
    select 1
      from public.recent_event_keywords rek
     where rek.expires_at > now()
       and v_lower like '%' || lower(rek.keyword) || '%'
  )
  into v_hit;

  return coalesce(v_hit, false);
end;
$$;

revoke all on function public.is_recent_event_query(text) from public;
grant execute on function public.is_recent_event_query(text) to anon, authenticated;

comment on function public.is_recent_event_query(text) is
  '時事ネタ keyword が含まれているか判定。live (expires_at > now()) なものだけ対象';

-- ============================================================
-- 6. RPC get_weights_for_query(p_query text)
-- ============================================================
-- 戻り値: table(signal_key text, effective_lambda numeric)
-- ロジック:
--   1. 0088 の get_active_ranking_weights() で base (signal_key, lambda) を取得
--   2. classify_query_intent でトップ intent を取得
--      (= confidence 降順で最初の 1 件)
--   3. intent_weight_modifiers から (top_intent, signal_key) → multiplier を取得
--      なければ 1.0
--   4. effective_lambda = base.lambda * (1 + (multiplier - 1) * confidence)
--      confidence で linear interpolate する
--   5. is_recent_event_query(p_query) = true なら freshness signal にさらに
--      recent_event の boost (max boost) を掛ける
-- ============================================================
drop function if exists public.get_weights_for_query(text);
create or replace function public.get_weights_for_query(p_query text)
returns table (
  signal_key       text,
  effective_lambda numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_top_intent      text;
  v_top_confidence  numeric;
  v_is_recent_event boolean := false;
  v_recent_boost    numeric := 1.0;
begin
  -- 2. top intent
  select ci.intent, ci.confidence
    into v_top_intent, v_top_confidence
    from public.classify_query_intent(p_query) ci
   order by ci.confidence desc
   limit 1;

  -- defensive defaults
  if v_top_intent is null then
    v_top_intent := 'general';
  end if;
  if v_top_confidence is null then
    v_top_confidence := 1.0;
  end if;

  -- 5. 時事ネタ判定 (freshness boost)
  v_is_recent_event := public.is_recent_event_query(p_query);
  if v_is_recent_event then
    -- live な keyword の中で query に含まれるものから max boost を取る
    select coalesce(max(rek.boost), 1.0)
      into v_recent_boost
      from public.recent_event_keywords rek
     where rek.expires_at > now()
       and lower(trim(coalesce(p_query, ''))) like '%' || lower(rek.keyword) || '%';
  end if;

  -- 1. base weights を読み、3-4 で intent multiplier と confidence で interpolate
  return query
  with base as (
    select b.signal_key, b.lambda
      from public.get_active_ranking_weights() b
  ),
  intent_mod as (
    select iwm.signal_key, iwm.multiplier
      from public.intent_weight_modifiers iwm
     where iwm.intent_category = v_top_intent
       and iwm.active = true
  )
  select
    base.signal_key::text,
    -- intent modifier を confidence で linear interpolate
    --   eff = base.lambda * (1 + (multiplier - 1) * confidence)
    -- multiplier が無ければ 1.0 (= base のまま)
    -- freshness のみ、時事ネタなら追加で recent_boost を掛ける
    (
      base.lambda
      * (1 + (coalesce(intent_mod.multiplier, 1.0) - 1) * v_top_confidence)
      * (case
           when base.signal_key = 'freshness' and v_is_recent_event
             then v_recent_boost
           else 1.0
         end)
    )::numeric as effective_lambda
  from base
  left join intent_mod on intent_mod.signal_key = base.signal_key;
end;
$$;

revoke all on function public.get_weights_for_query(text) from public;
grant execute on function public.get_weights_for_query(text) to anon, authenticated;

comment on function public.get_weights_for_query(text) is
  '0088 の active profile の base lambda に対し、classify_query_intent のトップ intent と confidence で linear interpolate な上書きを掛けて返す。時事ネタ keyword が含まれれば freshness を追加 boost';

-- ============================================================
-- 7. ANALYZE
-- ============================================================
analyze public.intent_weight_modifiers;
analyze public.recent_event_keywords;

-- ============================================================
-- 8. 完了通知
-- ============================================================
select '0094_query_intent_classifier 完了 — classify_query_intent / intent_weight_modifiers (11 seeds) / recent_event_keywords / is_recent_event_query / get_weights_for_query' as note;
