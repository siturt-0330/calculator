---
tags: [geek, supabase, postgres, rls, migration, rpc, security, データ層]
---

# データ層・Supabase・RLS・マイグレーション運用

Geek (geek-v4) のバックエンドは **Supabase (PostgreSQL + RLS + Realtime + Edge Functions)** のみ。専用 API サーバは無く、クライアント (Expo / React Native / Web) が `@supabase/supabase-js` の anon key で直接 PostgREST / RPC / Realtime / Storage を叩く。「サーバの正当性 = RLS と SECURITY DEFINER 関数で担保する」という設計なので、**RLS とマイグレーション運用がこのアプリのセキュリティそのもの**になっている。

> 関連: [[アーキテクチャ概要]] / [[State管理 (Zustand・React Query)]] / [[認証・セッション]] / [[フィード・ランキング・レコメンド]] / [[匿名性設計と de-anon ホール]] / [[Admin Console (運営管理)]] / [[地雷・落とし穴 総覧]] / [[運用 — デプロイ・プレビュー・本番反映確認]]

---

## 概要

- **構成**: `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` を全プラットフォーム共通でバンドル同梱。anon key は「RLS 前提で安全」という設計 (CLAUDE.md §8)。
- **絶対則**: `SUPABASE_SERVICE_ROLE_KEY` / `VAPID_PRIVATE_KEY` / `ANTHROPIC_API_KEY` は **クライアントに絶対置かない**。Edge Function 環境変数 / `supabase secrets set` のみ。service_role は RLS と列権限を bypass するため、漏れると全データ改竄可能。
- **クライアント呼び出しの 3 形態**:
  1. PostgREST 直 (`supabase.from('posts').select(...)`) — 単純な読み書き。RLS が効く。
  2. **RPC** (`supabase.rpc('get_feed_page', {...})`) — N+1 / waterfall を 1 ラウンドトリップに畳む & 匿名マスクを server で強制する主力経路。
  3. Realtime / Storage — 別ノート ([[Realtime]] / [[画像・メディアパイプライン]])。
- **API 層の集約**: `lib/api/*.ts` (60 ファイル超) に全 DB 呼び出しを集約。**component から `supabase.from(...)` を直接叩かない**のが規約 (CLAUDE.md §14 の NG リスト)。
- **マイグレーション**: `supabase/migrations/0001〜0145 + complete_schema.sql`。番号順・**既存ファイル編集禁止**。
- **🔴 最大の運用罠**: Netlify はマイグレーションを実行しない。番号の飛んでいる新規 migration (特に 0118 以降の多く) は **Supabase SQL エディタで手動適用が必要**で、未適用でもクライアントが fallback で「中途半端に動く」= silent degrade する (後述)。

---

## 仕組み・設計

### Supabase クライアント (`lib/supabase.ts`)

`createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {...})` を 1 箇所で生成 (`export const supabase`)。要点:

- **auth**: `flowType:'pkce'` / `persistSession:true` / `autoRefreshToken:true` / `detectSessionInUrl:false`。`storageKey = 'geek-v4-auth'` (`AUTH_STORAGE_KEY`)。詳細は [[認証・セッション]]。
  - storage は Platform 分岐: **Web = localStorage** ラッパ (`webStorage`、SSR/Node や Safari ITP では in-memory map にフォールバック)、**Native = SecureStore** (`nativeSecureStorage`、Keychain/Keystore で暗号化 + 2048byte 制限回避の chunk 分割 + `AFTER_FIRST_UNLOCK`)。
  - `readPersistedSession()` = `getSession()` が web で稀に stall する事故への fallback。storage から直接 session JSON を読む。
- **realtime**: `params.eventsPerSecond: 5` (1000+ 並行ユーザー時の fanout 過剰抑制)。
- **global.headers**: `{ 'x-client-info': 'geek-v4' }`。

### RLS 方針

- **全 table に RLS 設定済** (CLAUDE.md §7)。**RLS をバイパスする手段をクライアントに提供しない**。
- RLS ポリシーの実体は各 migration の `create policy`。例: posts は `posts_select_visibility` (0061) が可視性述語、`posts_update` が `using(auth.uid()=author_id)` (0001) + `with check(...)` (0133)。
- **RLS だけでは塞げない 2 つの限界** (これが de-anon ホール / 列改竄ホールの根源):
  1. **RLS は「どの *行*」しか制限せず「どの *列*」は制限しない** → 列単位 GRANT が別途必要 (→ 0134 / 0138)。
  2. **PostgreSQL の実効列権限 = table権限 OR 列権限**。Supabase 既定で `grant all on all tables to anon, authenticated` が効いているため、`revoke select(col)` だけでは table 全体 SELECT が覆って **列 revoke が no-op になる** (→ 0129 が no-op だった真因)。列を隠すには「table 全体 SELECT を revoke してから列リストを GRANT」が必須。
- RLS で行は守れても **Realtime payload は列 SELECT 権限を尊重しない**ので、列マスクを Realtime には期待できない (client allowlist が別途必要)。

### RPC (SECURITY DEFINER) — フィード系の主力

RPC を多用する理由は 2 つ: **(a) waterfall 削減**、**(b) 匿名 author_id マスクを server で強制**。代表例:

| RPC | migration | 役割 |
|---|---|---|
| `get_feed_page(p_post_ids, p_user_id)` | 0041 → 0107 → **0115** | フィード 1 ページの周辺データ (communities / official_author / my_like|concern|save / reactions / added_tags / poll) を 1 RPC で。`lib/api/feedPage.ts` 経由 |
| `get_community_feed(p_user_id, p_limit)` | 0042 → 0112 → **0115** | コミュニティフィード |
| `get_home_feed` | 0114 | home feed 1 ページ目集約 (★既定 OFF、flag `EXPO_PUBLIC_HOME_FEED_RPC='1'`) |
| `get_for_you_feed(p_user_id, p_limit)` | **0141** | Value Model 個人化フィード (★既定 OFF、flag `EXPO_PUBLIC_FOR_YOU_FEED_RPC='1'`) |
| `get_discovery_payload` | 0113 | 検索/発見タブ |
| `get_my_posts` / `get_my_comments` | 0117/0131 / 0130 | 自分の投稿・コメント (author_id 列 revoke 後も読めるようにする RPC) |
| `get_report_queue` / `assign` / `resolve` | 0118 (→ 0123 で moderator 開放) | 通報トリアージ ([[Admin Console (運営管理)]]) |
| `admin_delete_post` / `admin_toggle_shadowban` / `apply_enforcement` / `set_admin_role` | 0031/0061/0122/0120 | admin 操作 |
| `reconcile_community_counters()` | — | カウンタ drift 修復 (admin) |

**SECURITY DEFINER の使い分け** (ここが設計の肝):

- **フィード RPC を DEFINER にする理由**: RLS を bypass して、行レベルの可視性を**関数内で明示的に再適用**しつつ author_id を**マスクして返す**ため。
  - 0115 `get_feed_page` / `get_community_feed` は `security definer` + `set search_path = public, pg_temp`。
  - 関数内で RLS 相当の可視性述語を**手で再実装**している: `join posts p ... and (public.can_view_post(p.id) or p.author_id = auth.uid()) and public.author_visible(p.author_id)`。**DEFINER は RLS を bypass するので、この述語を関数内に書かないと全投稿が漏れる**。
  - **IDOR gate**: `if p_user_id is not null and p_user_id != auth.uid() then raise exception 'forbidden' using errcode='42501'` (0078/0079 由来)。他人の uid を渡して my_like を覗けないようにする。
  - **author_id マスク** (0113/0076 と逐語一致の CASE): `case when pr.is_anonymous and (v_viewer is null or v_viewer is distinct from pr.author_id) then null else pr.author_id end`。viewer 本人以外には匿名投稿の author_id を返さない。
  - **`is_own` boolean を server 供給**: `(v_viewer is not null and pr.author_id = v_viewer)`。author_id 列を revoke すると client は `post.author_id === me` 判定ができなくなるため、その代替。
  - `v_viewer := auth.uid()` を authoritative source にする (DEFINER でも `auth.uid()` は JWT GUC なので不変)。
- **counter トリガを DEFINER にする理由** (0134、後述): 列 revoke 後も like/comment が壊れないように、トリガ実行者を owner 権限に上げる。

`get_for_you_feed` (0141) の中身は Instagram Explore 風の多段ファネル: Stage1 候補 150 件 (7日内・可視・既読除外・hot_score 降順) → Stage2 Value Model スコア (`タグ親和性×4 + ln(likes+1)×2 + ln(comments+1)×1.5 - concern_penalty + 鮮度×2 + コールドスタートブースト`) → Stage3 dominant tag ごと最大3件で多様化。affinity 未設定ユーザーは hot_score fallback。詳細は [[フィード・ランキング・レコメンド]]。

### `lib/api/feedPage.ts` — RPC 呼び出しの模範

`fetchFeedPage(postIds, userId)` が典型パターンを凝縮:

- **入力 sanitize**: `UUID_RE` で UUID 検証 + dedup + `MAX_POST_IDS_PER_CALL=100` で client 側 cap (server の `array_length` raise=0071/0073 と整合、500件溜まっても hang しない)。`userId` も UUID 検証 (anon は null)。
- **`withApiTimeout` でラップ**: `withApiTimeout(supabase.rpc('get_feed_page', {p_post_ids, p_user_id}), 'feedPage.get_feed_page', 8000)`。
- **fail-soft**: RPC error / throw 時は `console.warn` + **空配列**を返す → 上位 `useFeedPage` が旧 hook 群へフォールバック → feed.tsx は post 本体だけ表示 (= **完全 hang は絶対しない**)。
- `normalizeFeedPageRow()` で RPC の生 row を `FeedPagePost` 型に正規化。`get_home_feed` (0114) も同一 row shape を返すので `lib/api/homeFeed.ts` がこの正規化を再利用し、`['feed-page']` cache の shape を厳密一致させる (patcher / realtime と互換)。

### `withApiTimeout` / `resilient` / `swallow` — エラーハンドリング 3 種

Supabase の `PostgrestBuilder` は thenable だが **AbortController を持たない** → ネットワークが詰まると無限待ち。3 helper を用途で使い分ける (CLAUDE.md §5.1 / §5.6):

| helper | 用途 | リトライ | 副作用 |
|---|---|---|---|
| `withApiTimeout(promise, label, ms)` | timeout だけ加える軽量版。**副作用あり mutation はこれ** | なし | なし |
| `resilient(fn, opts)` | retry + timeout + Sentry breadcrumb。**リトライしたい GET** | 指数バックオフ 200→400→800ms | 401/JWT expired で `unauthorizedHandler` 発火 → 自動 signOut |
| `swallow('scope', e)` | `try{}catch{}` の代替 (breadcrumb 残す) | — | 例外握りつぶし |

- `withApiTimeout` 実装: `Promise.race([Promise.resolve(promise), timeoutPromise])`、`finally` で必ず `clearTimeout` (Jest open-handle リーク防止)。timeout は `throw new Error('[label] timeout after Nms')`。**注: Supabase リクエスト自体はバックグラウンドで継続する** (中断機構が無いため) が、caller は待ち続けず error を返せる。
- `resilient` のリトライ判定: `NO_RETRY_MESSAGE_PARTS` (`401`/`403`/`row-level security`/`RLS`/`duplicate key`/`check constraint`) は即 fail、`SHOULD_RETRY_MESSAGE_PARTS` (`Failed to fetch`/`NetworkError`/`timeout`/`502/503/504`/`ETIMEDOUT`/`ECONNRESET`) は再試行。**RLS 違反 / 制約違反はリトライしない** (無駄打ち防止)。
- **副作用あり mutation はリトライ禁止** (`resilient` の `retries:0` か `withApiTimeout`)。二重 insert を防ぐ。

### マイグレーションの世代別ハイライト

`0001_schema.sql` が初期スキーマ、`complete_schema.sql` は累積スナップショット。主な世代:

- **基盤**: 0001 schema / 0004 tag / 0005 reddit-like / 0006 credibility (信頼スコア) / 0017 communities / 0021 匿名性+storage (連投制限トリガ `posts_rate_limit_trg`)。
- **トリガ**: `handle_new_user` (0016 で nickname 長さ制約を堅牢化) / `update_likes_count` / `update_comments_count` / `update_concern_count` / `refresh_account_state` / `maybe_promote_proposal` / `compute_post_hot_score` (0058) / `guard_profile_update` (0100/0105)。
- **フィード RPC**: 0041 get_feed_page / 0042 get_community_feed / 0073 cap / 0078-0079 gate (IDOR) / 0107 visibility / 0114 get_home_feed / 0141 get_for_you_feed。
- **検索/レコメンド**: 0085-0097 (search engine v2 / pgvector / multi-task ranking / diversity rerank)、0139-0141 (user_tag_affinity / post_impressions / get_for_you_feed)。詳細は [[フィード・ランキング・レコメンド]]。
- **匿名性 de-anon 修復 (Phase2)**: 0115 (author_id マスク + is_own) / 0116 pseudonym_id / 0125 deanon_rpcs / 0126 feed avatar / 0127 profiles_public revoke / 0128 admin author rpcs / 0129 (no-op) → 0138 author_id revoke 是正。詳細は [[匿名性設計と de-anon ホール]]。
- **Admin Console**: 0118-0123 (report_cases / traffic source+ads / RBAC / notifications / enforcement+appeals / moderator 開放)。詳細は [[Admin Console (運営管理)]]。
- **plat 機能**: 0142 quote_posts / 0143 user_blocks / 0144 post_drafts / 0145 spam_rate_limit。詳細は [[プラットフォーム機能 (引用・シェア・下書き・ブロック)]]。

### Edge Functions (`supabase/functions/`)

`supabase functions deploy <name>`、秘密は `supabase secrets set`。現存:

| 名前 | 役割 | 注意 |
|---|---|---|
| `check-content` | 投稿前モデレーション | **fail-secure** (catch で `ok:false`)、Unicode NFKC 正規化 |
| `send-push` | Web Push 配信 | 失効 endpoint (404/410) を自動削除 |
| `automod-eval` | 自動モデレーション | **service_role** で `is_hidden`/`tag_names` を書く (列権限/RLS bypass) |
| `calculate-trust-score` | 信用スコア再計算 | |
| `verify-official-url` | 公式コミュ URL 所有権検証 | **SSRF 対策** (private IP 拒否 / 5s timeout / 500KB cap) |
| `suggest-caption` | キャプション提案 | 将来 AI 統合 |
| `og-fetch` / `og-image` | リンクプレビュー OGP | |
| `quality-scorer` / `rank-blender` / `search-explainer` | ランキング/検索補助 | |
| `_shared` | 共通ユーティリティ | |

---

## 注意点・地雷

### 🔴 migration 手動適用 = silent degrade の罠 (最重要)

**Netlify はマイグレーションを実行しない**。新規 migration は Supabase SQL エディタで番号順に手動適用が必要。未適用でも client は fallback で動くため、**症状から原因に辿りつきにくい**。

- **Admin Console (0118→0123)**: 番号順に手動適用必須。未適用時の degrade (クラッシュはしない):
  - 通報キュー: `get_report_queue` 無 → `fetchReportedPosts` (concern 集計) に落ち、case id=`fallback:<post_id>` で assign/resolve 不可。「通報が常に0件に見える」。
  - 広告: `fetchTargetedAdsV2` が列欠落で `fetchTargetedAds` (v1 タグ配信) に落ちる (DEV warn)。「広告が priority 配信されない」。
  - 措置UI: `EnforcementPanel` が throw → React Query が握り空表示。strike が常に 0。
  - **対処**: admin 機能が中途半端なら **まず migration 適用状況を疑う**。動作確認シードは `scripts/seed_admin_console.sql` (冪等)。
- **レコメンド (0139-0141)**: 手動適用 + **pg_cron 登録** + flag `EXPO_PUBLIC_FOR_YOU_FEED_RPC='1'` の 3 点が揃って初めて有効。順序を守る。
- **既定 OFF flag の判定**: `=== '1'` で判定する。既存の `!== '0'` (既定 ON) パターンをコピペすると意図せず既定 ON 事故 (CLAUDE.md §14)。

### ★ 未適用・手動適用待ちの危険な migration (2026-06-09 時点)

`memory/project_geek_v4_post_column_hole.md` 由来。**いずれも本番反映前にローカル/preview で実機確認が必須**。デプロイはユーザ明示指示時のみ ([[運用 — デプロイ・プレビュー・本番反映確認]])。

- **0134_post_column_update_hardening.sql** (★未適用): posts の**列単位 UPDATE 改竄ホール**を塞ぐ。
  - **穴**: `posts_update` RLS は行しか制限しないため、認証ユーザが自分の投稿に `update posts set likes_count=99999, score=999, visibility='public', is_public=true` を直 REST で撃てた (いいね数/ランキング/公開範囲の捏造)。
  - **修正の構造**: (1) counter トリガ関数 `update_likes_count`/`update_comments_count`/`update_concern_count` を `ALTER FUNCTION ... SECURITY DEFINER SET search_path=public,pg_catalog` で DEFINER 化 → (1.5) **フェイルセーフ**: 3 関数が全て DEFINER 化できたか検証し、1 つでも INVOKER なら revoke を中止して abort (counter 破壊防止) → (2) `revoke update on posts from authenticated, anon` → (3) 編集可能 11 列のみ `grant update (content,title,tag_names,content_warning,cw_category,media_urls,media_blurhashes,video_urls,video_durations,video_posters,qa_mode) to authenticated` → (4) service_role には table 全体 UPDATE を明示維持 (automod-eval 用)。
  - **なぜ DEFINER 化が必須**: counter 列を revoke すると INVOKER のままの counter トリガが like 押下時に authenticated 権限で posts を UPDATE できず `42501 permission denied for column likes_count` で like が壊れる。DEFINER (owner=postgres) なら RLS bypass + 全列権限で通る。`auth.uid()`/`pg_trigger_depth()` は DEFINER でも不変なので profiles guard の挙動は変わらない。
  - **なぜ `create or replace` でなく `ALTER FUNCTION`**: counter 本体が `0001_schema.sql` と `complete_schema.sql` で食い違う (update_comments_count の DELETE 減算 / profiles.comment_count の扱い)。どちらが live か断定できないため、本体を書き直すと live を巻き戻すリスク。ALTER は**属性のみ変更**で最も安全。
  - **PostgreSQL 仕様の順序制約**: table 全体 GRANT があると列 GRANT は無効 (table 権限が全列を覆う) → **必ず table 権限を先に revoke してから列 GRANT**。
  - **★適用前に必ず**: like→count 反映をローカル/preview で実機確認 (DEFINER 化で counter が壊れないこと)。検証 SQL は migration footer 参照 (`pg_proc.prosecdef` / `information_schema.column_privileges` / `set local role authenticated` での 42501 確認)。
- **0138_author_id_revoke_effective.sql** (★未適用): 0129 の no-op を是正。
  - **0129 が no-op だった真因**: `revoke select(author_id)` だけでは Supabase 既定の table 全体 SELECT GRANT が覆い、author_id は読めたまま (PostgreSQL の実効列権限 = table権限 OR 列権限)。
  - **0138 の形**: 0134 と同じ「table 全体 SELECT revoke → author_id 以外の全列を列 GRANT」。列リストは `information_schema` から動的取得 (取りこぼし=フィード permission denied を防ぐ) + フェイルセーフ DO + 検証 SQL footer。
  - **★適用前のブロッカー (未対応)**: client がまだ REST で `posts/comments.author_id` を読む経路が残る。特に **`lib/api/account.ts` の `exportUserData` (GDPR export)** が `select('*').eq('author_id',uid)` で自分の投稿/コメントを引く → REVOKE 後は catch で空配列+warning = **自分の投稿/コメントがエクスポートから黙って欠落**。先に auth.uid() ベース RPC 化 (get_my_posts/get_my_comments 流用可) が必要。詳細は [[匿名性設計と de-anon ホール]]。

### マイグレーション運用ルール

- **既存 migration ファイルは編集禁止** (idempotency 崩壊)。revert は新ファイル (`00XX_revert_*.sql`) で。
- **冪等に書く**: `create or replace` / `do $$..$$` 存在チェック / `revoke`・`grant` は重複実行で error にならない。
- **`do $$..$$` で関数を包まない罠**: 一部 SQL エディタの statement splitter が nested dollar-quote (`$fn$`) を誤分割し "syntax error at uuid" を出す。SECURITY DEFINER 関数は **top-level で `create or replace`** する (0115 のコメント参照)。
- **DEFINER 関数には必ず `set search_path`** を固定 (search_path 注入対策)。本体は `public.posts` のように完全修飾しておく。
- `supabase db push --linked` / `supabase gen types typescript` は CLAUDE.md §2 参照。ただし**本番は SQL エディタ手動適用が実態**。

### その他の落とし穴

- **`PostgrestError` は `Error` のサブクラスではない** → `e instanceof Error` が false。message 取得は型ガード必須: `(e && typeof e === 'object' && 'message' in e) ? String((e as {message:unknown}).message) : String(e)`。
- **RPC は `withApiTimeout` 必須**。AbortController が無いので race timeout しないと UI が hang する。
- **fail-soft の二面性**: RPC 失敗で空配列を返す設計は「hang しない」利点と引き換えに「未適用に気づきにくい」silent degrade を生む。DEV では `console.warn` が出るので preview で warn を見逃さない。
- カウンタ drift が起きたら `reconcile_community_counters()` RPC で admin が修復。
- 連投制限は 0021 の `posts_rate_limit_trg` トリガが「投稿ペースが速すぎます…」を raise する (client 側 `lib/rateLimit.ts` とは別の server side defense)。

---

## 関連

- [[アーキテクチャ概要]] — 全体像の中でのデータ層の位置づけ
- [[State管理 (Zustand・React Query)]] / [[Zustand・React Query ベストプラクティス]] — RPC 結果の cache 管理 (`['feed-page']` / feedPagePatcher)
- [[認証・セッション]] — supabase client の auth 設定 / SecureStore / 401 → signOut
- [[フィード・ランキング・レコメンド]] — get_feed_page / get_home_feed / get_for_you_feed の使われ方
- [[匿名性設計と de-anon ホール]] — author_id マスク / profiles_public revoke / 0129→0138
- [[Admin Console (運営管理)]] — 0118-0123 手動適用 + RBAC RPC
- [[プラットフォーム機能 (引用・シェア・下書き・ブロック)]] — 0142-0145
- [[Realtime]] / [[画像・メディアパイプライン]] — Realtime payload の列権限非尊重 / Storage bucket
- [[運用 — デプロイ・プレビュー・本番反映確認]] — Netlify は migration を流さない / 手動適用の確認
- [[地雷・落とし穴 総覧]] — silent degrade / 列改竄ホール / PostgrestError 型ガード
- [[TypeScript 型安全性]] — RPC row → 型正規化 (normalizeFeedPageRow)
- [[テスタビリティとテスト戦略]] — `tests/unit/feedPagePatcher.test.ts` など
