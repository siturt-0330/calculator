---
tags: [geek, architecture, state, zustand, react-query, tanstack-query, cache]
---

# State管理 (Zustand・React Query)

Geek(geek-v4)の状態管理は **2 層に明確分離** されている。役割が違うので「どっちに置くか」を間違えない。

| 層 | ライブラリ | 何を持つか | 永続化 |
|---|---|---|---|
| **client state** | Zustand 5 | UI 設定・ローカルな一時状態(認証セッション・言語・テーマ・フィード sort/scope・トースト・モーダル開閉) | MMKV(native)/ localStorage(web)を `lib/storage.ts` 経由、一部 AsyncStorage |
| **server state** | TanStack Query v5 | サーバー由来データ(フィード・投稿・リアクション・通知 …)とその cache | `PersistQueryClientProvider` で AsyncStorage に dehydrate |

> 関連: [[Zustand・React Query ベストプラクティス]](総論) / [[アーキテクチャ概要]] / [[フィード・ランキング・レコメンド]] / [[認証・セッション]] / [[データ層・Supabase・RLS・マイグレーション運用]]

---

## 概要

- **client = Zustand / server = React Query** の住み分けが厳格。サーバーから来るものを Zustand に抱えない、UI トグルを React Query に入れない。
- Zustand は **1 store 1 file**(`stores/` 配下に 24 file)。
- **最重要規約: store は selector で購読する。全 destructure は禁止**(`const { user } = useAuthStore()` ではなく `const user = useAuthStore((s) => s.user)`)。destructure すると store のどれか 1 フィールドが変わるたびに全コンポーネントが再 render → 画面が「かくかく」する。CLAUDE.md §5.4 / §14 の明示 NG。
- React Query の全体設定は **`app/_layout.tsx` の `qc = new QueryClient(...)` 1 箇所**(staleTime 30s / gcTime 2h / retry 1 / `refetchOnWindowFocus:false` / `refetchOnMount:true` / `refetchOnReconnect:'always'`)。
- cache の書き換えは **`lib/cacheUpdates/feedPagePatcher.ts`** に集約。react-query v5 の **partial-match `setQueriesData` が散発的に伝播しない** issue を踏んでいるため、**exact key を列挙して `setQueryData` を逐次呼ぶ** のがこの repo の鉄則。

---

## 仕組み・設計(具体ファイルパス付き)

### 1. Zustand store 一覧と分類 (`geek-v4/stores/`)

| 分類 | store | 永続化 | メモ |
|---|---|---|---|
| 認証 | `authStore.ts`(33KB, 最大) | 独自(Supabase Auth session + `readPersistedSession` fallback) | `hydrate()` で `supabase.auth.getSession()`。詳細は [[認証・セッション]] |
| 設定 | `settingsStore.ts` | **MMKV 個別キー(同期, <1ms)** | 16 フィールド。旧 AsyncStorage JSON BLOB から 1 回だけ migrate |
| 言語 | `languageStore.ts` / 旧 `lang` | AsyncStorage(非同期) | `lang` + `autoTranslate`。[[i18n・テーマ・デザインシステム]] |
| フィード | `feedStore.ts` | AsyncStorage(非同期) | `sort: SortMode` / `scope: 'open'|'closed'` |
| トースト | `toastStore.ts` | なし(揮発) | dedup window 1500ms / variant+文字数で表示時間算出 |
| UI | `uiStore.ts` | なし(揮発) | `isPostModalOpen` / `isFilterOpen` だけ |
| タグ | `tagFilterStore.ts` / `tagGraphStore.ts` / `tagCooccurStore.ts` | 一部 persist | likedTags / blockedTags など |
| プラットフォーム機能 | `blockStore.ts` / `draftStore.ts` / `postDraftStore.ts` / `profileVisibilityStore.ts` | 各々 | [[プラットフォーム機能 (引用・シェア・下書き・ブロック)]] |
| その他 | `introStore.ts`(イントロ再生制御) / `videoLightboxStore.ts` / `recentCommunitiesStore.ts` / `searchHistoryStore.ts` / `searchClickStore.ts` / `searchSignalsStore.ts` / `offlineQueueStore.ts` / `adPreferencesStore.ts` / `stampPrefsStore.ts` / `draftsStore.ts` | 各々 | — |

**典型的な store の形**(`uiStore.ts` 全文。ミニマルな見本):

```ts
import { create } from 'zustand';
type UIState = {
  isPostModalOpen: boolean;
  isFilterOpen: boolean;
  setPostModalOpen: (v: boolean) => void;
  setFilterOpen: (v: boolean) => void;
};
export const useUIStore = create<UIState>((set) => ({
  isPostModalOpen: false,
  isFilterOpen: false,
  setPostModalOpen: (v) => set({ isPostModalOpen: v }),
  setFilterOpen: (v) => set({ isFilterOpen: v }),
}));
```

### 2. 個別 selector 購読規約(★ destructure 禁止)

CLAUDE.md §5.4 / §14 で明文化された最重要パターン。

```ts
// ❌ 全 destructure — store のどこか 1 フィールド変更で全 component re-render
const { user, hydrated, hydrate, signIn } = useAuthStore();

// ✅ selector で subscribe — 必要な field だけ購読
const user = useAuthStore((s) => s.user);
const hydrated = useAuthStore((s) => s.hydrated);
const hydrateAuth = useAuthStore((s) => s.hydrate);
```

- 実例: `app/_layout.tsx` の `RootLayout` は元々 settings 16 フィールドを全 destructure しており、onboarding 中の小変更(`notifyLike` 等)で navigation tree 全体が再 render → カクついた。現在は `useAuthStore((s) => s.user)` 等、**全 store を個別 selector** に直してある(同 file 248〜310 行)。
- **action も個別 selector で取る**(`const hydrate = useStore((s) => s.hydrate)`)。action 参照は不変なので安定。
- **store 外からの読み取りは `getState()`**。React の外(prefetch / effect)では subscribe 不要なので `useFeedStore.getState().sort` のように直読みする(`app/_layout.tsx` のフィード prefetch effect が実例)。

#### selector が新オブジェクトを返す時の落とし穴(shallow equality)

`useSearchSignalsStore` で踏んだ実例(`hooks/useFeed.ts` のコメント):セレクタ内で `aggregate()` を呼ぶと毎 render 新オブジェクトが生成され、Zustand の shallow equality が「常に変化した」と判定して無限に再 render する。対策は **生の配列をそのまま購読し `useMemo` で集計** する:

```ts
// ❌ const agg = useStore((s) => aggregate(s.signals));  // 毎回新オブジェクト
const rawSignals = useSearchSignalsStore((s) => s.signals); // 参照が安定
const agg = useMemo(() => aggregate(rawSignals), [rawSignals]);
```

→ 派生値を selector で組み立てたくなったら **`useMemo` に逃がす** か、`zustand/shallow` の `useShallow` を使う(repo では `useFeed.ts` / `app/(tabs)/bbs.tsx` で `useShallow` 使用例あり)。

### 3. React Query 全体設定 — `app/_layout.tsx`

QueryClient は module スコープで 1 個だけ生成(159〜185 行):

```ts
const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,                 // 30s は再 fetch しない (RTT 削減)
      gcTime: 1_000 * 60 * 60 * 2,       // 2h (旧 24h → 短縮。AsyncStorage 使用量 ~75% 減 + 起動高速化)
      refetchOnWindowFocus: false,       // tab 戻りで連打しない
      refetchOnReconnect: 'always',      // 接続復帰時は必ず最新へ
      refetchOnMount: true,              // ★ persist 復元データは stale 扱い → cold open で最新を取り直す
      retry: 1,                          // error は 1 回だけ retry (3 回はうるさい)
      retryDelay: (i) => Math.min(1000 * 2 ** i, 30000), // 指数 backoff
    },
    mutations: { retry: 0 },             // ★ 副作用 mutation は retry しない
  },
});
```

- **`mutations.retry: 0`**: 副作用のある mutation を勝手に再送しない設計(CLAUDE.md §5.1 とも一貫)。like 等の連打吸収は React Query の retry ではなく hook 側の smart-queue で行う(後述)。
- **`refetchOnMount: true` は意図的**。persist から復元(dehydrate)したデータは必ず stale になるので、cold open で自動的に最新を取り直す。これで「起動すると古い画面が残る」を解消した([[運用 — デプロイ・プレビュー・本番反映確認]] / memory `project_geek_v4_web_freshness`)。fresh(30s 以内)な query は再 fetch しないので連打にはならない。

#### queryKey 規約(CLAUDE.md §5.2)

- queryKey は **配列、第 1 要素を prefix**(例: `['feed-page', userId, sortedKey]`、`['my-likes', sortedIdsJoin]`、`['my-communities', uid]`)。
- 大量 ID を含む key は **`stableKeyFor(sortedIds)`** で hash 化(`lib/utils/queryKey.ts`)。50 件以下は join のまま、超えたら djb2 で短縮(無限に長い key を防ぐ)。test: `tests/unit/queryKey.test.ts`。

#### prefetch / prewarm(起動初速)

`app/_layout.tsx` は auth 確定直後に裏でフィードとコミュニティを温める:
- `qc.prefetchInfiniteQuery({ queryKey: feedQueryKey(...) })` — フィード画面 mount 前に同一 key で先読み。`useFeed` が同 key を使うので RQ が dedupe して spinner なしで即表示(430〜451 行)。
- コミュニティ tab は 300ms 後に `prefetchQuery({ queryKey: ['my-communities', uid] })` + メディアサムネ `ExpoImage.prefetch`(458〜497 行)。
- 注意: `feedStore` は AsyncStorage 由来で **非同期 hydrate**。未 hydrate のまま `getState()` すると既定 sort を読み、custom sort の復帰ユーザーで key 不一致 → prefetch が無駄になる。だから **`hydrate()` を await してから実 key で投げる**。

### 4. 永続化(persist)— 2 経路

**(A) React Query cache の persist** — `app/_layout.tsx` の `PersistQueryClientProvider`(662〜665 行):

```ts
const persister = createAsyncStoragePersister({ storage: AsyncStorage });
const PERSIST_BUSTER = 'geek-rqcache-v1';
// ...
<PersistQueryClientProvider
  client={qc}
  persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 2, buster: PERSIST_BUSTER }}
>
```

- **`buster: PERSIST_BUSTER`** が要。query の返り値(cache shape)を変えたら **この文字列を必ず bump** する。古い dehydrated cache を 1 度だけ破棄し「アプリ更新後も古い画面/データが残る」事故を防ぐ。**buster 不在が過去の重大バグだった**(memory `project_geek_v4_web_freshness`: 真因=RQ persist に buster 無 + refetchOnMount false[両方修正済])。
- `maxAge` は gcTime と揃えて 2h。

**(B) Zustand store の永続化** — repo は zustand 公式 `persist` middleware を**ほぼ使わず**、store 内で手書き永続化している:
- **`settingsStore.ts`**: MMKV を **個別キー**(`geek:settings:<field>`)で同期保存。`hydrate()` は `loadSettingsSync()` で同期読み(<1ms)。旧 AsyncStorage JSON BLOB は `migrateLegacySettings()` で 1 回だけ migrate(native のみ、`_migrated_v1` sentinel)。`sanitizeSettings()` で壊れた値を DEFAULTS に矯正してクラッシュを防ぐ。`quietStartHour/EndHour` の null は `'null'` 文字列マーカーで表現(MMKV は null/undefined を区別できないため)。
- **`feedStore.ts` / `languageStore.ts`**: AsyncStorage に JSON 保存(非同期 `hydrate()`)。setter で都度 `AsyncStorage.setItem(...)`(失敗は `swallow('store.xxx.hydrate', e)`)。
- hydrate は `app/_layout.tsx` で **並列**起動: `Promise.allSettled([hydrateAuth(), hydrateSettings(), hydrateLang(), hydrateTagFilter(), hydrateAdPrefs()])`(theme だけ同期なので先に単独で呼ぶ)。1 つ失敗しても他を止めない(`allSettled`)。
- `hydrated: boolean` フラグを持つ store(auth/settings/lang)があり、`RootLayout` の `ready` 判定や redirect ガードに使う。

### 5. cache 書き換え — `lib/cacheUpdates/feedPagePatcher.ts`

フィードの UI は `AnonPostCard` に渡す liked/concerned/saved/reactions/likes_count などを **RPC cache(`['feed-page', userId, sortedKey]`)** から優先的に読む。旧 hook は legacy cache(`['my-likes']` 等)しか更新せず「クリックしても反応しない」事故があったため、**feed-page cache を直接 patch する共通 helper** を用意:

| 関数 | 役割 |
|---|---|
| `patchFeedPagePost(qc, postId, patch)` | 全 feed-page cache を列挙し対象 post を patch(object は shallow merge / function は immutable 更新) |
| `snapshotFeedPage(qc)` | onMutate で snapshot を取る(revert 用) |
| `revertFeedPageSnapshot(qc, snap)` | onError で巻き戻す |
| `invalidateFeedPage(qc)` | onSettled で `refetchType:'active'` invalidate |

**核心パターン(なぜ `getQueriesData` + exact key なのか)**:

```ts
export function patchFeedPagePost(qc, postId, patch) {
  // 1. prefix にマッチする exact key 一覧を取得
  const entries = qc.getQueriesData<FeedPagePost[] | undefined>({ queryKey: [FEED_PAGE_KEY] });
  for (const [exactKey, rows] of entries) {
    if (!Array.isArray(rows)) continue;
    let touched = false;
    const next = rows.map((p) => {
      if (p.id !== postId) return p;
      touched = true;
      return typeof patch === 'function' ? patch(p) : { ...p, ...patch };
    });
    if (touched) qc.setQueryData(exactKey, next); // ← exact key で逐次書き戻し
  }
}
```

> **🔴 react-query v5 の partial-match `setQueriesData` が散発的に伝播しない issue を観測済**(CLAUDE.md §5.2)。だから `setQueriesData([prefix], updater)` を使わず、**`getQueriesData` で exact key を列挙 → `setQueryData(exactKey, next)` を逐次**呼ぶ。この repo 全体の cache 書き換えがこの作法。test: `tests/unit/feedPagePatcher.test.ts`。

### 6. optimistic update の標準フロー(`hooks/useLike.ts` が手本)

CLAUDE.md §5.2:「**snapshot → apply → settled で invalidate → error 時 revert**」。`useLike` の `onMutate` 実装が最も丁寧な実例:

1. **snapshot を先に取る**(patch 前の真値): `prevLikes` / `prevFeed` / `snapshotFeedPage(qc)` / `prevCommunity`。
2. **optimistic patch を同期で適用**(複数 cache を全部): legacy `['my-likes']`(exact-key)/ `['feed']` infinite query の `likes_count` ±1 / `['community', id, 'feed', ...]` 配列 / そして `patchFeedPagePost` で RPC cache の `my_like` + `likes_count`。
3. **patch の後で `cancelQueries`**(`['my-likes']`/`['feed']`/`['feed-page']`/`['community']`)。
   - ⚠️ **順序が重要**: `cancelQueries` を patch の**前に await すると** RQ が内部で flush して snapshot が「cancel 後の値」に汚染される(audit 指摘)。必ず snapshot → patch → cancel。
4. `onError`: ctx の snapshot を全部 `setQueryData` で revert(+ `revertFeedPageSnapshot`)。
5. `onSettled`: `invalidateQueries({ queryKey: ['my-likes'] })` + `invalidateFeedPage(qc)` でサーバー真値に再同期。

**連打対策(smart-queue)**: `mutations.retry:0` なので、連打は hook 側で吸収する。`pending: useRef<Map<postId, count>>` を持ち、初回 tap だけ即 dispatch、in-flight 中の追加 tap は count を加算するだけ。settle 時に余剰 parity が奇数なら net toggle を再 dispatch(`useReactionToggle` と同じパターン)。`wasLiked` は fire 内で **最新 cache から判定**(`readLikedFromCache`)するので INSERT/DELETE の race を防ぐ。

> 同型の optimistic hook: `useConcern` / `useSave` / `useReactions` / `useCommentReactions` / `usePolls` / `useBBS` 等(`hooks/` に 20+ file が `onMutate/onError/onSettled` を使用)。新規 mutation を書くときは `useLike` を雛形にする。

---

## 注意点・地雷

- **🔴 store 全 destructure 禁止**(CLAUDE.md §14 の明示 NG)。`const { user, hydrated } = useStore()` は 1 フィールド変更で全画面 re-render。必ず `(s) => s.user` の個別 selector。新規 component で特に守る。
- **selector が新オブジェクト/配列を返すと無限 re-render**。Zustand の shallow equality に毎回引っかかる。生 state を購読して `useMemo` で派生するか `useShallow` を使う(`useFeed.ts` のコメント参照)。
- **cache 書き換えは `setQueriesData`(partial-match)を使わない**。v5 で伝播しないことがある。`getQueriesData` → exact key `setQueryData` 逐次が repo 標準(feedPagePatcher)。
- **optimistic の `cancelQueries` は patch の後**。前に await すると snapshot が汚染される。
- **`PERSIST_BUSTER` の bump 忘れ = 古い画面残存**。query の返り値 shape を変えたら必ず bump。過去に buster 不在で「起動時に古い画面」事故([[運用 — デプロイ・プレビュー・本番反映確認]])。
- **`refetchOnMount:true` を `false` に戻すな**。persist 復元データが永久に stale のまま残る原因になる(過去事故の片割れ)。
- **mutation を React Query の retry で再送しない**(`mutations.retry:0` を維持)。副作用が二重実行される。連打吸収は hook の smart-queue で。
- **store の persist 経路が混在**: settings=MMKV 同期 / feed・lang=AsyncStorage 非同期。新 store を作るとき「cold start クリティカルパスに乗るか」で MMKV(同期)か AsyncStorage(非同期)かを選ぶ。`lib/storage.ts` の同期 API(`getJson/setJson` 等)を使えば MMKV/localStorage を裏で吸収できる。詳細は [[Zustand・React Query ベストプラクティス]]。
- **prefetch 前に非同期 store は hydrate を await**(feedStore)。未 hydrate `getState()` は既定値を返し key 不一致で prefetch が無駄になる。
- **prefetch / effect 内は subscribe しない**(`useStore.getState()` で読む)。React の外で hook を呼ぶと壊れる。
- (補足)zustand 公式 `persist` middleware はこの repo ではほぼ未採用。手書き永続化(`hydrate()` + setter 保存)が既存スタイルなので、新 store も合わせると一貫する。

---

## 関連

- [[Zustand・React Query ベストプラクティス]] — 一般論・推奨パターン(本ノートは Geek の実態)
- [[アーキテクチャ概要]] / [[機能一覧・仕様サマリー]]
- [[フィード・ランキング・レコメンド]] — feed-page cache / RPC / prefetch の文脈
- [[認証・セッション]] — `authStore` の hydrate / session 復元
- [[i18n・テーマ・デザインシステム]] — `languageStore` / `settingsStore`(theme/reduceMotion)
- [[データ層・Supabase・RLS・マイグレーション運用]] — server state の供給元
- [[Realtime]] — realtime 受信 → cache invalidate の連携
- [[パフォーマンス最適化]] — re-render storm / 起動 hydrate 並列化
- [[地雷・落とし穴 総覧]] / [[運用 — デプロイ・プレビュー・本番反映確認]] — PERSIST_BUSTER / refetchOnMount の過去事故
- [[React Native・Expo パフォーマンス最適化]] — selector による re-render 抑制の一般原理
