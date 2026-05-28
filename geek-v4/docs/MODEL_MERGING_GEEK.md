# MODEL_MERGING_GEEK.md — モデルマージ理論を SQL 線形結合として Geek に適用する戦略書

> 本書は GEEK (Supabase + PostgreSQL + React Native) の ranking スタックに、
> ニューラルネットワークのモデルマージ理論 (Task Arithmetic / TIES / AdaMerging /
> MergeRec / Task Negation) を **SQL の線形結合** として翻訳・移植するための戦略書。
>
> 前提: GEEK は Supabase backend のため、本物のニューラル重み演算は行えない。
> しかし、`search_posts_v2` / `search_posts_v3` / `post_quality_score` で
> 既に「複数 signal の合成」を行っているため、各 signal を **タスクベクトル**、
> 各係数を **マージ係数 (lambda)** と見なすことで、SQL 上で等価な構造を再現できる。

---

## 1. 「ニューラルネット重みマージ → SQL score 線形結合」のマッピング

ニューラルマージは `theta_merged = theta_base + sum(lambda_i * (theta_task_i - theta_base))` で
合成される。これは「base モデルに、各タスク固有の更新分 (task vector) を係数 lambda で
重ね合わせる」ものである。

GEEK の検索 ranking は既にこれと同型の構造をしている: 各 signal を **base からの差分**、
final_score を **合成済モデル** と見ればよい。

| ニューラル理論 | 対応する SQL 構造 (Geek) | 実体 (migration / RPC) |
|---|---|---|
| `theta_base` (事前学習モデル) | `text_relevance` (基礎類似度) | `search_posts_v2` の trgm similarity 合算 |
| `theta_task_i` (task-specific FT) | 各 signal column | `recency_boost`, `eeat_score`, `quality_penalty`, `viewed_boost`, `history_boost`, `usability_score` |
| `task_vector_i = theta_task_i - theta_base` | signal を base に対する **乗算 boost** で表現 | v2/v3 では `base * boost` の形 |
| `lambda_i` (マージ係数) | SQL 内のリテラル係数 / weight table | 現状はリテラル (0.7, 0.3, 1.2 など) / 将来は `signal_weights` table |
| `theta_merged` (合成モデル) | `final_score` | `final_score = text_relevance * recency_boost * eeat_score * quality_penalty * viewed_boost * history_boost` |
| Task Arithmetic addition | 乗算 (現状) または `+ lambda * signal` の加算 (将来) | v3 の `final_score_v` 行 |
| Task Arithmetic negation | 負係数で signal を引く | spam / safety penalty 用に新設予定 (§ 5) |
| TIES sparsification | signal の閾値 drop + 符号一致のみ採用 | § 6 で SQL 化 |
| AdaMerging (係数自動学習) | `signal_weights` table + cron で lambda 更新 | § 3 |
| MergeRec (コミュニティ別合成) | `community_task_weights` table | § 4 |

要点: **GEEK では「重みの linear interpolation」が「signal の線形 / 対数線形結合」に対応する**。
スカラー化された score 空間で合成するため、計算は単純な乗除算 + window 関数で済む。

---

## 2. Geek の signal を「タスクベクトル」と見たときの一覧

現状 (0085-0087) で利用可能な signal を task vector としてカタログ化する。
各 signal の値域、由来、lambda の意味を明示する。

| signal name | 値域 | 由来 (migration) | 意味するタスク | lambda の意味 |
|---|---|---|---|---|
| `text_relevance` | 0..3 程度 | `search_posts_v2` (0085) | "クエリの語彙とどれだけ合致しているか" | `lambda_text`: テキスト一致をどれだけ重視するか |
| `recency_boost` | 0.3, 0.5, 0.8, 1.0 | `search_posts_v2` (0085) | "新鮮さ" タスク | `lambda_recency`: 新しさをどれだけ盛るか |
| `eeat_score` | 0..1 | `search_posts_v2` (0085) | "投稿者の信頼性 + 投稿の支持度" | `lambda_eeat`: trust と like のミックス係数 |
| `quality_penalty` | 0.3, 0.7, 1.0 | `search_posts_v2` (0085) | "concern (低品質シグナル) で減点" | `lambda_quality`: 通報傾向への感度 |
| `viewed_boost` | 1.0 or 1.2 | `search_posts_v3` (0086) | "個人の再閲覧" タスク | `lambda_view`: re-engagement を盛る度合い |
| `history_boost` | 1.0 or 1.1 | `search_posts_v3` (0086) | "個人の検索履歴と関連" タスク | `lambda_history`: 履歴連続性係数 |
| `length_score` | 0.4, 0.7, 1.0 | `post_quality_score` (0087) | "本文の長さ最適性" | `lambda_length`: 短文 / 長文ペナルティ強度 |
| `media_score` | 0.85, 1.0 | `post_quality_score` (0087) | "画像 / 動画添付" | `lambda_media`: マルチメディア優遇 |
| `link_health_score` | 0.5, 0.8, 1.0 | `post_quality_score` (0087) | "スパムリンク多発の抑制" | `lambda_link`: link spam 抑制強度 |
| `engagement_velocity` | 0..1 | `post_quality_score` (0087) | "24h 以内 like 速度" | `lambda_velocity`: 短期 burst への感度 |
| `usability_score` | 0..1 | `post_quality_score` (0087) | 上記 4 つの加重平均 | `lambda_usability`: ページ体験総合係数 |

ニューラルマージとの違いは、これらが **post 単位のスカラー** であることだが、
本質的には「事前学習 (text_relevance) + 複数の FT (recency, eeat, ...)」を合成する構造と同型。

---

## 3. AdaMerging を「task weight table + cron」で近似する設計

AdaMerging は test-time 入力に対し lambda を自動チューニングする手法。
GEEK では実 online gradient は走らせられないが、**24h ごとに dwell / CTR ログから
ridge regression 的に lambda を回帰更新** する設計で代替する。

### 3.1 schema (新 migration 0088 想定)

```sql
create table public.signal_weights (
  weight_version int primary key,
  lambda_text       numeric not null default 1.0,
  lambda_recency    numeric not null default 1.0,
  lambda_eeat       numeric not null default 1.0,
  lambda_quality    numeric not null default 1.0,
  lambda_view       numeric not null default 1.0,
  lambda_history    numeric not null default 1.0,
  lambda_usability  numeric not null default 1.0,
  -- 負係数で hard penalty を入れる用
  lambda_safety     numeric not null default -1.0,
  lambda_spam       numeric not null default -0.5,
  is_active boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create unique index signal_weights_active_uniq
  on public.signal_weights ((true)) where is_active = true;
```

active 行は同時に 1 行のみ存在することを部分 unique index で保証する。

### 3.2 search_posts_v4 (lambda を読み込む RPC)

```
search_posts_v4(p_query, p_limit, p_offset):
  w := signal_weights where is_active = true
  base := search_posts_v3(p_query, p_limit * 3, 0)
  -- 加法マージ: log 線形で安定化
  log_score :=
    lambda_text       * ln(1 + base.text_relevance)
  + lambda_recency    * ln(1 + base.recency_boost)
  + lambda_eeat       * ln(1 + base.eeat_score * 3)
  + lambda_quality    * ln(1 + base.quality_penalty)
  + lambda_view       * ln(base.viewed_boost)
  + lambda_history    * ln(base.history_boost)
  + lambda_usability  * ln(1 + usability_score)
  + lambda_safety     * safety_penalty
  + lambda_spam       * spam_penalty
  final_score := exp(log_score)
```

log 線形にする理由: 乗算合成のままだと一つの signal が 0 になると final も 0、
かつ係数が指数効果を持つため不安定。log 領域での加算なら lambda は線形効果に近づき、
回帰で学習しやすい。

### 3.3 lambda の自動学習 (pg_cron + Edge Function)

```
nightly job (cron 03:00 JST):
  1) 直近 24h の (query, post_id, dwell_ms, click) ログを取得
  2) 各 row について signal の値を再計算 (v_search_signals + v3 の dry-run)
  3) リッジ回帰: lambda* = argmin sum_i (y_i - sum_j lambda_j * x_ij)^2 + alpha * ||lambda||^2
     - y_i = log(dwell_ms + 1) (dwell が長い結果ほど良かったと仮定)
     - x_ij = signal j の値
  4) lambda の絶対値 cap を ±3 にクリップ (爆発防止 — § 9 参照)
  5) 新 weight_version を insert (is_active = false)
  6) A/B (§ 7) で勝利確認後に is_active = true へ更新
```

回帰は SQL 内で `lstsq` 的なことができないため、Edge Function (Deno + linear-regression
ライブラリ) で計算し、結果だけを `signal_weights` に書き戻す。

---

## 4. MergeRec を「community_task_weights」で近似する設計

MergeRec はユーザーごと / ドメインごとに異なる lambda を持たせて合成する。
GEEK では **コミュニティごとに lambda を変える** ことで近似する。

### 4.1 schema (新 migration 0089 想定)

```sql
create table public.community_task_weights (
  community_id uuid primary key references public.communities(id) on delete cascade,
  lambda_text      numeric not null default 1.0,
  lambda_recency   numeric not null default 1.0,
  lambda_eeat      numeric not null default 1.0,
  lambda_velocity  numeric not null default 1.0,
  lambda_media     numeric not null default 1.0,
  notes text,
  updated_at timestamptz not null default now()
);
```

### 4.2 community 別 lambda の意味

例:
- ニュース系コミュニティ: `lambda_recency` を大きく、`lambda_eeat` も大きく
- レシピ系コミュニティ: `lambda_media`, `lambda_length` を大きく、`lambda_recency` は小さく
- 質問板コミュニティ: `lambda_text` と `lambda_eeat` を大きく、`lambda_velocity` は小さく

```
search_within_community_v4(p_community_id, p_query):
  if p_community_id is not null then
    w := community_task_weights where community_id = p_community_id
  else
    w := signal_weights where is_active = true  -- global fallback
  end if
  -- 以後 search_posts_v4 と同じ log 線形合成
```

### 4.3 fallback / cold-start

新規 community で行が無い場合は、global の `signal_weights` を素直に流用する
(MergeRec の「ベース重み」に相当)。一定の log / engagement が貯まったら
community 専用の重みを Edge Function で fit する。

---

## 5. Task Negation で safety / spam / clickbait を負係数で引く設計

Task Arithmetic の Task Negation は `theta - lambda * task_vector_bad` で
「望ましくない方向」を引く。GEEK では同様の構造で、**禁止トピック / spam / clickbait の
signal を負係数で final_score から引く**。

### 5.1 schema (新 migration 0090 想定)

```sql
-- 計算済み hazard signal を保持する material view 相当
create materialized view public.post_hazard_signals as
select
  p.id as post_id,
  -- safety_penalty: 0 = safe, 1 = highly unsafe
  case
    when exists (
      select 1 from public.content_moderation_flags m
      where m.post_id = p.id and m.severity = 'high'
    ) then 1.0
    when exists (
      select 1 from public.content_moderation_flags m
      where m.post_id = p.id and m.severity = 'medium'
    ) then 0.5
    else 0.0
  end::numeric as safety_penalty,
  -- spam_penalty: link_health_score の逆相 + duplicate title
  (1.0 - pqs.link_health_score)::numeric as spam_penalty,
  -- clickbait_penalty: title が全角感嘆符 / 釣り語を多用
  case
    when coalesce(p.title,'') ~ '(衝撃|必見|やばい|閲覧注意|!{2,}|！{2,})' then 0.7
    else 0.0
  end::numeric as clickbait_penalty
from public.posts p
join public.post_quality_score pqs on pqs.post_id = p.id;
```

### 5.2 v4 への組み込み

```
final_log_score :=
    (sum of positive lambdas * signals)
  + lambda_safety   * safety_penalty   -- lambda_safety   < 0
  + lambda_spam     * spam_penalty     -- lambda_spam     < 0
  + lambda_clickbait* clickbait_penalty-- lambda_clickbait< 0
```

これは数学的には:

`theta_merged = theta_base + sum_pos(lambda_i * v_i) - sum_neg(|lambda_j| * v_j)`

で、Task Negation そのものに対応する。

### 5.3 safety lambda は固定 (学習対象から除外)

`lambda_safety` だけは AdaMerging cron の回帰対象から **除外** する。
これは「ユーザーが NSFW を頻繁にクリックしているから safety を弱めよう」というドリフトを
防ぐため (§ 9 silent regress 参照)。コードで `where param_name not in ('lambda_safety')`
を明示する。

---

## 6. TIES-like sparsification を SQL で実装する方法

TIES Merging は 3 ステップで干渉を減らす:
1. **Trim**: 各 task vector の小さい成分を 0 にする
2. **Elect Sign**: 符号が衝突する成分は多数決で残す
3. **Disjoint Merge**: 残った成分だけを平均化

GEEK には「成分 (parameter)」が無いので、**signal の値そのものを次元とみなして**
trim + sign election を SQL の case 文 + 集約で表現する。

### 6.1 Trim (signal threshold drop)

各 signal が「base + delta」と分解できると見なし、delta が小さければ drop する:

```sql
-- 各 signal の "delta" を平均からのズレで定義
with mean_signals as (
  select
    avg(text_relevance)  as mu_text,
    avg(recency_boost)   as mu_recency,
    avg(eeat_score)      as mu_eeat
  from candidates
),
trimmed as (
  select
    c.post_id,
    case when abs(c.text_relevance - m.mu_text) < 0.05 then m.mu_text
         else c.text_relevance end as text_relevance,
    case when abs(c.recency_boost - m.mu_recency) < 0.05 then m.mu_recency
         else c.recency_boost end as recency_boost,
    ...
  from candidates c, mean_signals m
)
```

これで「平均と大差ない signal は無効化 (= 0 ベクトル)」 として扱える。

### 6.2 Sign Election

signal を「base より高い (+1)」「base より低い (-1)」に符号化し、
コミュニティ集約内で多数決を取る:

```sql
with signs as (
  select
    post_id,
    sign(text_relevance - mu_text) as sgn_text,
    sign(recency_boost  - mu_recency) as sgn_recency,
    ...
  from trimmed cross join mean_signals
),
elected as (
  select
    sgn_text,
    count(*) as votes
  from signs
  group by sgn_text
  order by votes desc
  limit 1
)
```

community 内で「text relevance を上げる方向に多くの post が傾いている」なら +1 を採用、
そうでない方向の signal は drop する。

### 6.3 Disjoint Merge

elected sign に一致する row のみで final 平均を取る:

```sql
select avg(text_relevance)
from candidates c
where sign(c.text_relevance - (select mu_text from mean_signals)) = (select sgn_text from elected)
```

実用上の閾値: trim cutoff は **signal 値の標準偏差の 0.5σ 以下なら drop**、
elect は **community 内で 60% 以上の符号一致** を要件にする。

---

## 7. 評価ハーネス (検索 bench, A/B group, dwell/CTR ログ)

### 7.1 検索 bench テストセット

固定クエリと「期待される top-K post_id 集合」をペアにした bench を用意する。

```sql
create table public.search_bench_queries (
  id bigserial primary key,
  query text not null,
  expected_post_ids uuid[] not null,
  notes text
);
```

bench 実行 (Edge Function):
```
for each weight_version v:
  for each (query, expected) in search_bench_queries:
    actual := search_posts_v4(query, 10, 0)  with active = v
    precision_at_10 := |actual ∩ expected| / 10
    ndcg_at_10      := compute_ndcg(actual, expected)
  store metrics in bench_results(weight_version, query, precision, ndcg)
```

### 7.2 A/B group 割当

```sql
create table public.user_weight_assignments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weight_version int not null references public.signal_weights(weight_version),
  assigned_at timestamptz not null default now()
);
```

`search_posts_v4` 内で `auth.uid()` の割当 version を読み、それに従って lambda を選ぶ。
新 version は **5% → 20% → 50% → 100%** とゲートを段階的に開く。

### 7.3 dwell / CTR ログ

新規 table `search_engagement_log` を作る:

```sql
create table public.search_engagement_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  query text not null,
  shown_post_id uuid not null references public.posts(id) on delete cascade,
  rank int not null,
  clicked boolean not null default false,
  dwell_ms int,
  weight_version int references public.signal_weights(weight_version),
  created_at timestamptz not null default now()
);
```

クライアントから `log_search_engagement(query, post_id, rank, clicked, dwell_ms)` RPC で書き、
これが AdaMerging cron (§ 3) の入力になる。

評価指標:
- **CTR@K**: top-K の clicked 率
- **Mean dwell**: clicked 後の dwell_ms 平均
- **Diversity@K**: top-K 内の unique author 数

### 7.4 統計的有意性

新 version が active 候補に上がるとき、Mann-Whitney U test で
旧 version との CTR / dwell 差を 95% CI で確認する。Edge Function で計算。

---

## 8. ロールバック手順 (weight version 管理)

### 8.1 version 凍結

`signal_weights` は **insert-only + soft activate** で運用する。
update は `is_active` flag のみ許可、その他列は変更不可:

```sql
create or replace function lock_signal_weights_immutable()
returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    if OLD.lambda_text <> NEW.lambda_text
       or OLD.lambda_recency <> NEW.lambda_recency
       /* ... 全 lambda 列 ... */
    then
      raise exception 'signal_weights lambdas are immutable; insert a new version instead';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_signal_weights_immutable
before update on public.signal_weights
for each row execute function lock_signal_weights_immutable();
```

### 8.2 即時 rollback 手順

```sql
-- 1) 現 active を解除
update public.signal_weights set is_active = false where is_active = true;
-- 2) 直前の known-good version を active 化
update public.signal_weights set is_active = true where weight_version = <prev>;
-- 3) Sentry に rollback breadcrumb (Edge Function 経由)
```

部分 unique index (§ 3.1) があるため、二重 active は DB レベルで弾かれる。

### 8.3 A/B 中の段階 rollback

`user_weight_assignments` を新 version の user について delete し、
default の active version に戻す:

```sql
delete from public.user_weight_assignments where weight_version = <bad>;
```

### 8.4 ロールバック判断基準

以下のいずれかで 24h 以内に rollback トリガー:
- CTR@10 が旧版 -15% 以上低下
- safety violation report が 2x 以上
- p95 RPC latency が 1.5x 以上
- Sentry の `search.error` 件数が 3x 以上

---

## 9. 落とし穴

### 9.1 干渉 (interference)

複数 signal の lambda を同時に上げると、相互打ち消しで final が想定外の傾向を示す。
特に `lambda_recency` ↑ と `lambda_eeat` ↑ を同時にやると「新参の信頼スコア 50 の post」
ばかりが上に来る (新しさが eeat の低さを補ってしまう)。

対策: AdaMerging の cron では 1 回の更新で動かす lambda を最大 2 つに制限する。
新 version の delta-lambda L2 ノルムが 0.3 を超えるなら reject。

### 9.2 係数爆発

ridge regression の alpha が小さすぎると lambda が ±10 のような無意味値に発散する。

対策: lambda を ±3 にハードクリップし、その上で `is_active` 切替前に bench (§ 7.1)
で precision@10 が baseline -5% 以内であることを必須条件とする。

### 9.3 安全性 silent regress

クリックされやすい = ユーザーに歓迎されている、とは限らない。clickbait や hazard
コンテンツは CTR が高い傾向があるため、AdaMerging が clickbait を学習してしまう。

対策:
- `lambda_safety` / `lambda_clickbait` を学習対象から除外 (§ 5.3)
- engagement log に `report_count_delta` を join し、後追いで「クリックされたが
  通報も増えた post」は dwell から減点する
- 月次でモデレーション担当が bench クエリ群を手動レビュー

### 9.4 新 community cold-start

`community_task_weights` に行が無い community が大半になると、global lambda の
影響が支配的になり MergeRec の利点が消える。

対策:
- 同テーマの既存 community との **lambda 線形補間で warm-start** する
  (例: 新「料理初心者」コミュは「料理」「初心者質問」両 community の lambda の
  単純平均で seed)
- 親コミュ → 子コミュ階層が定義されていれば parent の lambda を継承
- ログが 100 件未満の community は global にフォールバック

### 9.5 query 分布シフト

夜間に bench を実行して lambda を更新するが、朝の query 分布 (ニュース系が多い) と
夜の query 分布 (相談系が多い) でズレが発生する。

対策: bench クエリを「時間帯別 cluster」で 4 つ用意 (朝 / 昼 / 夕 / 夜)、
時間帯別の sub-lambda を保持し、`search_posts_v4` 呼び出し時に `extract(hour from now())`
で切り替える。

### 9.6 personalization と diversification の競合

v3 では `viewed_boost = 1.2` と `diversify_results` が共存するが、
`lambda_view` を上げると同じ author の post が view 履歴経由で上がりやすくなり、
diversify との符号衝突が起こる。

対策: TIES の sign election (§ 6.2) を「同 author の連続率」と
「view 履歴一致率」の 2 軸でも適用し、片方を選ぶ。

---

## 10. 30 日アクションプラン

```
Week 1 — 基盤敷設
+--+ Day 1-2  : migration 0088_signal_weights を作成 (table + trigger + seed lambda=1.0)
+--+ Day 3-4  : search_posts_v4 RPC を log 線形で実装 (lambda は table から読む)
+--+ Day 5    : client 側の useSearchV2 を v4 に切替可能な feature flag を仕込む
+--+ Day 6-7  : bench クエリ 30 件を search_bench_queries に seed

Week 2 — 評価 / Negation
+--+ Day 8-9  : migration 0089_search_engagement_log + log_search_engagement RPC
+--+ Day 10   : Edge Function "search-bench" を毎日 02:00 JST で実行
+--+ Day 11-12: migration 0090_post_hazard_signals (safety / spam / clickbait)
+--+ Day 13   : v4 RPC に lambda_safety / lambda_spam を組み込み (固定値)
+--+ Day 14   : 検索 UI に「この結果について」(get_result_explanation 拡張) を反映

Week 3 — AdaMerging / Community
+--+ Day 15-16: Edge Function "adamerge-fit" を deno で実装 (ridge regression)
+--+ Day 17   : 毎日 03:00 JST cron 起動、新 version は is_active=false で insert
+--+ Day 18-19: user_weight_assignments + A/B 5% → 20% gate
+--+ Day 20-21: migration 0089b_community_task_weights + search_within_community_v4

Week 4 — TIES / 安定化 / ロールアウト
+--+ Day 22-23: TIES (trim + elect sign) を community-level lambda fit に追加
+--+ Day 24   : lock_signal_weights_immutable trigger を 0088 に back-port
+--+ Day 25-26: bench で precision@10 baseline 維持を確認
+--+ Day 27   : 50% rollout
+--+ Day 28-29: dwell / CTR モニタ、Sentry / PostHog 突合
+--+ Day 30   : 100% rollout または rollback 判断
```

### 10.1 migration 順序まとめ

| # | ファイル名 | 内容 |
|---|---|---|
| 0088 | `signal_weights.sql` | weight 表 + immutable trigger + seed |
| 0089 | `search_engagement_log.sql` | dwell / CTR ログ + log RPC |
| 0089b | `community_task_weights.sql` | community 別 lambda |
| 0090 | `post_hazard_signals.sql` | hazard 集約 view |
| 0091 | `search_posts_v4.sql` | log 線形合成 RPC |
| 0092 | `user_weight_assignments.sql` | A/B 割当 |
| 0093 | `search_bench_queries.sql` | bench 入力 |
| 0094 | `bench_results.sql` | bench 出力 |
| 0095 | `search_within_community_v4.sql` | community 切替 RPC |
| 0096 | `time_bucket_lambdas.sql` | 時間帯別 sub-lambda (§ 9.5) |
| 0097 | `search_engagement_views.sql` | 集計 view (CTR@K, Diversity@K) |

### 10.2 Edge Function

- `search-bench` (cron 02:00): bench を流して `bench_results` に書く
- `adamerge-fit` (cron 03:00): 直近 24h log から ridge fit → 新 version insert
- `community-weights-fit` (cron 03:30): community 別 fit
- `weight-gate` (手動 or 段階自動): A/B gate を 5/20/50/100% に進める / rollback する

### 10.3 Client 更新の段階

1. `lib/api/search.ts` に `useSearchV4` を追加、`useSearchV2` は維持
2. `app/(tabs)/search.tsx` で feature flag `search.engine = v2 | v3 | v4`
3. `components/search/WhyThisResult.tsx` を `get_result_explanation` の lambda 表示まで拡張
4. `app/settings/search-preferences.tsx` に「実験的 ranking を使う」toggle を追加
5. PostHog event: `search_engine_version`, `search_dwell_ms`, `search_clicked_rank`

### 10.4 完了条件

- A/B で CTR@10 が baseline +3% 以上、dwell が baseline +5% 以上
- safety report が baseline と同等以下
- p95 latency が 250ms 以下を維持
- bench precision@10 が baseline -2% 以内

これらを満たした時点で v4 を default ON、v2 / v3 は legacy fallback として残す。

---

## 付録 A: 数式まとめ (LaTeX 風)

### Task Arithmetic (古典版)
$$
\theta_{\mathrm{merged}} = \theta_{\mathrm{base}} + \sum_{i=1}^{T} \lambda_i \cdot (\theta_{\mathrm{task}_i} - \theta_{\mathrm{base}})
$$

### GEEK の log 線形対応
$$
\log s_{\mathrm{final}} = \sum_{j=1}^{J} \lambda_j \cdot \log(1 + x_j) - \sum_{k=1}^{K} |\lambda_k^{-}| \cdot h_k
$$
ここで $x_j$ は positive signal (text_relevance, recency_boost, ..., usability_score)、
$h_k$ は hazard signal (safety_penalty, spam_penalty, clickbait_penalty)。

### AdaMerging の SQL 近似 (ridge regression)
$$
\boldsymbol{\lambda}^{*} = \arg\min_{\boldsymbol{\lambda}} \sum_{i=1}^{N} \big( y_i - \boldsymbol{\lambda}^{\top} \mathbf{x}_i \big)^2 + \alpha \|\boldsymbol{\lambda}\|_2^2
$$
$y_i = \log(\text{dwell\_ms}_i + 1)$、$\mathbf{x}_i$ は signal ベクトル、
$\alpha$ は L2 正則化 (lambda 爆発の抑制 § 9.2)。

### TIES の trim + elect (signal 領域)
$$
\tilde{x}_j = \begin{cases} \mu_j & |x_j - \mu_j| < 0.5 \sigma_j \\ x_j & \text{otherwise} \end{cases},\quad
s^{*}_j = \mathrm{sign}\Big( \mathrm{majority\_vote}_i \, \mathrm{sign}(x_{ij} - \mu_j) \Big)
$$

---

## 付録 B: 既存 RPC / column / view との対応表

GEEK 実装で参照する SQL シンボルの正確な名前を一覧化する (本書内で利用する識別子は
すべてこの列の通り)。

| シンボル | 種別 | migration | 本書での使い所 |
|---|---|---|---|
| `posts.id` | column | 0001 | base key |
| `posts.title` | column | 0075 | text_relevance |
| `posts.content` | column | 0001 | text_relevance / link_health |
| `posts.author_id` | column | 0001 | eeat / diversify |
| `posts.created_at` | column | 0001 | recency / engagement_velocity |
| `posts.likes_count` | column | 0001 | eeat / velocity |
| `posts.concern_count` | column | 0006 | quality_penalty |
| `posts.media_urls` | column | 0001 | media_score |
| `posts.video_urls` | column | 0043 | media_score |
| `profiles.trust_score` | column | 0001 | eeat |
| `likes` | table | 0001 | velocity の count |
| `search_synonyms` | table | 0085 | text_relevance の展開 |
| `search_query_intents` | table | 0085 | intent 別 lambda の switch |
| `search_query_log` | table | 0085 | global 分析用 |
| `search_posts_v2(text,int,int)` | RPC | 0085 | base scorer |
| `get_trending_topics(int,int)` | RPC | 0085 | bench seed |
| `search_log_query(text)` | RPC | 0085 | log 入口 (将来は engagement_log へ統合) |
| `user_search_history` | table | 0086 | history_boost |
| `user_post_views` | table | 0086 | viewed_boost |
| `user_search_preferences` | table | 0086 | personalization 無効化 |
| `log_post_view(uuid)` | RPC | 0086 | view ログ入口 |
| `log_search_query(text,uuid)` | RPC | 0086 | クリック付き query ログ |
| `search_posts_v3(text,int,int)` | RPC | 0086 | personalized scorer |
| `get_result_explanation(uuid,text)` | RPC | 0086 | transparency (拡張対象) |
| `clear_search_history()` | RPC | 0086 | GDPR / 設定削除 |
| `post_quality_score` | view | 0087 | usability_score / 各 component |
| `get_post_quality(uuid)` | RPC | 0087 | usability transparency |
| `trending_in_window(int,int)` | RPC | 0087 | velocity bench |
| `v_search_signals` | view | 0087 | post + author_trust + usability の 1 行集約 |

本書で新規導入する SQL シンボル (0088 以降) は § 10.1 を参照。

---

## 付録 C: 参考: なぜ "乗算" を "log 線形 (加法)" に切り替えるか

現状の v3 は `final_score = text_rel * recency * eeat * quality * viewed * history` という
**乗算合成** である。これは「全 signal が良い post を上に出す」には有効だが、以下の弱点を持つ:

1. **片方が 0 だと全体が 0**: text_relevance がたまたま 0 だが過去に view している post は
   ゼロ点になり viewed_boost が無効化される
2. **lambda の感度が指数的**: 係数を 1.1 → 1.2 にしただけで合成スコアが大きく振れる
3. **回帰しづらい**: 線形回帰で lambda を学習しようとすると交差項が爆発する

log 線形に切り替えると:
- `log(final) = sum(lambda_i * log(1 + x_i))` で線形回帰が成立
- 各 signal の寄与が独立に解釈可能
- 0 を許容 (log(1+0) = 0 で消えるが他は生きる)

これがニューラルマージの「重みベクトル空間での線形合成」と最も近い構造になる。

---

## 付録 D: 1 ページサマリ

- GEEK の検索は既に `text_relevance / recency_boost / eeat_score / quality_penalty / viewed_boost / history_boost / usability_score` を合成しており、構造上モデルマージと同型
- 各 signal を **task vector**, 各係数を **lambda** と読み替える
- 0088 で `signal_weights` table を作り、`search_posts_v4` で log 線形マージに切替える
- AdaMerging は 24h cron + Edge Function の ridge regression で近似
- MergeRec は `community_task_weights` で community 別 lambda
- Task Negation は `lambda_safety / lambda_spam / lambda_clickbait` の負係数
- TIES は signal の trim + sign election で community-level fit に適用
- 評価は bench (precision/ndcg) + A/B (CTR/dwell) + safety report
- ロールバックは insert-only + is_active flag + 部分 unique index
- 落とし穴: 干渉, 係数爆発, safety regress, cold-start, 分布シフト, personalization-diversification 競合
- 30 日プラン: Week1 基盤 / Week2 評価 + Negation / Week3 AdaMerging + community / Week4 TIES + rollout
