---
tags: [research, クリーンコード, state管理, zustand, react-query, tanstack-query, geek]
---

# Zustand・React Query ベストプラクティス

> client state は Zustand、server state は React Query (TanStack Query) — この 2 つを**混ぜない**のが大原則。
> 関連: [[State管理 (Zustand・React Query)]] / [[フィード・ランキング・レコメンド]] / [[認証・セッション]] / [[アーキテクチャパターン (FSD・Atomic・Clean)]] / [[React Native・Expo パフォーマンス最適化]] / [[テスタビリティとテスト戦略]]

---

## 定義・原則

### そもそも「状態」を 2 種類に分ける

最重要の前提。両者は寿命も同期戦略も違うので**別のツールで扱う**(TkDodo, React Query 公式)。

| 種別 | 中身 | ツール | 同期戦略 |
|---|---|---|---|
| **Server state** | API/DB が真実の源 (投稿, いいね, プロフィール) | TanStack Query | fetch + cache + 自動再検証 (stale-while-revalidate) |
| **Client state** | UI/端末ローカルが真実 (テーマ, 設定, モーダル開閉, ログイン user) | Zustand | 同期的に read/write、必要なら永続化 |

> ❌ アンチパターン筆頭: **server data を `useState`/Zustand にコピーする**。コピーした瞬間に React Query の背景更新を全部失う。TkDodo:「you implicitly opt out of all background updates that React Query does for you」。

### Zustand の原則 (pmndrs 公式 + TkDodo "Working with Zustand")

1. **必ず selector で購読する**。`useStore()` を引数なしで呼ぶと**ストア全体を購読**し、無関係なフィールド変更でも再 render する。
2. **atomic selector を優先**。`(s) => s.bears` のように 1 プリミティブを返す。Zustand は**厳密等価 (`Object.is`)** で変化判定するので、selector が**毎回新しいオブジェクト/配列**を返すと「常に変化」扱いになり無限/過剰 render する。
3. 複数フィールドを 1 オブジェクトで取りたいなら **`useShallow`** (v4 までの `shallow` の後継) で浅い比較に切り替える。
4. **actions と state を分離**。actions は不変 (再生成されない) なので 1 つの object にまとめ、`useStore((s) => s.actions)` で丸ごと取っても再 render コストゼロ。
5. **actions は "setter" でなく "event"**。`setCount(c+1)` でなく `increment()`。ビジネスロジックはストア内に置く。
6. **「custom hook だけ export する」**。生の `useStore` を component に晒さず `export const useBears = () => useStore(s => s.bears)` を公開する。selector の重複も消える。
7. ストアは**小さく複数**でよい (Redux と違い単一ストア強制ではない)。ドメイン単位で分割し、必要なら slices pattern で 1 ストアに合成。

### React Query の原則 (TanStack v5 公式 + TkDodo)

1. **`queryKey` は依存配列**。key が変われば自動で refetch。「queryFn が使う変数は必ず queryKey にも入れる」が鉄則。
2. **`queryKey` は配列で階層的に**。先頭をドメイン prefix にし、粗→細の順 (`['todos'] → ['todos', 'list', filters] → ['todos', 'detail', id]`)。これで**prefix 一致で一括 invalidate** できる。
3. **query key factory** にまとめる (ad-hoc な文字列キーは invalidation を予測不能にする)。
4. **`staleTime` を意図的に設定**。既定は `0` = fetch 直後から stale = mount/focus ごとに背景 refetch。変化の遅いデータは長め (5 分〜時間) にする。
5. **`staleTime` と `gcTime` を混同しない**。`staleTime`=「fresh とみなす時間」、`gcTime`(旧 cacheTime)=「**非アクティブな** query を cache から捨てるまでの時間」。9 割は `staleTime` だけ調整すればよい。
6. **mutation 後は `invalidateQueries`**。invalidate は「stale 印を付けるだけ + 表示中の query だけ背景 refetch」なので安全で効率的。
7. **`setQueryData` は楽観更新/サーバ返り値反映だけに使う**。「queryCache をローカル state manager にするな」(TkDodo)。背景 refetch が手動変更を上書きするため。
8. **`useQuery` を custom hook で包む**。fetch ロジックと UI を分離し、key/型/transform を 1 箇所に集約。

---

## 具体例 (コードブロック)

### Zustand — selector / useShallow / actions 分離

```typescript
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

const useBearStore = create((set) => ({
  bears: 0,
  fish: 0,
  // actions は静的 → 1 つの object に隔離
  actions: {
    increasePopulation: (by) => set((s) => ({ bears: s.bears + by })),
    eatFish: () => set((s) => ({ fish: s.fish - 1 })),
    removeAllBears: () => set({ bears: 0 }),
  },
}));

// ✅ custom hook だけ export。atomic selector。
export const useBears = () => useBearStore((s) => s.bears);
export const useFish  = () => useBearStore((s) => s.fish);
// actions は不変なので丸ごと取っても re-render コスト 0
export const useBearActions = () => useBearStore((s) => s.actions);

// ✅ 複数値を 1 object で取るなら useShallow で浅い比較
const { bears, fish } = useBearStore(
  useShallow((s) => ({ bears: s.bears, fish: s.fish })),
);
```

### React Query — query key factory + queryOptions

```typescript
// 階層キーを 1 箇所に集約 (factory)
export const todoKeys = {
  all:     ['todos'] as const,
  lists:   () => [...todoKeys.all, 'list'] as const,
  list:    (filters: Filters) => [...todoKeys.lists(), filters] as const,
  details: () => [...todoKeys.all, 'detail'] as const,
  detail:  (id: string) => [...todoKeys.details(), id] as const,
};

// v5: queryOptions で type-safe な設定を再利用 (component / loader 共有)
const todoDetail = (id: string) =>
  queryOptions({
    queryKey: todoKeys.detail(id),
    queryFn: () => fetchTodo(id),
    staleTime: 5 * 60 * 1000,   // 5 分は fresh
  });

export const useTodo = (id: string) => useQuery(todoDetail(id));
```

### React Query — 楽観更新 (cache 経由・ロールバック付き)

公式が示す 4 段階: **cancel → snapshot → optimistic set → (失敗時) rollback / (完了時) invalidate**。

```typescript
useMutation({
  mutationFn: updateTodo,
  onMutate: async (newTodo) => {
    // 1) in-flight refetch をキャンセル (楽観 patch が上書きされるのを防ぐ)
    await queryClient.cancelQueries({ queryKey: ['todos'] });
    // 2) ロールバック用に現値を snapshot
    const previousTodos = queryClient.getQueryData(['todos']);
    // 3) 楽観的に cache を更新
    queryClient.setQueryData(['todos'], (old) => [...old, newTodo]);
    return { previousTodos };           // ctx として onError に渡る
  },
  // 4a) 失敗 → snapshot で巻き戻す
  onError: (_err, _newTodo, ctx) =>
    queryClient.setQueryData(['todos'], ctx.previousTodos),
  // 4b) 成功/失敗どちらでも最終的にサーバ真実へ同期
  onSettled: () =>
    queryClient.invalidateQueries({ queryKey: ['todos'] }),
});
```

### invalidate のマッチング (prefix が既定)

```typescript
// prefix 一致 (既定): ['todos'] も ['todos',{page:1}] も両方 stale 化
queryClient.invalidateQueries({ queryKey: ['todos'] });
// 完全一致のみ
queryClient.invalidateQueries({ queryKey: ['todos'], exact: true });
// 述語で柔軟に
queryClient.invalidateQueries({
  predicate: (q) => q.queryKey[0] === 'todos' && q.queryKey[1]?.version >= 10,
});
// refetchType: 'active' = mount 中の query だけ staleTime 無視で即 refetch
queryClient.invalidateQueries({ queryKey: ['feed-page'], refetchType: 'active' });
```

---

## よくあるアンチパターン

### Zustand
- **全 destructure**: `const { user, hydrated, signIn } = useAuthStore()` → ストアのどこか 1 つの変更で全 component 再 render。**Geek で実害が出た筆頭地雷** (§下記)。
- **オブジェクトを返す selector を `shallow` 無しで使う**: `useStore(s => ({a, b}))` は毎回新 ref → 毎 render 再描画。`useShallow` 必須。
- **selector 内で計算した派生配列を返す**: `s => s.items.filter(...)` も新配列。memoize (`proxy-memoize`) するか、生データを返して component 側で計算。
- **生 store を component に直接 import**: テスト・差し替えが効かなくなる。custom hook で包む。
- **actions を state と混ぜて 1 object 購読**: 不要な再 render。actions は別 namespace。

### React Query
- **`staleTime: 0` 放置 → 過剰 refetch**。focus/mount/reconnect ごとに network が走り「もたつき」の原因。
- **queryFn の変数を queryKey に入れ忘れ**: key が変わらず古いデータを返す (cache が更新されない典型バグ)。
- **server data を `useState` にコピー / `useEffect` で同期**: 背景更新を失う。`select` で派生させるのが正解。
- **`setQueryData` をポーリングや background loop から多用**: 「cache をローカル state にする」アンチパターン。背景 refetch と競合。
- **楽観更新で `cancelQueries` を省略**: in-flight refetch が解決した瞬間に楽観 patch を踏み潰す。
- **ad-hoc 文字列キー乱立**: invalidate 対象を取りこぼす/取りすぎる。factory に集約せよ。
- **`gcTime` をいじって fresh を延ばそうとする**: 役割違い。延ばしたいのは `staleTime`。

---

## ★ Geek への適用

Geek は CLAUDE.md §4/§5.2/§5.4 で本ノートの原則を**明文化済み**:
*「State(client)=Zustand … **selector で subscribe**(destructure 禁止 — re-render 連鎖の元)」「State(server)=TanStack Query v5 staleTime 30s / gcTime 2h / refetchOnWindowFocus=false / persist」*。

### QueryClient のグローバル設定 (`app/_layout.tsx` の `qc`)

実コードと根拠コメント:

```typescript
const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,                 // 30s 同一データを再 fetch しない
      gcTime: 1000 * 60 * 60 * 2,        // 24h→2h に短縮: AsyncStorage 使用量 ~75%減 + cold start 高速化
      refetchOnWindowFocus: false,       // tab 戻りの連打抑制
      refetchOnReconnect: 'always',      // 接続復帰時は最新を取る
      refetchOnMount: true,              // 永続 cache 由来の dehydrated は stale 扱い → cold open で自動最新化
      retry: 1,                          // error retry は 1 回 (3 回はうるさい/負荷源)
      retryDelay: (i) => Math.min(1000 * 2 ** i, 30000),
    },
    mutations: { retry: 0 },             // ★ mutation は再試行しない (副作用の二重実行防止)
  },
});
```

- **永続化**: `PersistQueryClientProvider` + `createAsyncStoragePersister`、`maxAge: 2h`、**`buster: PERSIST_BUSTER`('geek-rqcache-v1')**。query の返り値の形 (cache shape) を変えたら buster を bump して古い dehydrated cache を 1 度だけ捨てる ([[運用 — デプロイ・プレビュー・本番反映確認]] / 関連地雷=「更新後も古い画面が残る」)。
- **mutations.retry: 0** は本ノートの「副作用ありは retry しない」原則の体現。CLAUDE.md §5.1 も「副作用あり mutation はリトライしない」と一致。

### Zustand stores (`stores/` 配下) — 1 store 1 file

| store | 役割 | 補足 |
|---|---|---|
| `authStore.ts` | ログイン user / hydrate / signIn・Out | session 復活ロジック ([[認証・セッション]]) |
| `settingsStore.ts` | 言語/通知/reduceMotion 等の永続設定 | MMKV 個別キー保存 |
| `toastStore.ts`, `uiStore.ts`, `videoLightboxStore.ts` | 純 UI state | |
| `tagFilterStore`, `recentCommunitiesStore`, `searchHistoryStore`, `draftStore`, `blockStore`, `offlineQueueStore` … | ドメイン別 client state | 計 20+ ストア = 「小さく複数」原則 |

**selector 購読の徹底** (CLAUDE.md §5.4 の正規例):

```typescript
// ❌ 全 destructure — どこか 1 フィールド変更で全 component re-render
const { user, hydrated, hydrate, signIn } = useAuthStore();
// ✅ selector で必要 field だけ購読
const user        = useAuthStore((s) => s.user);
const hydrated    = useAuthStore((s) => s.hydrated);
const hydrateAuth = useAuthStore((s) => s.hydrate);
```

> **実害の記録** (CLAUDE.md §11): `_layout.tsx` の RootLayout が settings **16 フィールドを全 destructure** していたため、onboarding 中の小変更で navigation tree 全体が再 render → 画面が「かくかく」した。→ selector へ切替で解消。**新規 component は必ず selector**。

#### Geek 固有の差分・改善余地 (本ノートの原則 vs 実装)
- **`persist` ミドルウェアは未使用**。`settingsStore`/`authStore` は zustand `persist` でなく **`lib/storage.ts` (MMKV/localStorage 同期 wrapper)** で手書き hydrate している。理由 = cold start から `async/await` を排除し hydrate を **1ms 以下** にするため (`settingsStore` 冒頭コメント)。`persist` の async storage は bridge round-trip + `JSON.parse` で ~50ms かかっていた。→ **Geek では「`persist` を使え」が必ずしも正ではない**。RN の同期 KV を優先する設計判断。
- **actions と state を分離していない**。Geek の store は `authStore` のように state と action を同階層に置く (`{ user, hydrate, signIn, ... }`)。TkDodo 推奨の `actions:{}` namespace は未採用。selector で個別購読しているため実害は小さいが、「actions 丸ごと購読でゼロコスト」の利点は取れていない → **将来の改善候補**。
- **`useShallow` / `createSelectors` 未使用**。grep で 0 件。現状は atomic selector を都度書く方針。複数フィールドをまとめて返す箇所が増えたら `useShallow` 導入の余地。

### queryKey 設計 (`lib/utils/queryKey.ts` + CLAUDE.md §5.2)

- **配列 + 先頭 prefix**: `['feed-page', userId, sortedKey]` / `['my-likes', sortedIdsJoin]` / `['feed']` / `['community', id, 'feed', sort]`。
- **大量 ID を含む key は hash 化**: `stableKeyFor(sortedIds)` が **50 件以下は `.join(',')` のまま** (debug しやすい)、超えたら **djb2 32bit ハッシュ** で `n<件数>:<base36>` に畳む。200+ ID で key が数 KB に膨らみ devtools が重く・key 比較コストが上がる問題への対策。

```typescript
export function stableKeyFor(sortedIds: string[]): string {
  if (sortedIds.length <= 50) return sortedIds.join(',');
  let h = 5381;
  const s = sortedIds.join(',');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `n${sortedIds.length}:${(h >>> 0).toString(36)}`;
}
```

> ⚠️ 本来 query key は**シリアライズ可能な構造そのもの**を入れるのが公式推奨だが、Geek は ID 配列を **join 文字列** にして入れている (`postIds.slice().sort().join(',')`)。これは「巨大配列を生で key に入れると重い」という実測由来の最適化。sort してから join することで**順序非依存の安定キー**にしているのが要点 ([[パフォーマンス最適化]])。

### 楽観更新 (`hooks/useLike.ts` + `lib/cacheUpdates/feedPagePatcher.ts`)

Geek の `useLike` は公式の `cancel→snapshot→set→rollback→invalidate` をベースに、**Geek 固有の 2 つの罠**を踏まえて拡張してある。

**罠 1: partial-match `setQueriesData` が散発的に伝播しない (react-query v5 で観測)** — CLAUDE.md §5.2/§11。
→ 対策: `setQueriesData` の partial-match 書き込みをやめ、**`getQueriesData` で exact key を列挙 → for-loop で `setQueryData(exactKey, next)`** を逐次呼ぶ。`feedPagePatcher.ts` の `patchFeedPagePost` がこのパターンの共通 helper:

```typescript
// lib/cacheUpdates/feedPagePatcher.ts (要点)
export function patchFeedPagePost(qc, postId, patch) {
  const entries = qc.getQueriesData({ queryKey: [FEED_PAGE_KEY] });   // prefix で列挙
  for (const [exactKey, rows] of entries) {
    if (!Array.isArray(rows)) continue;
    let touched = false;
    const next = rows.map((p) =>
      p.id === postId ? (touched = true, typeof patch === 'function' ? patch(p) : { ...p, ...patch }) : p,
    );
    if (touched) qc.setQueryData(exactKey, next);   // ★ 必ず exact key で書き戻し
  }
}
// snapshot/revert/invalidate(refetchType:'active') も同ファイルに helper 化
```

**罠 2: UI が読む cache と楽観更新する cache のズレ** — CLAUDE.md §11。
→ feed.tsx は **RPC cache (`['feed-page', ...]`)** から `my_like`/`likes_count` を読むのに、旧実装は **legacy cache (`['my-likes']`)** しか更新しておらず「いいねしても反応しない」が発生。`useLike.onMutate` は今**4 系統の cache を同時に patch** する: ① legacy `['my-likes']` ② `['feed']` infinite query ③ `['community', id, 'feed']` 配列 ④ RPC `['feed-page']` (= `patchFeedPagePost`)。

`useLike.onMutate` の**順序の妙** (audit 由来の重要点):
1. **先に snapshot** を取る (in-flight query が flush する前の真値)。
2. **次に optimistic patch を同期適用**。
3. **最後に `cancelQueries` を `await`**。← これを patch **前**に await すると、RQ が内部で同期 cache 書き込みを trigger して snapshot が「cancel 後の値」に汚染される (audit 指摘)。
4. `onError` で 4 系統すべて revert、`onSettled` で `['my-likes']` invalidate + `invalidateFeedPage(qc)` (= `refetchType:'active'`)。

加えて **smart-queue** で連打 race を吸収: in-flight 中の追加 tap は count を加算するだけ、settle 時に余剰 parity が奇数なら net toggle を再 dispatch (`useReactionToggle` と同パターン)。失敗時は再 fire しない (二重トースト防止)。サーバ側は `upsert(onConflict, ignoreDuplicates)` で重複 INSERT を無害化。

### invalidation 戦略
- mutation 完了は **`onSettled` で invalidate** (本ノート原則どおり)。`invalidateFeedPage` は **`refetchType:'active'`** を明示し、mount 中の query だけ staleTime 無視で即 refetch (非表示の query は次回 mount まで遅延 = 効率的)。
- `useLikes(postIds)` の query は `staleTime: 30_000` + `enabled: postIds.length > 0` で、楽観 patch と invalidate が**二重 fetch にならない**よう整合 (prefetch も 30s と揃える)。

---

## 出典 (URL 一覧)

- TkDodo — Working with Zustand: <https://tkdodo.eu/blog/working-with-zustand>
- TkDodo — Practical React Query: <https://tkdodo.eu/blog/practical-react-query>
- Zustand 公式 (pmndrs) GitHub: <https://github.com/pmndrs/zustand>
- Zustand Docs — Learn: <https://zustand.docs.pmnd.rs/learn/index>
- Zustand Discussion #2867 (selectors in v5): <https://github.com/pmndrs/zustand/discussions/2867>
- TanStack Query v5 — Query Invalidation: <https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation>
- TanStack Query — Optimistic Updates: <https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates>
- TanStack Query v5 Best Practices (TanStack Ship): <https://tanstackship.com/blog/tanstack-query-v5-best-practices>
- TanStack Query — Important Defaults: <https://tanstack.com/query/v4/docs/framework/react/guides/important-defaults>
- Managing Query Keys for Cache Invalidation (Wisp): <https://www.wisp.blog/blog/managing-query-keys-for-cache-invalidation-in-react-query>

### Geek 内部参照ファイル
- `geek-v4/app/_layout.tsx` — `new QueryClient(...)` (staleTime/gcTime/retry) + `PersistQueryClientProvider` + `PERSIST_BUSTER`
- `geek-v4/CLAUDE.md` §4 / §5.1 / §5.2 / §5.4 / §11 / §14 — state 規約・地雷集
- `geek-v4/stores/authStore.ts`, `stores/settingsStore.ts` — Zustand + 手書き同期 hydrate
- `geek-v4/lib/utils/queryKey.ts` — `stableKeyFor` (djb2 hash)
- `geek-v4/hooks/useLike.ts` — 楽観 toggle + snapshot/revert + smart-queue
- `geek-v4/lib/cacheUpdates/feedPagePatcher.ts` — exact-key patch / snapshot / invalidate helper
