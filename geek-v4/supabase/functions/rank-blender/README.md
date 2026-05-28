# rank-blender

Supabase Edge Function。検索 ranking の「タスク係数 lambda」を A/B group ごとに切り替えて、
クライアントから渡された (query, post_ids, signals) を blended score にして返す。

設計の背景は `supabase/migrations/0088_multi_task_ranking_weights.sql` の冒頭コメント参照。

## 役割

- profile (= signal_key -> lambda / threshold の組) を `ranking_weight_profiles` /
  `ranking_weights` から動的に読み込む
- A/B group の写像 (`ab_group_profile_map`) と user 割当 (`user_ab_assignment`) を
  尊重して、caller の所属群に対応する profile を当てる
- 各 post について `signal x lambda` を加算
- `|signal| < threshold` の signal は drop (TIES sparsification 相当)
- `final_score` の降順に並べた結果と、signal 別の寄与点 (`contributions`) を返す

SQL で同じことをやろうとすると profile の差分が migration ベースになって運用が硬いので、
weight 計算層を Edge に切り出した。

## 入力

`POST /functions/v1/rank-blender`

```jsonc
{
  "query": "kotlin coroutines",
  "post_ids": [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
  ],
  "ab_group": "control",            // 任意。省略時は user_ab_assignment 参照
  "signals": {
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": {
      "text_relevance": 0.82,
      "recency":        0.74,
      "eeat":           0.61,
      "usability":      0.50,
      "viewed_boost":   0.10,
      "history_boost":  0.05,
      "safety_negation":   0.0,
      "clickbait_negation": 0.0,
      "freshness":      0.32,
      "diversity_penalty": 0.0
    },
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb": {
      "text_relevance": 0.51,
      "recency":        0.92,
      "eeat":           0.55,
      "usability":      0.40
    }
  }
}
```

### バリデーション

| フィールド | 必須 | 形式 | 上限 |
|---|---|---|---|
| `query` | yes | string | 1,000 文字 |
| `post_ids` | yes | string[] (UUID v4) | 500 件 |
| `ab_group` | no | string | 64 文字 |
| `signals` | yes | `Record<post_id, Record<signal_key, number>>` | 数値は有限 (Inf / NaN 不可) |

入力不正は `400` を返す。

## 出力

```jsonc
{
  "results": [
    {
      "post_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "final_score": 2.273,
      "contributions": {
        "text_relevance": 0.82,
        "recency":        0.74,
        "eeat":           0.61,
        "usability":      0.15,
        "viewed_boost":   0.02,
        "history_boost":  0.005,
        "freshness":      0.064
      }
    },
    {
      "post_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "final_score": 1.860,
      "contributions": {
        "text_relevance": 0.51,
        "recency":        0.92,
        "eeat":           0.55,
        "usability":      0.12
      }
    }
  ],
  "ab_group": "control",
  "profile_name": "default"
}
```

`final_score` 降順、同点は `post_id` 昇順 (安定 sort 用)。

## 処理フロー

1. `Authorization` ヘッダから `auth.uid()` を取得 (未認証は anon OK)。
2. weight の解決:
   - 入力に `ab_group` がある -> `ab_group_profile_map` から profile を引く
   - 無い -> auth-forwarding client で `get_active_ranking_weights()` を呼ぶ
     (0088 の RPC が `user_ab_assignment` -> `ab_group_profile_map` -> active profile の
     順に解決)
   - どちらでも見つからない -> `profile_name='default'` を直接ロード
3. 各 post について `signal * lambda` を合算。`|signal| < threshold` は drop。
4. `final_score` 降順に sort して返す。

## deploy

```bash
# 初回のみ Supabase CLI で login & link
supabase login
supabase link --project-ref <YOUR_REF>

# 必要な secret はすでに存在する想定 (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は
# Supabase が自動 inject するので設定不要)
supabase functions deploy rank-blender
```

CORS allowlist は `_shared/cors.ts` を共有。preview ドメインを足すときはそちらを更新する。

## curl で試験

ローカル `supabase functions serve` で:

```bash
# 起動
supabase functions serve rank-blender --no-verify-jwt --env-file ./supabase/.env.local

# 別 shell で叩く (anon でも動く)
curl -sS -X POST http://localhost:54321/functions/v1/rank-blender \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d '{
    "query": "kotlin coroutines",
    "post_ids": [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    ],
    "ab_group": "control",
    "signals": {
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": {
        "text_relevance": 0.82,
        "recency":        0.74,
        "eeat":           0.61,
        "usability":      0.50,
        "freshness":      0.32
      },
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb": {
        "text_relevance": 0.51,
        "recency":        0.92,
        "eeat":           0.55,
        "usability":      0.40
      }
    }
  }' | jq .
```

production (deploy 後) は URL を以下に差し替え:

```bash
curl -sS -X POST "https://<PROJECT_REF>.functions.supabase.co/rank-blender" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_JWT" \
  -d @payload.json | jq .
```

## エラーレスポンス

| status | 状況 |
|---|---|
| 400 | JSON parse 失敗 / `query` / `post_ids` / `signals` の validate 失敗 |
| 401 | (現状未使用 — auth.uid() 不要) |
| 405 | POST 以外 |
| 500 | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 未設定、active profile が無い、blending で想定外エラー |

サーバ内部の詳細は本番ログにのみ吐き、レスポンスには出さない。

## 既知の制約 / 今後

- rate limit は client 側 (`lib/rateLimit.ts`) に任せている。本 fn は idempotent な
  純計算なので、cache 層を前に挟む方が現実的。
- `query` は現状 ranking には使っていない (signals を投げる呼び側で text_relevance に
  すでに反映されている想定)。将来 ab_group 別の boost / 入力ログを足すならここに混ぜる。
- `diversity_penalty` 等の cross-post signal はこの関数ではなく、別段の rerank で
  入力 `signals` 側に既に反映されている前提。
