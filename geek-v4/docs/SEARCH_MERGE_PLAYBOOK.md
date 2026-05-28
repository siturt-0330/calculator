# SEARCH_MERGE_PLAYBOOK.md — 検索 ranking マージ係数の運用 playbook

> 本書は `MODEL_MERGING_GEEK.md` (戦略書) を運用に落とした **作業手順書**。
> dev / admin が「マージ係数を変更してオンライン A/B にかけ、採用 or ロールバックする」
> までの 1 サイクルを step-by-step で示す。SQL は実在の 0085 〜 0097 の table / RPC を
> そのまま使うため、コピペで Supabase SQL Editor に貼って動かす想定。
>
> 強調しておく前提:
>
> 1. **安全性 (composite_safety_negation) は他の指標より優先する**。CTR が伸びても
>    safety が劣化する変更は不採用。
> 2. **A/B 期間は最低 1 週間**。短いと novelty effect で結論を間違える。
> 3. **1 PR = 1 signal 変更**。同時に複数 signal を動かすと効果切り分けが不可能になる。

---

## 0. 全体像 (1 サイクルのフロー)

```
 [0] チェックリスト確認
        │
        ▼
 [1] 新 profile を ranking_weight_profiles に作る (is_active=false)
        │
        ▼
 [2] admin_set_ranking_weight() で重みを設定
        │
        ▼
 [3] ab_group_profile_map に紐付け、user_ab_assignment で 10% に配布
        │
        ▼
 [4] オフライン eval (eval_search_bench) で nDCG / Recall 確認
        │
        ▼
 [5] オンライン A/B (1 週間以上) — get_search_quality_metrics で日次監視
        │
        ▼
 [6] 採用 (is_active=true 切替) or ロールバック (default に戻し)
```

---

## 1. チェックリスト: マージ係数を変更する前に

新 profile を切る前に「現状の地点」を必ず記録する。後でロールバック判定に使う。

```sql
-- a. いま active な profile は何か
select profile_name, description, is_active, created_at
  from public.ranking_weight_profiles
 where is_active = true;

-- b. 現在の A/B 分布 (treatment_a / treatment_b / control 等)
select ab_group, count(*) as n
  from public.user_ab_assignment
 group by ab_group
 order by n desc;

-- c. 直近 7 日の検索品質ベースライン (CTR / MRR / mean_pos)
select * from public.get_search_quality_metrics(null, 7);
-- → ab_group=null だと全 group 集計。group 別なら 'control' を渡す。

-- d. 安全性 baseline (composite_safety_negation の分布)
select day, ab_group, mean_safety_negation, mean_ctr, mean_mrr
  from public.search_quality_daily
 where day = current_date - 1;

-- e. (任意) オフライン bench
select * from public.eval_search_bench('default');
--   ※ 0098 で導入する想定。未導入なら手動で代表クエリ 30 件を流して
--      mean_ndcg / mean_recall を Notion に貼る。
```

記録ポイント:

- baseline_ctr / baseline_mrr
- baseline_safety_negation (これを **下回らない** ことが採用条件)
- baseline_ndcg@10

---

## 2. 手順 1: 新しい profile を作る

`ranking_weight_profiles` は 0088 で導入された profile マスタ。**最初は必ず `is_active=false`**
で作り、A/B で勝った後に切り替える。

```sql
insert into public.ranking_weight_profiles (profile_name, description, is_active)
values (
  'exp_2026_07',
  'freshness 強化テスト: recency lambda を 1.0 → 1.2、freshness を新規追加',
  false
);
```

命名規約: `exp_YYYY_MM` を基本に、目的が違う実験は `exp_2026_07_safety` のように suffix。

---

## 3. 手順 2: 重みを設定する

0088 の `admin_set_ranking_weight(profile_name, signal_key, lambda, threshold)` を使う。
threshold は TIES の sparsification 閾値 (これ未満の signal を 0 に落とす)。

```sql
-- 強化したい signal だけ override
select public.admin_set_ranking_weight('exp_2026_07', 'recency',    1.2, 0.00);
select public.admin_set_ranking_weight('exp_2026_07', 'freshness',  0.50, 0.05);
-- 安全側に振りたいなら negation も明示
select public.admin_set_ranking_weight('exp_2026_07', 'safety_negation', -0.60, 0.00);

-- 触っていない signal は default profile からそのまま継承される
-- (get_active_ranking_weights() が profile マージを行うため)
```

注意:

- **同時に複数 signal を変えない**。1 PR = 1 signal。
- `threshold` を上げ過ぎると signal が全 post で 0 落ちし、`final_score=0` で全件同点になる
  事故が起きる (§ 12 落とし穴 参照)。

設定後の確認:

```sql
select signal_key, lambda, threshold
  from public.ranking_weights rw
  join public.ranking_weight_profiles rwp on rwp.id = rw.profile_id
 where rwp.profile_name = 'exp_2026_07'
 order by signal_key;
```

---

## 4. 手順 3: A/B group を割り当てる

profile を A/B group に紐付け、対象ユーザーを `user_ab_assignment` に書く。10% から
始めるのが安全。

```sql
-- a. profile を treatment_a にバインド
insert into public.ab_group_profile_map (ab_group, profile_id)
select 'treatment_a', id
  from public.ranking_weight_profiles
 where profile_name = 'exp_2026_07'
on conflict (ab_group) do update
   set profile_id = excluded.profile_id;

-- b. ユーザーの 10% を treatment_a に (auth.users.id の hash で安定 sampling)
update public.user_ab_assignment
   set ab_group = 'treatment_a'
 where user_id in (
   select user_id from public.user_ab_assignment
    where ab_group = 'control'
      and ('x' || substr(md5(user_id::text), 1, 8))::bit(32)::int % 10 = 0
   limit 5000
 );
```

確認:

```sql
select ab_group, count(*) from public.user_ab_assignment group by ab_group;
```

---

## 5. 手順 4: オフライン eval を回す

オンラインに出す前に、代表クエリで nDCG / Recall を確認する。劣化していたら
ここで止める (オンライン A/B に出さない)。

```sql
select * from public.eval_search_bench('exp_2026_07');
-- → mean_ndcg, mean_recall, by_intent (broad/specific/recent/community)
--   を default と並べて比較。
```

判断基準 (オフライン段階):

- `mean_ndcg` が default の **-3% 以内**
- `mean_recall@10` が default の **-3% 以内**
- どの intent でも特定セグメントだけ大幅劣化していない (by_intent を必ず見る)

NG なら手順 2 に戻って lambda 調整。OK ならオンラインへ。

---

## 6. 手順 5: オンライン A/B 設計

### 6.1 期間とサンプルサイズ

| 指標 | 目安 |
|---|---|
| 最低期間 | **7 日** (novelty effect 排除のため) |
| 各 group サンプル | **1,000 active users 以上** |
| 検定 | CTR / MRR は z-test、safety は片側 (悪化のみ警戒) |

期間中はユーザーを動かさない (sample を増減しない)。

### 6.2 監視メトリクス

```sql
-- treatment_a の直近 7 日
select * from public.get_search_quality_metrics('treatment_a', 7);
-- control の直近 7 日 (比較用)
select * from public.get_search_quality_metrics('control', 7);
```

返ってくる主要指標:

| 指標 | 意味 | 採用条件 |
|---|---|---|
| `mean_ctr` | クリック率 | ≥ control - 2% |
| `mean_mrr` | 最初の click 順位の逆数平均 | ≥ control - 3% |
| `mean_dwell_ms` | クリック後の滞在 | ≥ control - 5% |
| `like_rate` | 結果から like に至る率 | ≥ control - 5% |
| `concern_rate` | 結果から concern に至る率 | ≤ control + 10% |
| `mean_safety_negation` | 表示された post の平均 safety penalty | **≤ control (絶対条件)** |
| `safety_violation_rate` | 手動 flag された post を表示した率 | **≤ control (絶対条件)** |

### 6.3 日次 dashboard

`search_quality_daily` view を毎朝確認 (`day` × `ab_group` で集計済):

```sql
select day, ab_group, mean_ctr, mean_mrr, mean_safety_negation, n_searches
  from public.search_quality_daily
 where day >= current_date - 7
   and ab_group in ('control', 'treatment_a')
 order by day desc, ab_group;
```

3 日連続で safety が悪化したら **即座に手順 10 のロールバック** を発動する。

---

## 7. 手順 6: 採用 or ロールバック

### 7.1 採用条件 (すべて満たす)

- `mean_safety_negation` ≤ baseline (= control)
- `safety_violation_rate` ≤ baseline
- `mean_ctr` ≥ baseline - 2%
- `mean_mrr` ≥ baseline - 3%
- オフライン `mean_ndcg` ≥ baseline - 3%
- A/B 期間 ≥ 7 日

### 7.2 採用 (active 切替)

```sql
-- 既存 default を非 active に、exp_2026_07 を active に
update public.ranking_weight_profiles set is_active = false
 where is_active = true;

update public.ranking_weight_profiles set is_active = true
 where profile_name = 'exp_2026_07';

-- ranking_weight_profiles_enforce_single_active() trigger により
-- 「同時に 2 profile が active」は起きない仕組み。
```

### 7.3 ロールバック (= 不採用)

```sql
update public.ranking_weight_profiles set is_active = true
 where profile_name = 'default';

-- treatment_a を空にしてユーザーを control に戻す
update public.user_ab_assignment
   set ab_group = 'control'
 where ab_group = 'treatment_a';
```

切替後、`get_search_v4_health()` で healthcheck 通過を確認:

```sql
select * from public.get_search_v4_health();
```

---

## 8. コミュニティ別 boost (MergeRec 風)

公式コミュ全体に共通の重みではなく、**過疎コミュには recency / viewed_boost を盛る**
ことで底上げできる (MODEL_MERGING_GEEK § 4 の MergeRec 近似)。

### 8.1 対象抽出

0089 の `low_traffic_communities` view が「過去 7 日の投稿 < 10 件」のコミュを返す。

```sql
select id, name, post_count_7d, last_post_at
  from public.low_traffic_communities
 order by post_count_7d asc
 limit 20;
```

### 8.2 一括 boost (推奨)

```sql
select public.auto_boost_low_traffic_communities();
-- → low_traffic_communities の各 community に対し
--    community_weight_overrides に recency +0.3 / viewed_boost +0.3 を upsert。
```

### 8.3 手動で個別調整

特定コミュだけ調整したいときは upsert で直接書く:

```sql
insert into public.community_weight_overrides
  (community_id, signal_key, lambda_delta)
values
  ('<community_uuid>', 'recency',     0.5),
  ('<community_uuid>', 'viewed_boost', 0.3)
on conflict (community_id, signal_key) do update
   set lambda_delta = excluded.lambda_delta;
```

確認:

```sql
select * from public.get_community_ranking_weights('<community_uuid>');
```

---

## 9. 時事ネタ keyword 追加 (intent='recent' boost)

0094 の `recent_event_keywords` に登録すると、`classify_query_intent()` が `recent`
判定したクエリに対し追加 boost が乗る。**有効期限 (`expires_at`) を必ず入れる**
(放置すると古いブーストが残る)。

```sql
insert into public.recent_event_keywords (keyword, boost, expires_at)
values
  ('ワールドカップ', 2.0, now() + interval '14 days'),
  ('紅白歌合戦',     1.8, now() + interval '7 days');
```

判定確認:

```sql
select public.is_recent_event_query('ワールドカップ 速報');
-- → true
select * from public.get_weights_for_query('ワールドカップ 速報');
-- → intent='recent' + recency lambda が増幅されている
```

期限切れの clean-up (週次 cron で):

```sql
delete from public.recent_event_keywords where expires_at < now();
```

---

## 10. 危険信号: 安全性が劣化したら (即時対応)

`composite_safety_negation` (0090) が **直近 7 日で 20% 以上悪化** したら、それは
「実験 profile が safety を犠牲に CTR を盛っている」サイン。即座に対応する。

### 10.1 検知クエリ

```sql
with cur as (
  select avg(mean_safety_negation) as v
    from public.search_quality_daily
   where day between current_date - 7 and current_date - 1
     and ab_group = 'treatment_a'
), base as (
  select avg(mean_safety_negation) as v
    from public.search_quality_daily
   where day between current_date - 14 and current_date - 8
     and ab_group = 'control'
)
select cur.v as current_v, base.v as baseline_v,
       (cur.v - base.v) / base.v as pct_change
  from cur, base;
-- pct_change > 0.20 なら ALERT
```

### 10.2 即時対応

```sql
-- 1. safety_negation の lambda を強化 (-0.5 → -0.8)
select public.admin_set_ranking_weight('exp_2026_07', 'safety_negation', -0.80, 0.00);

-- 2. それでも 24h で改善しなければ default 強制戻し
update public.ranking_weight_profiles set is_active = true where profile_name = 'default';
update public.ranking_weight_profiles set is_active = false where profile_name = 'exp_2026_07';
```

ロールバック後は `search_quality_daily` で safety が baseline に戻るのを 3 日確認する。

---

## 11. 新 signal を追加するとき

0098 以降の migration で signal を追加する場合の標準フロー:

1. **migration を書く** (`0098_xxx.sql`):
   - 元データの view または materialized view を作る (例: `post_freshness_score` 0091 を踏襲)
   - 必要なら refresh RPC (`refresh_post_xxx()`)
2. **default profile に signal_key 行を insert**:
   ```sql
   select public.admin_set_ranking_weight('default', 'xxx', 0.10, 0.00);
   -- lambda は控えめ 0.1 から始める
   ```
3. **`search_posts_v4` の SELECT に signal を join**:
   - 0097 の SELECT 句に column を 1 行追加し、`compute_merged_score()` に渡す
4. **1 週間モニター**:
   - `search_quality_daily` で全体 CTR / safety を確認
   - signal の分布 (`select avg(xxx), stddev(xxx) from post_xxx_score`)
5. **effect 検証後、lambda 調整**:
   - もし CTR / nDCG に貢献なければ lambda=0 (= 実質無効化) で放置
   - 貢献あれば手順 1〜7 の A/B プロセスで段階的に上げる

---

## 12. 落とし穴 (再発防止)

| ハマり方 | 真因 | 防止策 |
|---|---|---|
| 効果が切り分けられない | 同時に 3 signal の lambda を動かした | **1 PR 1 signal**。複数動かすときは段階リリース |
| `final_score=0` で全件同点 → ランダム順 | threshold を上げ過ぎて全 signal が sparsify で 0 落ち | threshold は 0.05 上限、変更時は `apply_sparsification` の出力分布を必ず確認 |
| safety が静かに悪化 | safety_negation を「邪魔だから」と弱めた | safety 系の lambda 変更は **必ず regression test** (10 章のクエリ) を回す |
| 1 日の数字で勝った気になる | novelty effect (新しい結果が珍しくて click される) | **A/B 期間 7 日固定**。3 日 4 日では絶対に判定しない |
| profile を 2 つ active にしてしまう | 手で `is_active=true` を二重 update | `ranking_weight_profiles_enforce_single_active()` trigger に任せる。手動で `where is_active=true` を緩めない |
| community override が累積して訳分からん | 半年前に入れた `auto_boost_low_traffic_communities()` が残存 | 月次で `select count(*) from community_weight_overrides` を確認、3 ヶ月以上古い行は棚卸し |
| recent_event_keywords が古いまま残る | `expires_at` を null で入れた | insert 時に **必ず `expires_at` を `now() + interval` で指定** |
| Sentry にクエリ文字列が漏れる | `search_engagement_log` を Sentry breadcrumb に流した | 検索 log は SQL 側に留め、フロントから Sentry には渡さない |

---

## 13. ロールバック早見表

実運用で「これが起きたら何をするか」を 1 表に。

| 症状 | 即時対処 | 確認 RPC |
|---|---|---|
| **safety regression** (mean_safety_negation 悪化) | `safety_negation` lambda を -0.5 → -0.8 に強化 | `get_search_quality_metrics('treatment_a', 7)` |
| **CTR が baseline -3% 以上落ちた** | 全体 lambda balance を default に戻す (= profile を default に切替) | `search_quality_daily` の `mean_ctr` |
| **特定 community の品質低下** | `community_weight_overrides` で当該 community のみ調整。全体は触らない | `get_community_ranking_weights(<id>)` |
| **検索が全部白画面** | 0088 の active profile を default に強制戻し ( 7.3 手順) | `get_search_v4_health()` |
| **オフライン nDCG が落ちた** | オンラインに出す前にここで止める。lambda 調整に戻る | `eval_search_bench('exp_xxx')` |
| **過疎コミュが上位に出てこない** | `auto_boost_low_traffic_communities()` を 1 回呼ぶ | `low_traffic_communities` view |
| **時事ネタが拾えない** | `recent_event_keywords` に keyword を expires_at 付きで insert | `is_recent_event_query('keyword')` |

---

## 14. 監査ログとレビュー

profile を変えたら必ず:

- PR description に「変更した signal_key / lambda / threshold」と「baseline vs 結果」を貼る
- `ranking_weight_profiles.description` カラムに「why 変えたか」を必ず書く
- 月次レビューで active profile / community_weight_overrides / recent_event_keywords を
  まとめて棚卸し (古いものは削除)

検索 ranking は「気づいたら悪くなっている」典型領域なので、**変更履歴を SQL に残す**
ことが事故防止の最大の武器になる。
