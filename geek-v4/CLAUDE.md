# CLAUDE.md — geek-v4 開発ガイド

> このファイルは Claude (AI ペアプロ) がこのリポジトリで作業するための「最初に読む」運用ガイド。
> 仕様の完全版は `SPECIFICATION.md` (2059 行)、リリース手順は `docs/DEPLOY.md`、
> 仮説検証ログは `docs/HYPOTHESIS_LOG.md` を参照。ここはそれらへのインデックス + 運用ルール + コード規約。

---

## 0. 何より先に守る運用ルール (STANDING POLICIES)

### 🛑 Netlify deploy は **ユーザー明示指示時のみ**

- 「**netlify には俺が指示したときだけ反映させて**」「**勝手に netlify でアップデートしないで**」が standing rule。
- 該当する操作:
  - master / main への merge (PR merge 含む)
  - master / main への push
  - `gh pr merge`
- ローカル commit / branch push / PR 作成は通常 OK だが、以下のキーワードが user message に明示で出ているときだけ deploy パイプラインを動かす:
  - 「反映」「push」「deploy」「netlify」「merge して」「リリースして」
- 迷ったら **branch push までで止めて確認** を取る。

### 📋 task tracking はやり過ぎない

- TaskCreate / TaskUpdate は **複数ステップで進捗を user に見せたいとき** だけ。1 ファイル read や直行で書ける edit には不要。
- 既存タスクが古いままなら無視して良い (cleanup を proactively しない)。

### 💬 言語

- user とのやりとりは **日本語**。コード comment も日本語が default (このリポジトリの既存スタイル)。
- ただし **コード本体 (識別子 / 関数名 / 型名)** は英語。
- console.log / Sentry breadcrumb メッセージは英語 prefix (`[realtime] ...`) + 日本語説明 OK。

---

## 1. プロジェクト一言まとめ

**GEEK** = 「好きを、匿名で、安心して続ける」趣味専用 SNS。React Native (Expo) で iOS / Android / Web に同一コードを配信。バックエンドは Supabase (PostgreSQL + RLS + Realtime + Edge Functions)。

- Web: <https://geekboard.netlify.app/>
- メイン開発バージョン: 4.0.0
- アクセントカラー: `#7C6AF7` (紫)
- 開発スタイル: **開発者 1 人 + Claude ペアプロ** (`docs/HYPOTHESIS_LOG.md` 参照)

詳細は `SPECIFICATION.md` 第 1〜2 章。

---

## 2. クイックコマンド

```bash
# 開発
npm start                  # Expo dev server
npm run web                # Web (Metro) で起動
npm run ios                # iOS Simulator
npm run android            # Android Emulator

# 検証 (commit 前に必ず)
npm run type-check         # tsc --noEmit (strict)
npm test                   # Jest (--passWithNoTests OK)
npm run lint               # ESLint --max-warnings 0
npm run format             # Prettier 書き換え

# ビルド
npm run build:web          # Netlify が走らせるのと同じ command (dist/ に export)

# Supabase
supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > types/supabase.ts
supabase db push --linked
supabase functions deploy <name>
```

CI (`.github/workflows/ci.yml`) は `type-check + test` を毎 PR で実行、master push のみ `build:web` smoke test。

### Metro キャッシュ運用 (2026-05-28 〜)

`metro.config.js` で **`FileStore` 永続キャッシュ** を `.metro-cache/` に設定済。
`expo start` の挙動は以下を区別する:

| コマンド | キャッシュ | 速度 | 使う場面 |
|---|---|---|---|
| `npx expo start --web --port 8081` | 利用 (`.metro-cache/` を再利用) | **速い (2nd start 30〜60s)** | **通常の dev** はこちら |
| `npx expo start --web --port 8081 --clear` | 破棄して 1 から | 遅い (cold start 185s) | キャッシュ汚染が疑われるとき (transform バグ / 依存更新後 / 謎の bundle エラー) |

- `.metro-cache/` は `.gitignore` 済。サイズが膨らんだら手動で削除して OK (= 次回が `--clear` と同等)。
- `scripts/preview-pr.ps1` も `--clear` なし版を推奨表示するように更新済。
- `resetCache: false` (default) を維持。`true` にすると 2 回目以降も毎回 cold。

---

## 3. リポジトリレイアウト (geek-v4/)

```
app/                    Expo Router (file-based)
  (auth)/               ログイン・サインアップ
  (tabs)/               メイン 5 タブ (feed / bbs / community / mypage)
  onboarding/           初回設定ウィザード (6 画面)
  post/[id].tsx         投稿詳細, post/create.tsx で作成 (modal)
  bbs/[id].tsx          掲示板スレ詳細, bbs/create.tsx で作成
  settings/             プロフィール編集・通知・プライバシー等
  community/            ※ (tabs)/community/ 配下 (tab bar 保持目的)
  official/             公式コミュ管理画面 (admin 限定)
  admin/                /admin URL 直打ちで隠し管理画面
  notifications/        通知一覧
  mypage/{saved,liked,posts}.tsx
  search.tsx            全文検索 (post/bbs/tag/community/user)
  filter/index.tsx      タグフィルタ管理 (modal)
  _layout.tsx           Root: PersistQueryClientProvider + auth/onboarding redirect

components/             再利用 UI (feed/ bbs/ community/ post/ settings/ shared/ ui/ tag/ ...)
hooks/                  カスタム React Hooks (40+)
lib/
  api/                  Supabase クエリ層 (feedPage / posts / reactions / ...)
  cacheUpdates/         feedPagePatcher.ts ← React Query cache patch helper
  ai/                   AI 関連 (proposal / suggest)
  search/               全文検索エンジン (variants, similarity, parseQuery, BM25)
  personalize/          For You ランキング
  tagClustering/        Algo Phase 1-4 (hub-based cluster + co-occurrence)
  feed/                 (空 or feed 専用 utils)
  trust/                信用スコア計算
  utils/                date / color / queryKey / imageUrl / tagSuggest / searchAlgo
  i18n.ts               静的 dict + brand-name 保護 + translateDynamic (MyMemory)
  i18n/                 (上記の補助モジュール)
  realtime.ts           ★ attachChannel singleton (Supabase Realtime ラッパ)
  resilient.ts          retry + timeout + Sentry breadcrumb
  withApiTimeout.ts     軽量 timeout 単体
  swallow.ts            try/catch の代替 (breadcrumb 残す)
  supabase.ts           Supabase client (PKCE / pkce / web localStorage)
  env.ts                EXPO_PUBLIC_* を 1 箇所で window
  storage.ts            MMKV (native) / localStorage (web) 同期 wrapper
  sanitize.ts           XSS / SSRF 対策 (sanitizeUrl, escapeHtml)
  sentry.ts             PII redact 付き Sentry init
  analytics.ts          PostHog
  webVitals.ts          Web Vitals
  rateLimit.ts          クライアント側レート制限
  passwordPolicy.ts     パスワード強度判定
  image.ts              EXIF strip + magic-byte 検証 + JPEG 再エンコード
  media.ts              uploadPostImage / uploadPostVideo
  memes.ts              絵文字スタンプ定義
  obsidian.ts           Obsidian 連携 (DEV モード限定)

stores/                 Zustand (auth / settings / lang / tagFilter / toast / ui / ...)
design/                 tokens.ts (C / GRAD / SP / R / SIZE) + typography / shadows / motion / haptics
constants/              icons.ts (Lucide alias) など
types/                  型定義 (models.ts, supabase.ts)
supabase/
  migrations/           0001 〜 0043 + complete_schema.sql (時系列, 編集禁止)
  functions/            check-content / send-push / verify-official-url / calculate-trust-score / suggest-caption / send-notification
tests/
  unit/                 Jest (smoke / queryKey / i18nKeys / i18nBrand / tagClustering / trending / toastDuration / videoValidate / xorSelection / feedPagePatcher ...)
  e2e/                  Maestro (npm run test:e2e)
scripts/                netlify-build.sh, fix-html.mjs, reset-project.js, seed_dummy*.sql
docs/                   DEPLOY.md / HYPOTHESIS_LOG.md / STORE_REVIEW.md / UNIVERSAL_LINKS.md / UPGRADE_NOTES.md
SPECIFICATION.md        ★ 仕様の完全版 (2059 行, 28 章)
netlify.toml            ★ Netlify は base=geek-v4 で **この** ファイルを読む (repo root のは使われない)
.npmrc                  legacy-peer-deps=true (Netlify npm ci で peer dep 解決を緩める)
babel.config.js         expo + nativewind + reanimated (production 時 console.log strip)
app.json                Expo config (bundle id app.geek.v4, scheme geek, privacyManifests)
tsconfig.json           strict + noUncheckedIndexedAccess (supabase/ tests/ は除外)
.eslintrc.js            no-explicit-any: error, react-hooks rules 有効, react-native lint 一部 off
```

---

## 4. 技術スタックの "なぜ"

| 領域 | 選定 | 理由 |
|---|---|---|
| UI | React Native 0.76 + Expo SDK 52 | 単一コードで iOS/Android/Web。new arch + Hermes |
| Router | Expo Router 4 (file-based) | typed routes、(tabs) で底辺タブ保持 |
| Styling | NativeWind + Tailwind | RN で Tailwind syntax、design/tokens.ts で C/SP/R/SIZE を中央管理 |
| State (client) | Zustand 5 | 1 store 1 file。**selector で subscribe** (destructure 禁止 — re-render 連鎖の元) |
| State (server) | TanStack Query v5 | staleTime 30s / gcTime 2h / refetchOnWindowFocus=false / persist で AsyncStorage |
| Storage (永続) | MMKV (native) / localStorage (web) | `lib/storage.ts` で同期 wrap。cold start から async/await を排除 |
| Auth | Supabase Auth (PKCE) | session key=`geek-v4-auth`, SecureStore は使わず localStorage/AsyncStorage |
| Realtime | Supabase Realtime + **1 channel / 1 table** | publication 未登録 table を chain bind すると channel 全死。`lib/realtime.ts` の attachChannel で refCount 管理 |
| HTTP | Supabase JS + `withApiTimeout` | PostgrestBuilder に AbortController 無し → race で timeout |
| Errors | `resilient` / `withApiTimeout` / `swallow` | 各々用途が違う (下記参照) |
| アニメ | Reanimated 3 + Moti | Worklet で UI スレッド実行 (60fps 死守) |
| List | @shopify/flash-list | recycler 方式で大量投稿でも軽い |
| Image | expo-image + ProgressiveImage | EXIF strip → magic-byte → JPEG 再エンコード |
| Push | Web Push (VAPID) + Expo Notifications | private key は Supabase secrets |
| Monitor | Sentry + PostHog | Sentry は PII redact 必須、sample 5% |

---

## 5. アーキテクチャパターン (これが書けると codebase に馴染む)

### 5.1 Supabase 呼び出し

```ts
// ✅ 標準
import { withApiTimeout } from '../withApiTimeout';
const { data, error } = await withApiTimeout(
  supabase.from('posts').select('*').eq('id', id),
  'posts.fetchOne',
  8000,
);

// ✅ リトライが必要な GET
import { resilient } from '../resilient';
const rows = await resilient(
  async () => {
    const { data, error } = await supabase.from('posts').select('*');
    if (error) throw error;
    return data;
  },
  { name: 'posts.list', timeoutMs: 8000, retries: 2 },
);
```

- **副作用あり mutation はリトライしない** (`resilient` の retries=0 か `withApiTimeout` を使う)。
- 401 / JWT expired は `resilient` 内で `unauthorizedHandler` (authStore 登録) を発火 → 自動 signOut。

### 5.2 React Query

- `queryKey` は配列。最初の要素を prefix とする (`['feed-page', userId, sortedKey]` のように)。
- 大量 ID を含む key は `stableKeyFor(sortedIds)` で hash 化 (`lib/utils/queryKey.ts`)。50 件以下は join のまま、超えたら djb2 で短縮。
- **partial-match の `setQueriesData` が散発的に伝播しない issue を react-query v5 で観測済**。確実に書き戻したいときは `getQueriesData` で exact key を列挙して `setQueryData` を逐次呼ぶ (`lib/cacheUpdates/feedPagePatcher.ts` 参照)。
- optimistic update は **snapshot → apply → settled で invalidate → error 時 revert** が標準。

### 5.3 Realtime (★ 過去 hot bug が頻発した領域)

- **1 channel に複数 table を chain しない**。publication 未登録 table の binding が CHANNEL_ERROR を起こすと channel 全体が死ぬ (event 一切配信されない)。
- 必ず `lib/realtime.ts` の `attachChannel(name, build, onStatus?)` を経由。channel 名で refCount し、同名なら既存を共有。
- subscribe ライフサイクル (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED) を `onStatus` で観測すると debug が桁違いに楽。本番でも console.warn は babel `transform-remove-console` から除外設定済みなので残してよい。
- 上限: 1 セッション同時 20 channel まで (`MAX_CONCURRENT_CHANNELS`)。
- publication 状況 (2026-05 時点):
  - ✅ 登録済: `post_reactions`, `likes`, `bbs_replies`, `comments`, `notifications`
  - ❌ 未登録: `concerns`, `saves`, `community_stamp_reactions` 等 (subscribe するとそれだけで CHANNEL_ERROR)
- フィード全体の realtime は `hooks/useFeedRealtime.ts` に集約。useReactions など個別 hook の subscription は legacy 経路用。

### 5.4 Zustand store

```ts
// ❌ 全 destructure — store のどこか 1 フィールドの変更で全 component re-render
const { user, hydrated, hydrate, signIn } = useAuthStore();

// ✅ selector で subscribe — 必要な field だけ購読
const user = useAuthStore((s) => s.user);
const hydrated = useAuthStore((s) => s.hydrated);
const hydrateAuth = useAuthStore((s) => s.hydrate);
```

`_layout.tsx` の RootLayout で settings 16 フィールドを全 destructure していたために onboarding 中の小変更で navigation tree 全体が再 render → 「かくかく」する事例があった。**新規 component は必ず selector**。

### 5.5 i18n

- 静的 (UI ラベル) は `lib/i18n.ts` の `DICT` + `useT()` フック。`const t = useT(); t('好きなタグ')`。
- 動的 (投稿本文等) は `translateDynamic(text, targetLang)` で MyMemory API。
- **ブランド名 "Geek" は絶対に翻訳しない**。`protectBrandNames(src)` で `__GEEKBRAND__` に置換 → API 通過 → `restoreBrandNames(out)` で復元。test は `tests/unit/i18nBrand.test.ts`。
- Web では `document.documentElement.lang = lang` を effect で更新し、ブラウザ翻訳機能を活用 (Native は dict 経路を順次拡充)。

### 5.6 Error handling 3 つ

| ヘルパ | 用途 | 副作用 |
|---|---|---|
| `resilient(fn, opts)` | リトライ + timeout + breadcrumb | 401 で signOut 発火 |
| `withApiTimeout(p, label, ms)` | timeout だけ加える軽量版 | リトライなし |
| `swallow(scope, err)` | `try{}catch{}` の代わり (breadcrumb 残す) | 例外を握りつぶす |

`try { ... } catch {}` を新規に書くなら **すべて `swallow('scope.name', e)` に置き換える**。grep しやすい固定 scope を使う (`storage.set`, `sentry.init` 等)。

### 5.7 Storage (永続)

- 同期 API は `lib/storage.ts` の `{ getString, setString, getBool, setBool, getNumber, setNumber, getJson, setJson, remove, contains }`。
- MMKV (native) と localStorage (web) を裏で切り替える。SSR / 例外時は in-memory map にフォールバック。
- 旧 AsyncStorage キーは `migrateFromAsyncStorage(keys)` で fire-and-forget 移行 (Web は no-op)。

### 5.8 Sentry / PII

- `lib/sentry.ts` の `beforeSend` で JWT / email / phone / password / access_token を `[REDACTED]` 置換。
- `setSentryUser(userId)` は **id のみ** 渡す。email / nickname など PII は **絶対に setUser しない**。
- breadcrumbs の `console: false` で console.* キャプチャを止めている (PII リーク防止)。

### 5.9 Image upload

- 必ず `lib/image.ts` の `prepareImageUpload()` 経由:
  1. EXIF strip
  2. magic-byte で実際の画像形式を確認
  3. JPEG 再エンコード
  4. 5MB 超は自動圧縮
- bucket 一覧: `avatars`, `community-icons`, `posts-media`

---

## 6. コード規約 / lint ルール

- TypeScript **strict** + `noUncheckedIndexedAccess`。`array[0]` は `T | undefined` 扱い。
- `@typescript-eslint/no-explicit-any: 'error'`。`any` は基本書かない。やむを得ない時は `unknown` 経由で型ガード。
- React hooks: `react-hooks/exhaustive-deps: 'warn'`。意図的に依存を外すときは `// eslint-disable-next-line react-hooks/exhaustive-deps` + コメントで理由。
- imports: 既存 file の規約 (alias `@/` あり、ただし relative の方が多い)。
- file header: 重い設計判断のある file は `// ============================================================` で枠を切ってコメント (例: `lib/realtime.ts`, `lib/cacheUpdates/feedPagePatcher.ts`)。
- Prettier: singleQuote / trailingComma=all / printWidth=100 / tabWidth=2 / arrowParens=always。
- 日本語コメント可。むしろ design decision は日本語で書く文化。

---

## 7. データベース / Supabase 注意点

- マイグレーションは `supabase/migrations/00XX_*.sql` に番号順。**既存 file を編集禁止** (idempotency 崩壊)。revert は新 file (`00XX_revert_*.sql`) で。
- RLS は全 table に設定済。**RLS をバイパスする手段を提供しない** (service_role key はクライアントに絶対置かない)。
- 主要トリガ: `handle_new_user`, `update_likes_count`, `refresh_account_state`, `update_concern_count`, `maybe_promote_proposal`。
- カウンタ drift が起きたら `reconcile_community_counters()` RPC で admin が修復。
- `0041_get_feed_page_rpc.sql`: フィード 1 ページ分 (周辺データ含む) を 1 RPC で取得。`lib/api/feedPage.ts` 経由。

### Edge Functions

| 名前 | 役割 | 注意 |
|---|---|---|
| `check-content` | 投稿前のコンテンツモデレーション | fail-secure (catch で `ok:false`)、Unicode NFKC 正規化 |
| `send-push` | Web Push 配信 | 失効 endpoint (404/410) を自動削除 |
| `send-notification` | DB Webhook trigger 経由 | |
| `calculate-trust-score` | 信用スコア再計算 | |
| `verify-official-url` | 公式コミュ URL 所有権検証 | SSRF 対策 (private IP 拒否 / 5s timeout / 500KB cap) |
| `suggest-caption` | キャプション提案 | 将来 AI 統合 |

deploy: `supabase functions deploy <name>`。秘密は `supabase secrets set KEY=...`。

---

## 8. 環境変数

### EXPO_PUBLIC_* (クライアントバンドル同梱、Web は DevTools で読まれる前提)

| 変数 | 必須 | 説明 |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon key (RLS 前提で安全) |
| `EXPO_PUBLIC_VAPID_PUBLIC_KEY` | Web Push 使うなら | private key は Supabase secrets |
| `EXPO_PUBLIC_POSTHOG_KEY` | 任意 | 空なら analytics 無効 |
| `EXPO_PUBLIC_POSTHOG_HOST` | 任意 | default `https://app.posthog.com` |
| `EXPO_PUBLIC_SENTRY_DSN` | 任意 | 空なら Sentry init を早期 return |
| `EXPO_PUBLIC_FEED_PAGE_RPC` | 任意 | `'0'` でフィード RPC を kill-switch |

### 絶対にクライアントに置かない

- `SUPABASE_SERVICE_ROLE_KEY` / `VAPID_PRIVATE_KEY` / `ANTHROPIC_API_KEY` 等 → Supabase secrets / Edge Function 環境変数のみ。

### 配置場所

| 配信先 | どこに |
|---|---|
| ローカル | `geek-v4/.env` (gitignore 済) |
| Web (Netlify) | **`geek-v4/netlify.toml` の `[build.environment]`** ← Netlify は base=geek-v4 で **このファイル** を読む。repo root の `netlify.toml` は使われない |
| iOS/Android | `eas.json` の `build.env` または `eas secret:create` |
| Supabase Edge | `supabase secrets set KEY=...` |

`.env` を変えたら Expo dev server を再起動 (`process.env.EXPO_PUBLIC_*` は static 評価)。

---

## 9. デプロイ (詳細は `docs/DEPLOY.md`)

### Web (Netlify)

- master / main に merge すると Netlify が `npm ci && npm run build:web` を実行 → `dist/` を CDN へ。
- **base directory = `geek-v4`** が site setting に設定済。
- `.npmrc` の `legacy-peer-deps=true` が必須 (react-native-worklets の peer dep が厳しすぎる)。
- 失敗時は `docs/DEPLOY.md` § 2 → 「env が無くて白画面」が頻発した過去事故。netlify.toml に env 直書きで防御 (2026-05-24)。

### iOS / Android (EAS)

```bash
eas build --platform ios --profile production
eas submit --platform ios --latest
# Android も同様
```

### OTA update (JS のみ修正)

```bash
eas update --branch production --message "fix: <概要>"
```

Native module を触ったら必ず通常 build & submit。

---

## 10. テスト

- Jest (`npm test`) — `tests/unit/` の純関数 unit test が中心。**新しい純関数 / 純 reducer を書いたら test も追加**。
- Maestro (`npm run test:e2e`) — E2E (`tests/e2e/`)。
- 既存テスト:
  - `tests/unit/feedPagePatcher.test.ts` (cache patch)
  - `tests/unit/i18nBrand.test.ts` (Geek 保護)
  - `tests/unit/i18nKeys.test.ts` (dict の lang カバレッジ)
  - `tests/unit/queryKey.test.ts` (stableKeyFor)
  - `tests/unit/tagClustering.test.ts` (hub-based)
  - `tests/unit/trending.test.ts` (spike detection)
  - `tests/unit/toastDuration.test.ts`, `videoValidate.test.ts`, `xorSelection.test.ts`, ...
- TS 設定で `supabase/` `tests/` は tsconfig include から除外 (jest が独自に処理)。

---

## 11. 過去に踏んだ地雷 (再発防止 cheat sheet)

| 症状 | 真因 | 対策 |
|---|---|---|
| リアルタイムのスタンプが届かない | 1 channel に 4 table chain で 1 つでも CHANNEL_ERROR したら全死 | **1 channel / 1 table**。publication 未登録 table は subscribe しない |
| 楽観 update したのに UI に反映されない | RPC cache (`['feed-page', ...]`) しか UI が読まないのに legacy cache (`['my-likes']` 等) しか更新していなかった | `feedPagePatcher.patchFeedPagePost(qc, postId, patch)` で全 feed-page cache を書き換え |
| 「白画面で何も出ない」(production Web) | `EXPO_PUBLIC_SUPABASE_URL` が build 時に inline されず supabase client が初期化失敗 | env は repo root ではなく **`geek-v4/netlify.toml`** に置く |
| Netlify build が ERESOLVE で落ちる | npm 7+ peer dep 厳格化 vs RN ecosystem の緩い宣言 | `geek-v4/.npmrc` に `legacy-peer-deps=true` |
| 「Geek」が「オタク」に翻訳される | MyMemory は固有名詞を分かってくれない | `protectBrandNames` → API → `restoreBrandNames` |
| store の小変更で全画面 re-render | `const { user, ... } = useStore()` で全 destructure | selector に切り替え (`(s) => s.user`) |
| AnonPostCard がスクロール中にカクつく | 反応イベント毎に全 post invalidate | scope down + Set で O(1) lookup + debounce 300ms |
| `a@example.com` ユーザーが登録できない | profiles.nickname の length 制約に違反 | migration 0016 で trigger 関数を堅牢化 (短ければ `_u` 追加、長ければ truncate) |
| ハーフカクの「タップ感」 | PressableScale の delayPressIn=130ms + haptic を onPress に紐付け | `delayPressIn=0`, `onPressIn` で haptic, `hitSlop: 8` 標準 |
| Sentry に email / JWT が漏れていた | `beforeSend` redact が無かった | `lib/sentry.ts` の `redact()` + `redactObject()` + `console: false` integration |
| アイコンクロップで EXIF が漏れていた | expo-image-picker の生 URI を直 upload | `lib/image.ts` の `prepareImageUpload()` で EXIF strip + magic-byte 検証 + JPEG 再エンコード |
| realtime channel が増えすぎてクライアント不安定 | 上限なし | `MAX_CONCURRENT_CHANNELS = 20` で頭打ち、超えたら warn して no-op |
| search の variants が `===` で組合せ爆発 | 変換軸が増えるたびに掛け算 | `MAX_VARIANTS = 24` cap |
| 「戻るボタンが効かない」事故 | アニメ中の race + ディープリンクで back stack 空 | 200ms in-flight lock + `router.canGoBack()` false なら `/(tabs)/feed` fallback |
| 起動 5 秒「黒画面」 | Splash + intro 合算で 8 秒 | intro 5.5s → 3.0s + skip タップ + sessionStorage で 2 回目以降 skip + `forceReady` 500ms safety |

---

## 12. 主要 hooks / lib のクイックリファレンス

### hooks/
- `useFeedPage(postIds)` — フィード 1 ページの周辺データを 1 RPC で
- `useFeed()` — base posts query (cursor pagination)
- `useFeedRealtime(postIds)` — feed 全体の realtime subscription (★ 必ず feed.tsx から起動)
- `useReactions(postIds)` / `useReactionToggle()` — legacy reactions (RPC fallback)
- `useLike` / `useConcern` / `useSave` / `useBookmarks` — 各 mutation hook
- `useBBS()` / `useBBSThread(id)` / `useBBSReplyReactions()`
- `useNotifications()` / `useTagRecommendations()` / `useTagSearchV3()` / `useTagFilter()`
- `useUserStamps()` / `useCommunityStamps()` — テキスト stamp
- `useAuth()` (= `useAuthStore`) / `useAdmin()` / `useT()`
- `useNetworkStatus()` / `useOfflineQueueProcessor()` / `useFeatureFlag()`
- `useHaptic()` / `useReducedMotion()` / `useDebounce()`

### lib/
- `lib/api/*.ts` — Supabase クエリは原則ここに集約。component から直接 supabase を叩かない
- `lib/realtime.ts` — `attachChannel(name, build, onStatus)` / `detachAllChannels()`
- `lib/cacheUpdates/feedPagePatcher.ts` — `patchFeedPagePost` / `snapshotFeedPage` / `revertFeedPageSnapshot` / `invalidateFeedPage`
- `lib/utils/queryKey.ts` — `stableKeyFor(sortedIds)`
- `lib/utils/date.ts` — `formatRelative(d)` (Intl で locale 対応)
- `lib/i18n.ts` — `useT()` / `translate()` / `translateDynamic()` / `protectBrandNames()` / `restoreBrandNames()`
- `lib/sanitize.ts` — `sanitizeUrl()` / `escapeHtml()`
- `lib/storage.ts` — 同期 KV (MMKV/localStorage)
- `lib/resilient.ts` / `lib/withApiTimeout.ts` / `lib/swallow.ts`

---

## 13. 用語短縮 (この repo 固有)

- **stamp** = メメ絵文字リアクション (Twitter の絵文字 reactions 相当)
- **scope** = フィード/BBS のフィルタ単位 (All / For Me / Community / Open など)
- **trust score** = 信頼スコア (0-100、ティア: 🌱Newcomer / ✅Trusted / 🏅Verified / 🏆Elite)
- **concern (気になる)** = いいねの逆。低品質投稿を可視化する仕組み
- **CW** = Content Warning (spoiler / nsfw / violence / sensitive)
- **legacy cache** = `['my-likes']` `['my-concerns']` `['reactions']` 等の旧 cache key (RPC 経路登場前)
- **feed-page cache** = `['feed-page', userId, sortedKey]` (`useFeedPage` の RPC cache)
- **official_author** = 公式コミュ管理者が匿名剥奪して名前付きで返信した投稿

---

## 14. 「これは設計上 NG」リスト

- ❌ component から `supabase.from(...)` 直接叩く → `lib/api/*` に通す
- ❌ store 全 destructure (`const { user, hydrated, hydrate } = useAuthStore()`) → selector に
- ❌ `try { } catch { }` (silent) → `swallow('scope', e)` に
- ❌ `as any` (lint error) → `unknown` + type guard
- ❌ 1 channel に複数 table の `.on()` チェーン → `attachChannel` を table 別に複数回
- ❌ EXIF を strip せず生 URI で画像 upload → `prepareImageUpload()` 経由
- ❌ Sentry に email / phone / JWT を渡す → `setSentryUser(id)` の `id` のみ
- ❌ 既存 migration file を編集 → 新 migration 追加で revert
- ❌ master 自動 merge / push → user 明示指示時のみ
- ❌ `key={i}` (FlashList / map の) → 一意な id を key に
- ❌ `service_role_key` をクライアントへ → Supabase Edge / secrets のみ
- ❌ EXPO_PUBLIC_FEED_PAGE_RPC など build-time flag を runtime で動的アクセス (`process.env[key]`) → Expo は static 参照しか inline しない

---

## 15. 仮説検証サイクル (HYPOTHESIS_LOG.md)

`docs/HYPOTHESIS_LOG.md` に **18+ サイクル分** の「案だし → 実装 → プレビュー → 修正」記録あり。新機能着手前に該当領域のサイクル番号があれば必ず読む。Lean Startup 原則:

1. 小さく検証してすぐ捨てる
2. AI に並列で頭を借りる (6-8 agent 並列 audit)
3. セキュリティを後回しにしない
4. 動きは "本当に必要な時だけ"
5. 開発者向け機能 (Obsidian 連携等) は `__DEV__` で gate

---

## 16. ファイル別の "そこに必ずある情報"

| 知りたいこと | 見る場所 |
|---|---|
| 全機能の仕様 | `SPECIFICATION.md` (28 章, 2059 行) |
| デプロイ手順 / env / rollback | `docs/DEPLOY.md` |
| 過去の意思決定 / 学び | `docs/HYPOTHESIS_LOG.md` |
| 配色 / 余白 / 角 / サイズトークン | `design/tokens.ts` |
| アニメ spring / easing / timing | `design/motion.ts` |
| ハプティック設定 | `design/haptics.ts` |
| 絵文字 stamp 候補 | `lib/memes.ts` |
| アカウント停止条件 / trust 計算 | `lib/trust/` + `supabase/migrations/0006_credibility.sql` |
| RLS ポリシー | `supabase/migrations/00XX_*.sql` の `create policy` |
| feed の RPC schema | `supabase/migrations/0041_get_feed_page_rpc.sql` |
| Supabase Edge | `supabase/functions/` |
| feed の cache 書き換え helper | `lib/cacheUpdates/feedPagePatcher.ts` |
| realtime ラッパ | `lib/realtime.ts` |
| Netlify build 設定 | `geek-v4/netlify.toml` ← repo root のは無視される |
| i18n dict | `lib/i18n.ts` の `DICT` 定数 |
| password 強度 | `lib/passwordPolicy.ts` |
| 1 セッション同時 channel 上限 | `lib/realtime.ts` の `MAX_CONCURRENT_CHANNELS` |
| TanStack Query 全体設定 (staleTime/gcTime/retry) | `app/_layout.tsx` の `qc = new QueryClient(...)` |
| Auth redirect 制御 | `app/_layout.tsx` の `useEffect([user, ready, segments])` |
| 起動時 hydrate 並列化 | `app/_layout.tsx` の `Promise.allSettled([...])` |
| 過去の TODO 履歴 | TaskList (大半 completed) |

---

## 17. AI ペアプロとしての心得 (== Claude へ)

このプロジェクトは **「開発者 1 人 + Claude 1 機」** で進めている。だから:

1. **判断を任せ過ぎない**。設計の選択肢は 2-3 並べて user に決めてもらう。
2. **小さく動かす**。「全部 fix」より「1 つ fix して preview → 確認 → 次」が好まれる。
3. **過去の地雷リスト (§ 11) を必ずチェック**。同じ罠を 2 度踏まない。
4. **commit message は内容ベースで何が直ったか書く** (例: `fix(realtime): 1 channel / 1 table に分離して CHANNEL_ERROR 連鎖を回避`)。日本語タイトル + 必要なら英 body。
5. **Co-Authored-By** は `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`。
6. **PR 作成と merge は別**。PR は提案、merge は user の判断。
7. **prod に当たる前にローカル type-check / test を必ず通す**。
8. **「やりすぎ」を恐れる**。1 PR 1 目的。デカい refactor は user に確認。

---

> **最後に — このファイルを更新するタイミング**
>
> - 新しい "そこ覚えてないと地雷" を踏んだ → § 11 に追記
> - 新しいパターン (helper / 規約) を導入した → § 5 に追記
> - リポジトリ構成を大きく変えた → § 3 を更新
> - tech stack を入れ替えた → § 4 を更新
> - 標準コマンドを変えた → § 2 を更新
>
> 仕様の細かい変更は `SPECIFICATION.md` 側に書く。CLAUDE.md は「日々の開発で見るべきもの」だけに絞る。
