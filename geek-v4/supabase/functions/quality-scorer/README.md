# quality-scorer

投稿 (`posts` / 掲示板スレ) の品質と安全性をヒューリスティックに評価する Supabase Edge Function。

SQL view (`0087_page_experience.sql` の `post_quality_score`, `0090` 系の `post_safety_score`) を補完する、より細粒度のリアルタイム採点を提供する。

## 用途

- 投稿フォーム送信時に呼んで、低スコア投稿に「投稿前ヒント」を出す
- バッチで `posts` を再採点し、ランキングの dampening 用シグナルに使う
- automod 連携の追加シグナル

## 特徴

- **Pure compute**: DB / 外部 API を一切叩かない。`SUPABASE_SERVICE_ROLE_KEY` 不要。
- **同期完結**: 入力 → 評価 → JSON 返却まで数 ms。
- **TypeScript strict / `any` 禁止**。
- CORS は `_shared/cors.ts` の allowlist 方式。

## 入出力仕様

### Request

`POST /functions/v1/quality-scorer`

```json
{
  "post_id": "uuid (optional)",
  "title": "string (optional, <= 300 chars)",
  "content": "string (required, <= 20000 chars)",
  "media_count": 0,
  "video_count": 0
}
```

| field         | 型      | 必須 | 備考                                  |
| ------------- | ------- | ---- | ------------------------------------- |
| `post_id`     | string  |      | trace 用。何にも使わない              |
| `title`       | string  |      | clickbait 検出で title を 2 倍重み付け |
| `content`     | string  | ✅   | 本文 (空文字も可)                     |
| `media_count` | number  |      | 画像枚数 (0..100)                     |
| `video_count` | number  |      | 動画本数 (0..100、image 2 件分相当)   |

`Content-Type: application/json` 必須。

### Response (200)

```json
{
  "scores": {
    "length_appropriate":   0.0,
    "readability":          0.0,
    "media_richness":       0.0,
    "link_health":          0.0,
    "clickbait_likelihood": 0.0,
    "spam_likelihood":      0.0,
    "composite_quality":    0.0
  },
  "reasons": [
    "本文の長さは適切です",
    "扇情的なキーワードを検出 (衝撃、神)"
  ]
}
```

すべてのスコアは `[0, 1]` の `number`。

| metric                  | 高いと…                          |
| ----------------------- | -------------------------------- |
| `length_appropriate`    | 本文長が読み物として適切         |
| `readability`           | 文のリズム / 句読点バランス良好  |
| `media_richness`        | 画像 / 動画が豊富                |
| `link_health`           | リンクが少なめで信頼性高い       |
| `clickbait_likelihood`  | 釣りタイトル / 扇情的 (悪い方向) |
| `spam_likelihood`       | スパム疑い (悪い方向)            |
| `composite_quality`     | 加重総合スコア                   |

`composite_quality` の計算:

```
length * 0.20 + readability * 0.20 + media * 0.20 + link_health * 0.20
  + (1 - clickbait) * 0.10 + (1 - spam) * 0.10
```

### Error responses

| status | body                                  | 条件                              |
| ------ | ------------------------------------- | --------------------------------- |
| 400    | `{ "error": "bad-request" }`          | JSON parse 失敗 / `content` 欠落  |
| 405    | `{ "error": "method-not-allowed" }`   | POST / OPTIONS 以外の method      |
| 500    | `{ "error": "internal" }`             | 想定外例外 (基本ここに来ない)     |

## ヒューリスティック内訳

1. **length_appropriate**
   実文字数を 4 段階で評価 (短すぎ / 短い / sweet zone 120〜1500 / 長すぎ / 超過)。
2. **readability**
   文末記号で分割した文ごとの長さの標準偏差 (rhythm) + 全文の句読点比率 + 200 字超の超長文ペナルティ。
3. **media_richness**
   `media_count + video_count * 2` を `log2(1 + x) / log2(9)` で `[0, 1]` に正規化。
4. **link_health**
   URL を抽出してホスト判定:
   - ホワイトリスト (`github.com`, `wikipedia.org`, `youtube.com` 等) は微加点
   - 短縮 URL (`bit.ly`, `t.co`, `tinyurl.com` 等 11 ドメイン) は減点
   - 怪しい TLD (`.tk`, `.top`, `.click`, `.xyz` 等) は強めに減点
   - URL が 5 件超で追加減点
5. **clickbait_likelihood**
   日本語 + 英語の扇情 keyword 約 30 語を検出。`!!!` `???` 連発、ALL CAPS 単語、短い扇情 title も加点。
6. **spam_likelihood**
   スパム keyword、短縮 URL 1 件 = +0.3、URL 6 件超、メンション 5 件超、ハッシュタグ 10 件超、同一文字 10 連続を検出。
7. **composite_quality**
   上記 6 メトリクスを加重平均 (clickbait / spam は反転)。

`reasons` 配列には日本語の説明が入る (UI ヒントにそのまま出せる前提)。

## ローカルテスト

```bash
# Supabase CLI で関数を起動
supabase functions serve quality-scorer --no-verify-jwt

# 別ターミナルから curl
curl -s -X POST http://localhost:54321/functions/v1/quality-scorer \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "今日学んだこと",
    "content": "TypeScript の satisfies 演算子について調べました。\n型を狭めずに型適合だけチェックできるのが便利でした。\n詳しくは https://github.com/microsoft/TypeScript の docs を参照。",
    "media_count": 1,
    "video_count": 0
  }' | jq
```

clickbait 例:

```bash
curl -s -X POST http://localhost:54321/functions/v1/quality-scorer \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "衝撃!!! 神アプリ降臨",
    "content": "マジでヤバい!!! 絶対試して!!! https://bit.ly/abc https://t.co/xyz",
    "media_count": 0,
    "video_count": 0
  }' | jq
```

## デプロイ

```bash
# 環境変数なしで OK (pure compute)
supabase functions deploy quality-scorer --project-ref <PROJECT_REF>
```

JWT verification はデフォルト ON。匿名 client (anon key) から叩く想定。

クライアント側からの呼び出し例:

```ts
import { supabase } from '@/lib/supabase';

const { data, error } = await supabase.functions.invoke('quality-scorer', {
  body: {
    title,
    content,
    media_count: mediaCount,
    video_count: videoCount,
  },
});
```

## 注意点

- 本関数は **シグナル提供のみ** で、投稿のブロックには使わない (それは `check-content` の責務)。
- スコアは絶対値ではなく相対指標。閾値は呼び出し側で調整する。
- keyword リストはローカライズが弱いので、日本語以外の投稿が増えたら拡張する。
- DB 上の `post_quality_score` view と数値が一致する必要はない (粒度が異なる)。
