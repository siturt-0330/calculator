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

### 🔬 根本原因には [実証済]/[仮説] タグ + 検証方法を添える (誤診の再発防止)

- 「これが原因だ」と書く/伝える前に **根拠の強さを明示** する。CLAUDE.md §11 や commit message・PR で原因を書くときは次のタグを付ける:
  - **[実証済]** = 実測 / 再現 / テストで切り分け済み。横に「どう検証したか」(計測コマンド・preview eval・落ちるテスト名など) を 1 行添える。
  - **[仮説]** = まだ実測していない。直す前に最小の検証 (一発で切り分くコマンド or テスト) を回す。
- 過去に「画像が縦長/潰れる」を **EXIF orientation のせいと誤診** して `[{rotate:0}]` / `format=origin` を足したが直らなかった事故がある (真因は §5.10 の `resize=cover`)。**「いかにもそれっぽい原因」を推測で確定させない**。実測してから書く。検証手段は §5.10 末尾 (image-size 実測 / preview の naturalWidth 比較) を雛形に。

### 🔁 壊れた / 未実行のツール呼び出しは「黙って自動再実行」(2026-06-10 ユーザー明示)

- ツール呼び出しが malformed / 未実行になったら (例: 「Your tool call was malformed and could not be parsed. Please retry.」/ 生テキスト化して実行されない)、**ユーザーに尋ねず・止まらず・謝罪を並べず、黙って正しい構文で即・自動再実行する (毎回)**。ユーザーがこの挙動を強く支持し「これからも必ず起きるから絶対に忘れないで」と明言した恒久ルール。
- ただし **「本物の失敗」(permission denied = ユーザーが拒否 / 実エラー / 非ゼロ終了) は対象外** — 盲目的に再試行せず原因を診断する。自動再実行するのは「自分の書式ミスで未実行になった呼び出し」だけ。

### 🔒 Geek イントロ / 起動スプラッシュは【確定版・変更禁止】(2026-06-06 確定)

「Geek」起動演出 = **(A) 起動スプラッシュ**(`scripts/web-postbuild.mjs` が `dist/index.html` に注入する素 HTML/CSS の `#geek-splash`、JS 到着前から表示)+ **(B) イントロ**(`components/ui/IntroAnimation.tsx`、アプリ mount 後に表示)。この 2 つは **「同じ寸法・同じ演出」で完全一致** させてある(スプラッシュ→イントロ→本体が seam なく繋がるため)。**ユーザが「これで固定」と確定した最終版。デザイン・寸法・タイミングを勝手に変えない。**

確定値(A と B で必ず一致させる):
- 背景 `#0a0a0a` / ワードマーク文字「Geek」
- グラデ `linear-gradient(120deg, #7C6AF7 0%, #B98CFF 48%, #E891C7 100%)`(single source = `design/typography.ts` の `GEEK_GRADIENT_CSS`)
- font: Apple system stack(`LOGO_FONT`)/ **weight 800**(★ `LOGO_FONT_WEIGHT`=700 ではない)/ size **46px** / line-height **1.0(=46)** / letter-spacing **-1px**
- 進捗バー: 外枠 幅 **132** 高 **3** `radius:99` 背景 `rgba(255,255,255,.08)` / 内側 幅 **38%(≈50px)** グラデ `#7C6AF7→#E891C7` / word の下 `margin-top:24`
- 明滅 pulse: opacity 1→0.5 / **1600ms** / ease-in-out。バー sweep: translateX `-130%→360%` / **1150ms** / `cubic-bezier(.4,0,.2,1)` / 左→右ループ
- 全体: fade-in(web は 0 / native 280ms)→ バー sweep を必ず **2 周完走**(`SWEEPS_BEFORE_EXIT`=2 × `SWEEP_MS` 1150 = **2300ms 表示**、退場は sweep にアンカーしバー右端到達と同時)→ fade-out 320ms ≈ 体感 **~2.6s** / 画面タップで skip
  - ★「**Geek の下のバーが左→右を完走するまで必ず表示**」をコードで保証(退場 = `SWEEPS_BEFORE_EXIT × SWEEP_MS`。`FADE_IN+HOLD` のような sweep 非依存値に戻すと途中でブツ切り=短すぎ違和感が再発)。短すぎ修正 2026-06-06。

reduce-motion(必須挙動):
- fade(in/out/skip)は **必ず `ReduceMotion.Never`** で動かす(system RM 下で duration が 0 に潰れ「1 フレーム点滅して消える」事故を防ぐ)。
- pulse/sweep は **停止**し、バーは見える位置で静止(splash の `translateX(85%)` 相当 = `RM_SWEEP≈0.44`)。
- HOLD は **`setTimeout`**(`withDelay` は system RM 下で 0 に潰れるため使わない)。

実装の前提(壊すと seam / 事故):
- web のグラデ文字は CSS `background-clip:text`(react-native-web 0.19.13 で DOM へ通ることをソース確認済。`color:transparent` + `backgroundImage` + `backgroundClip` + `WebkitBackgroundClip` + `WebkitTextFillColor` の 5 プロパティはセットで必須)。native はワードマークのみ単色 `#B98CFF` フォールバック(バーは native もグラデ)。native グラデ文字は実機検証が要るため follow-up。
- `web-postbuild.mjs` に **Service Worker を足さない**(古い shell 残存事故。[[project_geek_v4_web_freshness]])。`#geek-splash` 除去(MutationObserver + 12s safety)・idempotent marker(`geek-splash-style`)を壊さない。
- `IntroAnimation` の `onComplete` / `markIntroShown`(no-op stub・export 維持)/ skip / safety timer の契約は `app/_layout.tsx` 互換。二重発火させない(`completedRef`)。
- 回帰防止テスト **`tests/unit/introSplashLock.test.ts`** が A↔B の固定値一致を assert する。寸法/色/タイミングを変えたら落ちる。**意図的に変える時は (A) splash と (B) intro を必ずペアで直し、このテストの期待値も同値に更新**してから preview で seam が出ないことを確認する。

🚫 「改善」名目で単独変更しない。フル仕様は `components/ui/IntroAnimation.tsx` 冒頭コメント + `design/typography.ts` のコメントが正。

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
npm run build:web          # Netlify が走らせるのと同じ command。
                           # = expo export --platform web --output-dir dist
                           #   && node scripts/web-postbuild.mjs (#geek-splash 注入。§0 で変更禁止)

# Supabase
supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > types/supabase.ts
supabase db push --linked
supabase functions deploy <name>
```

CI (**repo root** の `.github/workflows/ci.yml`。アプリは `geek-v4/` にあるが GitHub Actions は repo root の `.github/workflows/` しか実行しないため、workflow は root 配置 + `defaults.run.working-directory: geek-v4` で動かす。`setup-node` の cache は `cache-dependency-path: geek-v4/package-lock.json` を明示) は `type-check + test` を毎 PR で実行 (`paths` フィルタ `geek-v4/**` で geek-v4 配下の変更時のみ起動)、master push / 手動 `workflow_dispatch` のみ `build:web` smoke test。

> ⚠️ 旧 `geek-v4/.github/workflows/` 配下に置くと Actions が拾わず CI が一切走らない (過去そうなっていた)。CI 定義は必ず **repo root** の `.github/workflows/` に置く。

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
  (tabs)/               メイン 4 タブ (feed / search / community / mypage) + 投稿 FAB
                        ※ _layout.tsx の Tabs.Screen は feed/search/community/mypage の 4 つだけ。
                        ※ bbs.tsx は (tabs)/ に存在するが Tabs.Screen 未登録 = タブバーには出ない
                          (bbs スレ画面のルーティング用。掲示板は「タブ」ではない)
  onboarding/           【廃止・到達不能 dead code】旧初回設定ウィザード。登録は email+pw のみに簡素化し
                        登録後そのままフィードへ。nickname はサーバが匿名ランダム user_xxxxxxxx (0146) を自動採番、
                        ニックネーム/通知はマイページの FirstRunNudge から後設定。_layout.tsx は /(tabs)/feed へ Redirect
                        (直 URL 露出を封じる)。画面ファイルは harmless dead code として残置 (削除は別 PR)
  post/[id].tsx         投稿詳細, post/create.tsx で作成 (modal)
  bbs/[id].tsx          掲示板スレ詳細, bbs/create.tsx で作成
  settings/             プロフィール編集・通知・プライバシー等
  community/            ※ (tabs)/community/ 配下 (tab bar 保持目的)
  official/             公式コミュ管理画面 (admin 限定)
  admin/                /admin URL 直打ちで隠し管理画面 (運営コンソール)
  notifications/        通知一覧
  mypage/{saved,liked,posts}.tsx
  search.tsx            全文検索 (post/bbs/tag/community/user)
  filter/index.tsx      タグフィルタ管理 (modal)
  _layout.tsx           Root: PersistQueryClientProvider + auth redirect (onboarding 誘導は撤去済 — 常に feed)

components/             再利用 UI (feed/ bbs/ community/ post/ settings/ shared/ ui/ tag/ nav/ ...)
hooks/                  カスタム React Hooks (60+)
lib/
  api/                  Supabase クエリ層 (feedPage / posts / reactions / discovery / friends / albums / ...)
  cacheUpdates/         feedPagePatcher.ts ← React Query cache patch helper
  ai/                   AI 関連 (proposal / suggest)
  search/               全文検索エンジン (variants, similarity, parseQuery, BM25)
  personalize/          For You ランキング (score.ts/events.ts/profile.ts + syncAffinity.ts/impressions.ts → サーバー同期)
  tagClustering/        Algo Phase 1-4 (hub-based cluster + co-occurrence)
  feed/                 feedQuery.ts (base クエリ) + smartRank.ts
  trust/                信用スコア計算 (score.ts)
  utils/                date / color / queryKey / imageUrl / tagSuggest / searchAlgo (+ inline *.test.ts)
  i18n.ts               静的 dict + brand-name 保護 + translateDynamic (MyMemory)。useT() の現用実体はここ
  i18n/                 dictionary 等の補助モジュール (hooks/useT.ts はこちら経由・別系統)
  realtime.ts           ★ attachChannel singleton (Supabase Realtime ラッパ)
  resilient.ts          retry + timeout + Sentry breadcrumb
  withApiTimeout.ts     軽量 timeout 単体
  swallow.ts            try/catch の代替 (breadcrumb 残す)
  supabase.ts           Supabase client (PKCE / native=SecureStore / web=localStorage)
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

stores/                 Zustand (auth / settings / lang / tagFilter / toast / ui / feed / ...)
design/                 tokens.ts (C / GRAD / SP / R / SIZE) + typography / shadows / motion / haptics
constants/              icons.ts (Lucide alias) など
types/                  型定義 (models.ts, api.ts)。supabase.ts は §2 のコマンドで生成 (リポジトリ未コミット)
supabase/
  migrations/           0001 〜 0145 (一部欠番: 0025 / 0124) + complete_schema.sql (時系列, 編集禁止)
  functions/            automod-eval / calculate-trust-score / check-content / og-fetch / og-image /
                        quality-scorer / rank-blender / search-explainer / send-push / suggest-caption (+ _shared)
tests/
  unit/                 Jest 約 40 本 (詳細は §10)。※ E2E (e2e/) ディレクトリは未配備
scripts/                web-postbuild.mjs (build:web の後処理本体・#geek-splash 注入),
                        fix-html.mjs, reset-project.js, seed_dummy*.sql,
                        netlify-build.sh (旧/補助。現行 Netlify ビルドの本線ではない)
docs/                   DEPLOY.md / HYPOTHESIS_LOG.md / STORE_REVIEW.md / UNIVERSAL_LINKS.md / UPGRADE_NOTES.md
SPECIFICATION.md        ★ 仕様の完全版 (2059 行, 28 章)
netlify.toml            ★ Netlify は base=geek-v4 で **この** ファイルを読む (repo root のは使われない)
.npmrc                  legacy-peer-deps=true (Netlify npm ci で peer dep 解決を緩める)
babel.config.js         expo + nativewind + reanimated (production 時 console.log strip)
app.json                Expo config (bundle id app.geek.v4, scheme geek, privacyManifests)
tsconfig.json           strict + noUncheckedIndexedAccess
                        (exclude: supabase/** ・ tests/** ・ **/*.test.ts(x) — jest が別途処理)
.eslintrc.js            no-explicit-any: error, react-hooks rules 有効, react-native lint 一部 off
```

> 主要機能 migration の所在 (範囲が広いので目印): 匿名性マスク 0107/0114/0115・admin console 0118-0123・
> レコメンド (Value Model) 0139-0141・プラットフォーム機能 (引用/ブロック/下書き/スパム) 0142-0145。

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
| Auth | Supabase Auth (PKCE) | storageKey=`geek-v4-auth` / flowType=`pkce`。**session token は Native=SecureStore (iOS Keychain / Android Keystore) で暗号化保存、Web=localStorage**。旧 AsyncStorage の `geek-v4-auth` は native 起動時に破棄 (cleanup) する (`lib/supabase.ts`) |
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
- 上限: 1 セッション同時 **12** channel まで (`MAX_CONCURRENT_CHANNELS`)。超えたら warn して no-op。
- publication 状況 (2026-06 時点):
  - ✅ 登録済: `posts`, `post_reactions`, `likes`, `bbs_replies`, `comments`, `comment_reactions`, `notifications`, `post_added_tags`, `bbs_threads`, `friendships`, `albums`, `album_photos`, `admin_notifications`
    (migration 0008 / 0050 / 0051 / 0052 / 0059付近 / 0121付近 で順次追加)
  - ❌ 未登録: `concerns`, `saves`, `community_stamp_reactions` 等 (subscribe するとそれだけで CHANNEL_ERROR)
  - ※ publication は migration を追って都度更新する。subscribe 前に「その table が publication に入っているか」を必ず確認。
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

- 静的 (UI ラベル) は `lib/i18n.ts` の `DICT` + `useT()` フック。`const t = useT(); t('好きなタグ')` (**日本語キー**)。components はこちらを import (例 `AnonPostCard.tsx`)。
- 動的 (投稿本文等) は `translateDynamic(text, targetLang)` で MyMemory API。
- **ブランド名 "Geek" は絶対に翻訳しない**。`protectBrandNames(src)` で `__GEEKBRAND__` に置換 → API 通過 → `restoreBrandNames(out)` で復元。test は `tests/unit/i18nBrand.test.ts`。
- Web では `document.documentElement.lang = lang` を effect で更新し、ブラウザ翻訳機能を活用 (Native は dict 経路を順次拡充)。
- ⚠️ **useT が二重化している**: `lib/i18n.ts` の useT (日本語キー・現用) と `hooks/useT.ts` の useT (ドットキー `t('common.save')`・`lib/i18n/dictionary` 経由) が並立する別系統。**新規 import は `lib/i18n` の useT を使う** (混在を増やさない)。

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
- ※ auth session の永続化は別経路 (`lib/supabase.ts` の storage adapter = native SecureStore / web localStorage)。§4 Auth 行参照。

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
- bucket 一覧 (4): `avatars`, `community-icons`, `posts-media`, `albums`
  (`albums` は `lib/api/albums.ts` の `ALBUM_BUCKET` / migration 0052・0054・0055 で定義)

### 5.10 Image **display** / サムネ (`lib/utils/imageUrl.ts` `thumbedUrl`) ★ 事故多発

表示は必ず `thumbedUrl()` で Supabase の画像変換 endpoint (`/render/image/public/`) を
経由する (帯域削減)。**ここに踏み抜きやすい罠があるので必ず守る:**

- **🔴 鉄則: `resize=cover` は `height` とセットでしか使わない。**
  Supabase render endpoint に **`width` だけ + `resize=cover`** を渡すと、
  **幅だけ要求値に縮小して高さは元のまま**返す = 画像が水平に潰れる。
  実測 (元 1179x866 横長):
  - `width=480&resize=cover` → **480x866 (aspect 0.55 潰れ)** ❌
  - `width=240&resize=cover` → **240x866 (aspect 0.28 激細)** ❌
  - `width=480&resize=contain` → **480x353 (aspect 1.36 正)** ✅
  → `thumbedUrl` は **height 未指定なら `resize=contain` を既定**にしてある
  (`opts.resize ?? (opts.height ? 'cover' : 'contain')`)。**この既定を壊さない。**
  正方形 crop が欲しい時 (avatar/icon) は `squareThumbedUrl` / `iconThumbedUrl`
  (= `width=height` を渡す) を使う。**生 `thumbedUrl(url, w, {resize:'cover'})` を
  height 無しで書かない。**
- **crop/fit は `contentFit` に任せる。** Supabase からは比率を保った contain ソースを
  もらい、最終的な「枠を埋める / 収める」は expo-image の `contentFit='cover'|'contain'`
  が決める。Supabase 側で cover crop しようとしない (上記の潰れ事故になる)。
- **アスペクト測定パイプライン** (`AnonPostCard.measureAspect` / `FeedMediaGrid`):
  `RNImage.getSize(thumbedUrl(url, 240))` で実寸を測りセル幅を出す。測定 URL も
  上の鉄則に従う (height 無し → contain)。cover を渡すと測定値が縦長に化けて
  「横長写真が縦長/細いセルで出る」症状になる。
- **🚫 [実証済] EXIF を疑う前にこれを疑え。** 「写真が縦長/潰れる」を見ると EXIF orientation を
  疑いがちだが、**アップロードは `prepareImageUpload` で EXIF strip 済み**で原因では
  ないことがほとんど。真因は上記の `resize=cover` だった (2026-06 実測で確定)。
  `[{rotate:0}]` や `format=origin` を足しても **直らない** (どちらも render endpoint を
  通る限り cover の潰れは残る)。
- **検証は推測でなく実測する。** 本番の実画像 URL で寸法を測れば一発で切り分く:
  ```bash
  # object(生) と render(変換) の寸法を image-size で比較
  node -e 'const s=require("image-size").default||require("image-size");const https=require("https");
    const f=u=>new Promise((r,j)=>https.get(u,x=>{const c=[];x.on("data",d=>c.push(d));x.on("end",()=>r(Buffer.concat(c)))}));
    (async()=>{for(const[l,u]of[["object",OBJ_URL],["render+cover",RENDER_URL]]){const d=s(await f(u));console.log(l,d.width+"x"+d.height,(d.width/d.height).toFixed(2))}})()'
  ```
  object が正しい比率 / render+cover が潰れていれば原因確定。preview でも
  `img.naturalWidth/Height` と `getBoundingClientRect()` を eval して
  `cellAspect ≈ natAspect` を確認できる。

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

### Edge Functions (`supabase/functions/`)

| 名前 | 役割 | 注意 |
|---|---|---|
| `check-content` | 投稿前のコンテンツモデレーション | fail-secure (catch で `ok:false`)、Unicode NFKC 正規化 |
| `automod-eval` | 自動モデレーション評価 | |
| `send-push` | Web Push 配信 | 失効 endpoint (404/410) を自動削除 |
| `calculate-trust-score` | 信用スコア再計算 | |
| `og-fetch` | OGP / 公式コミュ URL 取得・所有権検証 | **SSRF 対策はここ**。private / loopback / link-local IP・localhost・`*.local` を拒否。`FETCH_TIMEOUT_MS=6000` (6s) / `MAX_BODY_BYTES=512KB` cap |
| `og-image` | OG 画像生成 | |
| `quality-scorer` | 投稿品質スコア | レコメンド/ランキング用 |
| `rank-blender` | ランキングブレンド | フィード並び替え用 |
| `search-explainer` | 検索結果の説明生成 | |
| `suggest-caption` | キャプション提案 | 将来 AI 統合 |

> 旧ガイドにあった `send-notification` / `verify-official-url` は **存在しない**。公式 URL 検証 (SSRF ガード) は `og-fetch/index.ts` に統合された。

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
| `EXPO_PUBLIC_APP_URL` | 任意 | 招待リンク等の base URL。未設定時は `https://geekboard.netlify.app` (`lib/api/friends.ts`) |
| `EXPO_PUBLIC_FEED_PAGE_RPC` | 任意 | `'0'` でフィード周辺データ RPC (get_feed_page) を kill-switch (既定 ON) |
| `EXPO_PUBLIC_DISCOVERY_RPC` | 任意 | `'0'` で discovery RPC を kill-switch (`!== '0'` で **既定 ON** / `lib/api/discovery.ts`) |
| `EXPO_PUBLIC_HOME_FEED_RPC` | 任意 | `'1'` で home feed 1ページ目集約 RPC (get_home_feed/0114) を有効化。**コード既定 OFF (`=== '1'`)。ただし本番 `netlify.toml` では `"1"` で有効化済** |
| `EXPO_PUBLIC_FOR_YOU_FEED_RPC` | 任意 | `'1'` で Value Model 個人化フィード RPC (get_for_you_feed/0141) を有効化 (★既定 OFF)。0139+0140+0141 migration 適用 + pg_cron 登録後に有効化すること |
| `EXPO_PUBLIC_FLASHLIST_V2` | 任意 | `'1'` で **feed のリストだけ** FlashList v2 (npm alias `flash-list-v2` = `@shopify/flash-list@2`) に切替 (★既定 OFF・パイロット)。v2 は自動測定で `estimatedItemSize` 不要・`maintainVisibleContentPosition` 既定ON。`feed.tsx` で v2 を v1 の型として扱う薄いブリッジ (`FeedListComponent`) にしており余剰 props は無視される。**有効化には実ビルド再起動が必要** (`process.env` は static inline)。native は New Arch 必須 (有効済)、web は v2 の JS 実装。blank率/追従を v1 と A/B 検証する用途。他5リストは v1 (1.7.3) のまま |

> ⚠️ flag の既定方向に注意: `DISCOVERY_RPC` / `FEED_PAGE_RPC` は `!== '0'` で **既定 ON**、
> `HOME_FEED_RPC` / `FOR_YOU_FEED_RPC` は `=== '1'` で **既定 OFF**。パターンをコピペ流用すると意図せず逆になる (§14 参照)。

### 絶対にクライアントに置かない

- `SUPABASE_SERVICE_ROLE_KEY` / `VAPID_PRIVATE_KEY` / `ANTHROPIC_API_KEY` 等 → Supabase secrets / Edge Function 環境変数のみ。

### 配置場所

| 配信先 | どこに |
|---|---|
| ローカル | `geek-v4/.env` (gitignore 済) |
| Web (Netlify) | **`geek-v4/netlify.toml` の `[build.environment]`** ← Netlify は base=geek-v4 で **このファイル** を読む。repo root の `netlify.toml` は使われない。現在 `EXPO_PUBLIC_HOME_FEED_RPC = "1"` で固定 (本番のみ home feed RPC 有効) |
| iOS/Android | `eas.json` の `build.env` または `eas secret:create` |
| Supabase Edge | `supabase secrets set KEY=...` |

`.env` を変えたら Expo dev server を再起動 (`process.env.EXPO_PUBLIC_*` は static 評価)。

---

## 9. デプロイ (詳細は `docs/DEPLOY.md`)

### Web (Netlify)

- master / main に merge すると Netlify が `npm ci && npm run build:web` を実行 → `dist/` を CDN へ。
- `build:web` = `expo export --platform web --output-dir dist` → `node scripts/web-postbuild.mjs` (#geek-splash 注入。§0 の確定版スプラッシュ処理。**変更禁止**)。
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

- Jest (`npm test`) — `tests/unit/` の純関数 unit test が中心 (**約 40 本**)。**新しい純関数 / 純 reducer を書いたら test も追加**。
- E2E: `package.json` に `test:e2e` (`maestro test tests/e2e`) script はあるが、**`tests/e2e/` ディレクトリと Maestro flow (.yaml) は未配備** = 現状走らせても対象ゼロ。E2E を導入する時は flow を新規に作る。
- 代表的なテスト (回帰防止の要):
  - 画像表示: `feedMediaLayout.test.ts` / `cropMath.test.ts` (§5.10 の潰れ回帰を守る)
  - イントロ固定値: `introSplashLock.test.ts` (§0 の A↔B 一致を守る)
  - 滑らかさ固定値: `smoothnessLock.test.ts` (feed/community の FlashList overscan `estimatedItemSize`/`drawDistance`・`decelerationRate="fast"`・root/Tabs の `freezeOnBlur:true`・AnonPostCard の memo を守る。弱めると CI が落ちる。**意図的に値を変える時は実機で blank率/追従/INP を計測してから期待値を更新**)
  - `trustTier.test.ts` (newcomer/regular/probably_nice/definitely_nice/god の境界)
  - `spamDetection.test.ts` / `quotePosts.test.ts` / `sharePost.test.ts` / `automodMatcher.test.ts` / `commentTree.test.ts`
  - ランキング: `feedRanking` / `hotScore` / `rising` / `searchRanking`
  - cache / i18n / key: `feedPagePatcher` / `i18nBrand` / `i18nKeys` / `queryKey` / `tagClustering` / `trending` 等
- ※ unit test は `tests/unit/` だけでなく `lib/` 直下にも同居する (`lib/utils/voteFuzz.test.ts` / `commentDisplay.test.ts` / `lastViewed.test.ts`)。
- TS 設定で `supabase/**` ・ `tests/**` ・ `**/*.test.ts(x)` は tsconfig include から除外 (jest が独自に処理)。`lib/utils` 直下の inline テストもこの glob で除外される。

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
| `a@example.com` ユーザーが登録できない | profiles.nickname の length 制約に違反 | migration 0016 で trigger 関数を堅牢化 (短ければ `_u` 追加、長ければ truncate)。★0146 で handle_new_user は **email を一切使わず匿名ランダム `user_`+8桁hex(13文字)** を採番するよう変更 → email 由来の length 地雷自体が解消 (★0146 は手動適用前提・Netlify は流さない) |
| ハーフカクの「タップ感」 | PressableScale の delayPressIn=130ms + haptic を onPress に紐付け | `delayPressIn=0`, `onPressIn` で haptic, `hitSlop: 8` 標準 |
| Sentry に email / JWT が漏れていた | `beforeSend` redact が無かった | `lib/sentry.ts` の `redact()` + `redactObject()` + `console: false` integration |
| アイコンクロップで EXIF が漏れていた | expo-image-picker の生 URI を直 upload | `lib/image.ts` の `prepareImageUpload()` で EXIF strip + magic-byte 検証 + JPEG 再エンコード |
| realtime channel が増えすぎてクライアント不安定 | 上限なし (旧 20 でも 10 user で Free tier 200 connection を食い潰した) | `MAX_CONCURRENT_CHANNELS = 12` で頭打ち、超えたら warn して no-op |
| search の variants が `===` で組合せ爆発 | 変換軸が増えるたびに掛け算 | `MAX_VARIANTS = 24` cap |
| 「戻るボタンが効かない」事故 | アニメ中の race + ディープリンクで back stack 空 | 200ms in-flight lock + `router.canGoBack()` false なら `/(tabs)/feed` fallback |
| 起動 5 秒「黒画面」 | Splash + intro 合算で 8 秒 | intro を短縮し skip タップ対応。現行確定値は **~2.6s** (sweep 2 周 + fade。§0 の確定版が正、`SWEEPS_BEFORE_EXIT × SWEEP_MS`) |
| フィード画像が一部しか映らない / 横が映らない | ProgressiveImage の ken-burns (scale 1.04→1.0) + overflow:hidden が `contain` 表示時に左右をクリップしていた | `ProgressiveImage.tsx`: `contentFit="contain"` 時は `useKenBurns=false` → scale を 1.0 固定でアニメなし。`feedMediaLayout.ts` の `mediaItemAspect`: 横長/適度な縦長は `{w:containerW, h:naturalH}`、縦長 `naturalH>cap` は `{w:cap×ar, h:cap}` (比例縮小 + `alignSelf:'center'`)。`mediaMaxH = winH × 0.58`・`contentFit="contain"`。cap を上げると画面外 → **0.58 以上には上げない** |
| 横長写真がフィードで縦長/細く表示される・画像が水平に潰れる | **[実証済]** `thumbedUrl` が `resize=cover` を **height 無し** で render endpoint に渡すと幅だけ縮小・高さは元のまま返す (例 1179x866→width=480 で 480x866=aspect 0.55)。`getSize` 測定値も bitmap も潰れる。**EXIF は無関係**(upload で strip 済) | `imageUrl.ts`: height 未指定なら `resize=contain` 既定 (`opts.resize ?? (opts.height ? 'cover':'contain')`)。詳細・実測手順は **§5.10** に集約 |

---

## 12. 主要 hooks / lib のクイックリファレンス

### hooks/ (代表例 — 全 hook は `hooks/` 参照。現在 60+ 本)
- `useFeedPage(postIds)` — フィード 1 ページの周辺データを 1 RPC で
- `useFeed()` — base posts query (cursor pagination)
- `useFeedRealtime(postIds)` — feed 全体の realtime subscription (★ 必ず feed.tsx から起動)
- `useReactions(postIds)` / `useReactionToggle()` — legacy reactions (RPC fallback)
- `useLike` / `useConcern` / `useSave` — 各 mutation hook
- `useBBS()` / `usePostDetail()`
- `useNotifications()` / `useTagRecommendations()` / `useTagSearchV3()` / `useTagFilter()`
- `useUserStamps()` — テキスト stamp
- `useCollections()` / `useCreateCollection()` / `useSaveToCollection()` / `useCollectionPosts()` — ブックマーク(コレクション)。実体は `hooks/useBookmarks.ts`
- `useShare()` / `useBlock()` / `useReport()` / `useDiscovery()` / `useFriends()` / `useAlbums()`
- `useAuth()` (= `useAuthStore`) / `useAdmin()` / `useT()`
- `useNetworkStatus()` / `useOfflineQueueProcessor()` / `useFeatureFlag()`
- `useHaptic()` / `useReducedMotion()` / `useDebounce()`

> ※ hook 名の注意: `useCommunityStamps()` は **hooks/ に実体が無い** (テキスト stamp は `useUserStamps()`)。
> `useBookmarks` という名前の hook は無いが、**ブックマーク機能は `hooks/useBookmarks.ts` に実在** し
> `useCollections()` / `useCreateCollection()` / `useSaveToCollection()` / `useCollectionPosts()` を export する
> (`app/mypage/saved.tsx` で使用 [実証済])。「`useBookmarks()` を呼ぶ」コードは書かない (export 名で呼ぶ)。

### lib/
- `lib/api/*.ts` — Supabase クエリは原則ここに集約。component から直接 supabase を叩かない
- `lib/realtime.ts` — `attachChannel(name, build, onStatus)` / `detachAllChannels()`
- `lib/cacheUpdates/feedPagePatcher.ts` — `patchFeedPagePost` / `snapshotFeedPage` / `revertFeedPageSnapshot` / `invalidateFeedPage`
- `lib/utils/queryKey.ts` — `stableKeyFor(sortedIds)`
- `lib/utils/date.ts` — `formatRelative(d)` (Intl で locale 対応)
- `lib/i18n.ts` — `useT()` / `translate()` / `translateDynamic()` / `protectBrandNames()` / `restoreBrandNames()`。**現用の useT はこれ (日本語キー)**。`hooks/useT.ts` (ドットキー・dictionary 経由) は別系統で並立しているので新規 import は lib/i18n を使う (§5.5)
- `lib/sanitize.ts` — `sanitizeUrl()` / `escapeHtml()`
- `lib/storage.ts` — 同期 KV (MMKV/localStorage)
- `lib/resilient.ts` / `lib/withApiTimeout.ts` / `lib/swallow.ts`

---

## 13. 用語短縮 (この repo 固有)

- **stamp** = メメ絵文字リアクション (Twitter の絵文字 reactions 相当)
- **scope** = フィードの公開範囲フィルタ。`'open'` (全部 + ブロックタグ除外) と `'closed'` (好きタグのみ) の 2 値 — `stores/feedStore.ts` の `FeedScope`。並び順 (for-you / 新着 / 急上昇 / 人気) は別軸の **sort** (`SortMode`)
- **trust score** = 信頼スコア (0-100)。内部 tier は `newcomer`(0-29) / `regular`(30-69) / `probably_nice`(70-89) / `definitely_nice`(90-99) / `god`(100) の 5 段階キーで **境界判定のみ**。**UI 表示は数値スコアのみ** (emoji / 肩書ラベルは撤去済 — `lib/trust/score.ts` L5-14。`tests/unit/trustTier.test.ts` がキーを assert)
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
- ❌ `thumbedUrl(url, w, {resize:'cover'})` を height 無しで書く → 既定 contain を使う (§5.10)
- ❌ Sentry に email / phone / JWT を渡す → `setSentryUser(id)` の `id` のみ
- ❌ 既存 migration file を編集 → 新 migration 追加で revert
- ❌ master 自動 merge / push → user 明示指示時のみ
- ❌ `key={i}` (FlashList / map の) → 一意な id を key に
- ❌ `service_role_key` をクライアントへ → Supabase Edge / secrets のみ
- ❌ EXPO_PUBLIC_FEED_PAGE_RPC など build-time flag を runtime で動的アクセス (`process.env[key]`) → Expo は static 参照しか inline しない
- ⚠️ flag の既定方向を取り違えない: 既定 OFF は `=== '1'` (例 `EXPO_PUBLIC_HOME_FEED_RPC` / `FOR_YOU_FEED_RPC`)、既定 ON は `!== '0'` (例 `EXPO_PUBLIC_DISCOVERY_RPC` / `FEED_PAGE_RPC`)。逆パターンをコピペ流用すると意図せず既定が反転する事故が起きる

---

## 15. 仮説検証サイクル (HYPOTHESIS_LOG.md)

`docs/HYPOTHESIS_LOG.md` に **18+ サイクル分** の「案だし → 実装 → プレビュー → 修正」記録あり。新機能着手前に該当領域のサイクル番号があれば必ず読む。Lean Startup 原則:

1. 小さく検証してすぐ捨てる
2. AI に並列で頭を借りる (6-8 agent 並列 audit)
3. セキュリティを後回しにしない
4. 動きは "本当に必要な時だけ"
5. 開発者向け機能 (Obsidian 連携等) は `__DEV__` で gate
6. **原因は推測でなく実測で確定** ([実証済]/[仮説] タグを付ける。§0)

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
| アカウント停止条件 / trust 計算 | `lib/trust/score.ts` + `supabase/migrations/0006_credibility.sql` |
| RLS ポリシー | `supabase/migrations/00XX_*.sql` の `create policy` |
| feed の RPC schema | `supabase/migrations/0041_get_feed_page_rpc.sql` |
| サムネ/画像表示の resize 規約 (cover 潰れ罠) | `lib/utils/imageUrl.ts` の `thumbedUrl` + CLAUDE.md §5.10 |
| Supabase Edge (SSRF ガードは og-fetch) | `supabase/functions/` |
| feed の cache 書き換え helper | `lib/cacheUpdates/feedPagePatcher.ts` |
| realtime ラッパ | `lib/realtime.ts` |
| Netlify build 設定 | `geek-v4/netlify.toml` ← repo root のは無視される |
| i18n dict | `lib/i18n.ts` の `DICT` 定数 |
| password 強度 | `lib/passwordPolicy.ts` |
| 1 セッション同時 channel 上限 (= 12) | `lib/realtime.ts` の `MAX_CONCURRENT_CHANNELS` |
| TanStack Query 全体設定 (staleTime/gcTime/retry) | `app/_layout.tsx` の `qc = new QueryClient(...)` |
| Auth redirect 制御 | `app/_layout.tsx` の `useEffect([user, ready, segments])` |
| auth session の永続化 (native SecureStore / web localStorage) | `lib/supabase.ts` |
| 起動時 hydrate 並列化 | `app/_layout.tsx` の `Promise.allSettled([...])` |
| 過去の TODO 履歴 | TaskList (大半 completed) |

---

## 17. AI ペアプロとしての心得 (== Claude へ)

このプロジェクトは **「開発者 1 人 + Claude 1 機」** で進めている。だから:

1. **判断を任せ過ぎない**。設計の選択肢は 2-3 並べて user に決めてもらう。
2. **小さく動かす**。「全部 fix」より「1 つ fix して preview → 確認 → 次」が好まれる。
3. **過去の地雷リスト (§ 11) を必ずチェック**。同じ罠を 2 度踏まない。
4. **根本原因は実測で確定する**。「これが原因」と書く前に [実証済]/[仮説] を区別し、検証方法 (計測コマンド / 落ちるテスト / preview eval) を 1 行添える (§0)。EXIF 誤診のような「それっぽい推測の確定」を繰り返さない。
5. **commit message は内容ベースで何が直ったか書く** (例: `fix(realtime): 1 channel / 1 table に分離して CHANNEL_ERROR 連鎖を回避`)。日本語タイトル + 必要なら英 body。
6. **Co-Authored-By** は `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
7. **PR 作成と merge は別**。PR は提案、merge は user の判断。
8. **prod に当たる前にローカル type-check / test を必ず通す**。
9. **「やりすぎ」を恐れる**。1 PR 1 目的。デカい refactor は user に確認。

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
</content>
</invoke>
