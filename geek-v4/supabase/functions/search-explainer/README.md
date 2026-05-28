# search-explainer

検索結果カードの「**この結果について**」モーダルで使う transparency endpoint。
0086 の `get_result_explanation` と 0094 の `classify_query_intent` /
`get_weights_for_query`、0090 の `get_post_safety`、(任意で) 0097 の
`explain_search_v4` を 1 リクエストにまとめて集計し、UI が animated bar chart
にしやすい flat な factor 配列を返す。

> **UX 原則**: 「なぜこの結果が出たか」を 1 タップで開示する。Google の
> "About this result" / "なぜこの広告が表示されたか" と同じ思想。

---

## Deploy

```bash
# 一度だけ
supabase functions deploy search-explainer

# secrets はリポ全体で共通の SUPABASE_SERVICE_ROLE_KEY を継承するので追加 set 不要
```

production の confirm:

```bash
curl -X POST 'https://<project>.functions.supabase.co/search-explainer' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <user_jwt>' \
  -d '{"post_id":"00000000-0000-0000-0000-000000000000","query":"ラーメン"}'
```

> CORS allowlist は `_shared/cors.ts` に集中管理。preview ドメインを増やす
> ときはそちらを更新するだけで OK。

---

## 入力 (POST body)

| field | type | 必須 | 説明 |
|---|---|---|---|
| `post_id` | `string` (UUID) | ✅ | 説明したい post の id |
| `query` | `string` (1..200) | ✅ | ユーザーが投げた検索クエリ |
| `include_advanced` | `boolean` | — | `true` なら 0097 `explain_search_v4` の `contributions jsonb` も `advanced` field に同梱 |

```ts
type Req = {
  post_id: string;
  query: string;
  include_advanced?: boolean;
};
```

### 入力バリデーション

- `post_id` が UUID v4 形式でない → 200 + `{ factors:[], error:'bad-input' }`
- `query` が空 / 200 chars 超 → 同上
- JSON parse 失敗 → 200 + `{ factors:[], error:'bad-json' }`

> **失敗時も常に 200** を返す。UI を 4xx で壊さないため。`error` field の
> 有無で client は degrade 表示する。

---

## 出力 (200 OK 固定)

```ts
type Factor = {
  key: string;          // 'text_relevance' | 'recency' | 'eeat' | 'history'
                        // | 'views' | 'diversity' | 'safety_negation'
                        // | 'freshness' | 'usability' | 'clickbait_negation' | ...
  weight: number;       // 0..1 (UI bar の長さ)
  contribution: number; // signed (negation で負もありうる) — 並べると total に
  description: string;  // 日本語の説明文 (RPC から、無ければ fallback)
  category: 'positive' | 'negative' | 'neutral';
};

type Resp = {
  factors: Factor[];
  total_score: number;       // contribution の合計 (UI で総評バーに使う)
  query_intent: string;      // 'recipe' | 'qa' | 'news' | 'general' 等
  is_personalized: boolean;  // user_search_preferences.personalization_enabled
  advanced?: unknown;        // include_advanced=true のとき 0097 出力
  error?: string;            // 失敗時のみ。factors は空配列
};
```

### サンプル出力

```json
{
  "factors": [
    {
      "key": "text_relevance",
      "weight": 0.85,
      "contribution": 1.275,
      "description": "クエリの語が投稿のタイトル / 本文と一致しています",
      "category": "positive"
    },
    {
      "key": "recency",
      "weight": 0.9,
      "contribution": 0.9,
      "description": "直近 24 時間以内に投稿された新しい内容です",
      "category": "positive"
    },
    {
      "key": "eeat",
      "weight": 0.6,
      "contribution": 0.6,
      "description": "投稿者の信用スコアと評価 (いいね数) を元にした品質指標です",
      "category": "positive"
    },
    {
      "key": "history",
      "weight": 0.1,
      "contribution": 0.01,
      "description": "あなたが過去に似た検索をした経緯があるため、関連する結果を少し優先しています",
      "category": "positive"
    },
    {
      "key": "views",
      "weight": 0,
      "contribution": 0,
      "description": "あなたはまだこの投稿を閲覧していません",
      "category": "neutral"
    },
    {
      "key": "diversity",
      "weight": 0.05,
      "contribution": -0.02,
      "description": "特定の投稿者ばかりが上位に並ばないよう、結果を多様化しています",
      "category": "negative"
    },
    {
      "key": "safety_negation",
      "weight": 0.15,
      "contribution": -0.075,
      "description": "安全性シグナル (クリックベイト傾向) により減点されています",
      "category": "negative"
    }
  ],
  "total_score": 2.69,
  "query_intent": "recipe",
  "is_personalized": true
}
```

### `include_advanced: true` のとき

```json
{
  "factors": [ /* ... */ ],
  "total_score": 2.69,
  "query_intent": "recipe",
  "is_personalized": true,
  "advanced": {
    "post_id": "...",
    "contributions": {
      "text_relevance": 1.275,
      "recency": 0.9,
      "eeat": 0.6,
      "safety_negation": -0.075,
      "freshness": 0.18
    },
    "merged_score": 2.88
  }
}
```

> 0097 (`explain_search_v4`) は将来追加の migration を想定。未デプロイ環境では
> `advanced` field 自体が含まれない (= silent skip)。

---

## factor 集計フォーマット

1. **0086 `get_result_explanation(post_id, query)`** が 6 行の base factor
   (`text_relevance`, `recency`, `eeat`, `history`, `views`, `diversity`)
   を返す。それぞれの `weight` (0..1) を取る。
2. **0094 `get_weights_for_query(query)`** で `(signal_key, effective_lambda)`
   を取得。クエリ intent と AdaMerging profile が反映された "効いている lambda"。
3. `contribution = weight × effective_lambda`。
   `safety_negation` / `clickbait_negation` / `diversity_penalty` の 3 つは
   **常に符号を負に強制** する (UI で「減点理由」を明確に見せるため)。
4. **0090 `get_post_safety(post_id)`** で `composite_safety_negation` (0..1)
   を取得し、`safety_negation` を独立 factor として追加。
   composite > 0 のときだけ表示。description は内訳 (clickbait / spam / low_signal / concern)
   を文字列で組み立てる。
5. weights に lambda が乗っている `freshness` / `usability` /
   `clickbait_negation` が explanation に出てこなかった場合は、
   **neutral 提示** (weight=0, contribution=0) として並べる。UI 側で
   グレーアウトして「この投稿では効いていない related signal」を可視化できる。
6. `query_intent` は 0094 `classify_query_intent` の top 1 (confidence 降順)。
7. `is_personalized` は user の `user_search_preferences.personalization_enabled`
   (行が無い user は default `true`、未ログインは `false`)。

| signal_key | category | typical sign | 説明 |
|---|---|---|---|
| `text_relevance` | positive | + | 本文 / タイトルとクエリの一致度 |
| `recency` | positive | + | 投稿の新しさ |
| `eeat` | positive | + | 投稿者の trust + likes ベース品質 |
| `usability` | positive | + | Page Experience (画像 / リンク / 長さ) |
| `freshness` | positive | + | 24h engagement velocity |
| `viewed_boost` | positive | + | 既読 post への小ブースト |
| `history_boost` | positive | + | 過去検索類似ヒットへの小ブースト |
| `history` | positive | + | 同上 (explanation 提示用) |
| `views` | positive | + | 同上 (explanation 提示用) |
| `diversity` | negative | - | 同一 author 連続抑制 |
| `safety_negation` | negative | - | clickbait / spam / low_signal / concern |
| `clickbait_negation` | negative | - | タイトル煽り傾向 |
| `diversity_penalty` | negative | - | 多様化ペナルティ (raw signal) |

---

## 失敗時の degrade 動作

すべて **200 OK + body 内 `error` field** で表現する (4xx/5xx は返さない)。

| 状況 | response |
|---|---|
| `post_id` が UUID でない / `query` が空 | `{ factors:[], total_score:0, query_intent:'general', is_personalized:false, error:'bad-input' }` |
| JSON parse 失敗 | `{ ..., error:'bad-json' }` |
| OPTIONS / POST 以外 | `{ ..., error:'method-not-allowed' }` |
| `SUPABASE_URL` / service key が env に無い | `{ ..., error:'server-misconfigured' }` |
| RPC が 1 つ失敗 (例: 0094 未デプロイ) | 他の RPC 結果だけで `factors` を構築。`weights` 空なら lambda=1.0 で fallback。`intent='general'`。`error` は付けない (部分成功扱い) |
| `get_result_explanation` も `get_post_safety` も両方空 | `{ factors:[], ..., error:'no-explanation' }` (post が存在しないか query が無効) |
| 内部例外 (Promise.all rejection 等) | `{ factors:[], ..., error:'internal' }` |
| 0097 `explain_search_v4` が未定義環境 | `advanced` field を含めず silent skip |

> client 側 (`app/post/[id].tsx` の Explainer モーダル) は `factors.length === 0`
> なら「分析中…」表示 → 1 秒後に「説明できる情報がありません」表示に切替えればよい。

---

## なぜ 200 固定なのか

検索結果カードの「**この結果について**」をタップしただけで赤いエラーが出ると、
通常の検索 UX を壊す (= ユーザーの信頼を最も損なう局面)。仮にバックエンドが
落ちていても、UI は「説明できる情報がありません」とだけ言って閉じればよい。

Edge Function ログは Sentry → Supabase Functions ログで観測する前提
(client 側に詳細を返さない fail-secure)。

---

## client 連携 (geek-v4/app 側)

```ts
// 例: app/post/[id].tsx の「この結果について」ボタン
const fetchExplanation = async () => {
  const { data } = await supabase.functions.invoke('search-explainer', {
    body: { post_id: postId, query: lastQuery },
  });
  // data.factors を Reanimated で animated bar chart に流す
};
```

> Reanimated 3 の `withSpring` で `weight` を 0 → 実値へアニメ。
> `contribution` の符号で色 (positive=accent / negative=warn / neutral=muted)
> を切り替える。

---

## 関連 migration

- 0086 — `get_result_explanation`, `user_search_preferences`
- 0088 — `ranking_weights`, `get_active_ranking_weights`
- 0090 — `get_post_safety`, `composite_safety_negation`
- 0094 — `classify_query_intent`, `get_weights_for_query`
- 0097 (planned) — `explain_search_v4` (optional, include_advanced で使う)
