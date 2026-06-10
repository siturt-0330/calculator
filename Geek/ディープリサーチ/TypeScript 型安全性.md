---
tags: [research, クリーンコード, typescript, 型安全性]
---

# TypeScript 型安全性

> 「型を **設計の道具** として使い、不正な状態をコンパイル時に排除する」ための原則・パターン・アンチパターン、そして Geek (geek-v4) への適用。一次情報 (TypeScript 公式 / 著名エンジニア記事 / 2023–2026 の知見) を統合したディープリサーチノート。

関連: [[TypeScript 型安全性]] は [[素晴らしいコードとは — 総論]] / [[可読性・保守性]] / [[テスタビリティとテスト戦略]] / [[関数型プログラミングパターン]] / [[データ層・Supabase・RLS・マイグレーション運用]] / [[Zustand・React Query ベストプラクティス]] と密接に関わる。

---

## 定義・原則

**型安全性 (type safety)** = 「型の取り違えに起因するエラーを **実行前 (コンパイル時)** に検出し、実行時に到達しないことを保証する」性質。TypeScript は構造的型システム + 漸進的型付けなので、安全性は「設定」と「書き方」で大きく上下する。デフォルトでは穴だらけ、`strict` 系を入れて初めて本領を発揮する。

### 核となる 5 原則

1. **`strict: true` を最初から入れる。** これは単一フラグではなく複数フラグのシュガー。strict なプロジェクトは型起因バグの本番到達が約 40% 少ないという報告がある (oneuptime)。`strict` が束ねるもの:
   - `strictNullChecks` — `null` / `undefined` を他の型に勝手に代入できなくする (最重要)。
   - `noImplicitAny` — 暗黙の `any` を禁止 (型を書かせる)。
   - `strictFunctionTypes` — 関数引数の反変チェック。
   - `strictPropertyInitialization` — クラスフィールドの初期化漏れ検出。
   - `strictBindCallApply` / `useUnknownInCatchVariables` (catch 変数が `unknown`) / `alwaysStrict` / `noImplicitThis` ほか。
2. **`noUncheckedIndexedAccess` を足す (strict には含まれない別フラグ)。** 配列・index signature アクセスの結果型に `undefined` を加える。`arr[0]` が `T` ではなく `T | undefined` になり、「存在しない添字」に起因する `Cannot read property of undefined` を型で潰す。
3. **`any` を書かない。** `any` は型チェックを伝播的に無効化する。代替は **`unknown` + 型ガード** か **ジェネリクス**。Geek は `@typescript-eslint/no-explicit-any: 'error'` で機械的に禁止 (`.eslintrc.js:15`)。
4. **不正な状態を表現不能にする (Make Illegal States Unrepresentable)。** 実行時バリデーション・ドキュメント・規律に頼らず、**型システムそのものを強制機構** にする。コンパイラが不正状態を拒否すれば、その状態は実行時に存在し得ない (deviq / Chris Krycho)。主な道具が **判別可能 union (discriminated union)**。
5. **推論できるものは書かない / ドメインは型で表す。** 冗長な注釈は推論に任せ、一方で「ただの `string`」を **branded type** や **literal union** に昇格させてドメイン制約を型に載せる。「型で表現された業務ルールは自己文書化され、ルール変更が即 breaking change になる」(Chris Krycho)。

---

## 具体例 (コードブロック)

### 1. `strictNullChecks` — null 安全

```ts
// strictNullChecks OFF: これがコンパイルを通り、実行時に爆発する
function greet(name: string) { return name.toUpperCase(); }
greet(null); // OFF なら通る / ON なら型エラー

// ON: null 可能性を型に持たせ、ナローイングを強制する
function greet2(name: string | null) {
  if (name == null) return 'anon';   // ここでナロー → 以降 name: string
  return name.toUpperCase();         // safe
}
```

### 2. `noUncheckedIndexedAccess` — 添字アクセスの undefined

```ts
const xs: number[] = [1, 2, 3];
const first = xs[0];        // フラグ OFF: number / ON: number | undefined
// first.toFixed();         // ON ではエラー (undefined かもしれない)
if (first !== undefined) first.toFixed(); // ナローして使う

// index signature にも効く
interface Env { NAME: string; [k: string]: string }
declare const env: Env;
env.NAME;      // string (宣言済み)
env.NODE_ENV;  // string | undefined (index 経由) ← フラグ ON の効果
```

注意 (公式 issue #46273): **配列リテラルへの直接 index (`([1,2,3])[number]`) では `undefined` が付かない**ケースがあり、完全な保証ではない。それでも実害の大半 (動的 index / 範囲外) を捕まえるので入れる価値は大きい。`.at()` は元から `T | undefined` を返すので安全側。

### 3. 判別可能 union で「不可能な状態」を消す

```ts
// ❌ boolean の組合せ: 4 通りのうち 2 つは無意味 (loading かつ error 等)
type State = { loading: boolean; error?: Error; data?: User };

// ✅ discriminated union: 取り得る状態が厳密に 3 つだけ
type State =
  | { status: 'loading' }
  | { status: 'error'; error: Error }   // error はこの枝にしか無い
  | { status: 'success'; data: User };  // data はこの枝にしか無い

function render(s: State) {
  switch (s.status) {                   // 判別子は literal 型である必要がある
    case 'loading': return spinner();
    case 'error':   return s.error.message; // s は自動で error 枝にナロー
    case 'success': return s.data.name;
    default:        return assertNever(s);  // 網羅性チェック
  }
}
// 全 case を尽くすと s は never に絞られる。case を足し忘れると型エラー。
function assertNever(x: never): never { throw new Error(`unhandled: ${JSON.stringify(x)}`); }
```

落とし穴 (Convex / atomicobject): **判別子をチェックする前に分割代入するとナローが効かない**。`const { status } = s` してから `switch (status)` ではなく、`switch (s.status)` のように **オブジェクト上の判別子を直接** 見て、ナローされた枝の中で分割代入する。`noFallthroughCasesInSwitch` を併用すると case 抜けも防げる (Geek は ON)。

### 4. branded types — 構造的型に nominal な区別を持ち込む

```ts
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

type UserId = Brand<string, 'UserId'>;
type PostId = Brand<string, 'PostId'>;

// smart constructor で 1 箇所だけ as を許す (= 検証の入口を集約)
const UserId = (s: string): UserId => s as UserId;

declare function fetchUser(id: UserId): Promise<User>;
const pid: PostId = '123' as PostId;
// fetchUser(pid);          // ❌ PostId は UserId に代入不可 (両方 string でも別物)
fetchUser(UserId('123'));   // ✅
```

`__brand` は **型レベルのみ**。実行時には素の `string` で、メモリ・速度コストはゼロ (Osytek)。ID の取り違え・単位 (円 vs ドル) ・未検証/検証済みの区別に効く。

### 5. `unknown` + 型ガードで `any` を駆逐する

```ts
// 外部入力 (JSON / fetch) は any でなく unknown で受ける
function parseUser(json: unknown): User {
  if (
    typeof json === 'object' && json !== null &&
    'id' in json && typeof (json as { id: unknown }).id === 'string'
  ) {
    return json as User; // ガードを通った後でだけ絞り込む
  }
  throw new Error('invalid user');
}
```

### 6. `as const` + `satisfies` — 値とリテラル型を両立

```ts
// as const: 値を readonly な literal tuple/object に凍結 (ワイドニング防止)
const SORTS = ['hot', 'new', 'top'] as const;
type Sort = typeof SORTS[number]; // 'hot' | 'new' | 'top'

// satisfies: 「この型に適合する」ことだけ検査し、リテラルの絞りは保持する
const palette = {
  primary: '#7C6AF7',
  danger: '#F87A7A',
} satisfies Record<string, `#${string}`>;
palette.primary; // 型は '#7C6AF7' (string に広がらない)。: アノテーションだと広がる
```

---

## よくあるアンチパターン

| アンチパターン | 何が問題か | 正しい型での書き方 |
|---|---|---|
| `any` の濫用 | 型チェックが**伝播的に**無効化され、その値を触る全コードが無検査に | `unknown` + 型ガード、またはジェネリクス |
| `as Foo` での力技キャスト | コンパイラの推論を握り潰す。間違っていても黙る | `satisfies`、smart constructor で **1 箇所だけ** as |
| `value!` (non-null assertion) の多用 | `strictNullChecks` の保証を口約束で外す | `if (value == null) return` で正しくナロー |
| boolean フラグの組合せで状態管理 | `isLoading && hasError` のような**不可能状態**が表現できてしまう | 判別可能 union (`status: 'loading' \| 'error' \| ...`) |
| `string` / `number` で全 ID を表す | `userId` と `postId` を取り違えても型が通る | branded types |
| 関数戻り値・public API を推論任せ | 実装変更で戻り型が静かに変わり、呼び出し側に波及 | **公開境界には明示注釈** (内部ローカルは推論で可) |
| `enum` を安易に使う | 実行時オブジェクトを生成し tree-shake されにくい・`const enum` は isolatedModules で罠 | `as const` + union 型で代替 |
| 判別子を分割代入してから switch | ナローイングが効かず全枝で union のまま | `switch (obj.kind)` をオブジェクト上で直接 |
| `@ts-ignore` で握り潰す | 次行の**全エラー**を無言で消す。型の変化に気づけない | `@ts-expect-error` (エラーが消えたら逆に警告) + 理由コメント |
| `catch (e)` を `any` 前提で `e.message` | strict では `e` は `unknown`。`.message` は型エラー | `e instanceof Error ? e.message : String(e)` |

---

## ★Geek への適用

Geek (geek-v4) は **型安全性に振った設定** をすでに採用している。実ファイルでの現れ方と、さらに伸ばせる余地を具体的に挙げる。詳細運用は [[地雷・落とし穴 総覧]] / [[可読性・保守性]] も参照。

### A. tsconfig — strict + noUncheckedIndexedAccess は採用済み

`geek-v4/tsconfig.json` (実物):

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,                     // null/any/関数反変 などを一括 ON
    "noUncheckedIndexedAccess": true,   // arr[0] は T | undefined
    "noImplicitOverride": true,         // override 漏れ検出
    "noFallthroughCasesInSwitch": true, // switch の case 抜け検出 (union の網羅と相性◎)
    "exactOptionalPropertyTypes": false // ← ここだけ緩い (後述)
  }
}
```

- `CLAUDE.md §6` にも明記: 「TypeScript **strict** + `noUncheckedIndexedAccess`。`array[0]` は `T | undefined` 扱い」「`no-explicit-any: 'error'`。`any` は基本書かない。やむを得ない時は `unknown` 経由で型ガード」。
- **commit 前ゲート**: `npm run type-check` (= `tsc --noEmit`) が CI (`.github/workflows/ci.yml`) で毎 PR 実行される。型エラーはマージ前に必ず潰れる。
- **伸びしろ**: `exactOptionalPropertyTypes: false` のため、`video_urls?: string[]` のような optional に `undefined` を明示代入できてしまう (`{ video_urls: undefined }` が通る)。`models.ts` は optional フィールドが非常に多いので、ここを `true` にすると「キー欠落」と「値が undefined」を区別でき、サーバ JSON との齟齬をさらに締められる (ただし既存コードの修正量は要見積もり = 小さく検証して入れる案件)。

### B. 文字列 literal union でドメインを型に載せている

`geek-v4/types/models.ts` は **「ただの string」を避けて literal union でドメインを表現** している好例:

```ts
export type PostKind = 'fact' | 'opinion' | 'joke' | 'wip';
export type AccountState = 'healthy' | 'caution' | 'restricted' | 'warned' | 'suspended';
export type PostVisibility = 'private' | 'public' | 'community_only' | 'community_public';
export type CWCategory = 'spoiler' | 'nsfw' | 'violence' | 'sensitive' | null;
export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';
```

これにより `kind: PostKind` のような **凝集した制約** が型に入り、`'fakt'` のような typo はコンパイルで落ちる。`design/tokens.ts` のグラデは `[...] as const` の readonly tuple で固定し、consumer が要素数・順序を壊せないようにしている (`primary: ['#7C6AF7','#B47AF7','#F87AB4'] as const`)。

### C. 判別可能 union — `Notification.type` がまさにそれ

`models.ts` の `Notification` は **タグ付き union の判別子** を持つ:

```ts
export type Notification = {
  type:
    | 'like' | 'comment' | 'follow' | 'reply' | 'event'
    | 'official_post' | 'mention' | 'announcement'
    | 'join_request' | 'system' | 'mod_action';
  // ...
  data?: Record<string, unknown> | null; // ★ 種別ごとに中身が違うが今は緩い袋
};
```

- **現状**: 通知種別は literal union で網羅的だが、`data` が `Record<string, unknown>` という「何でも入る袋」になっている。コメント上は「join_request は `community_id` / `applicant_user_id` を含む」「mod_action は `community_id` / `action` / `reason`」と種別ごとにペイロードが決まっているのに、型はそれを表現していない。
- **改善 (Make Illegal States Unrepresentable)**: `type` と `data` を **1 つの判別可能 union** に束ねると、「join_request なのに community_id が無い」状態が表現不能になる:

  ```ts
  type Notification =
    | { type: 'join_request'; data: { community_id: string; applicant_user_id: string } }
    | { type: 'mod_action';   data: { community_id: string; action: string; reason: string } }
    | { type: 'system';       data?: null }
    | { type: 'like' | 'comment' | 'follow' /* ... */; data?: null };
  // 通知遷移ロジックで switch (n.type) すれば、data が枝ごとに自動ナローされる。
  ```

  遷移先を出す処理を `switch (n.type)` + `default: assertNever(n)` にすれば、`noFallthroughCasesInSwitch` (採用済み) と相まって **種別追加時の対応漏れがコンパイルで露見** する。これは [[Admin Console (運営管理)]] の通知導線・[[Realtime]] の通知配信とも噛み合う。

### D. ジェネリクスで API 契約を 1 つに

`geek-v4/types/api.ts` は薄いが本質的:

```ts
export type PaginatedResponse<T> = {
  data: T[];
  nextCursor: string | null;
};
```

カーソルページングの形を **ジェネリクスで 1 回だけ定義** し、`PaginatedResponse<Post>` のように再利用する。[[フィード・ランキング・レコメンド]] の cursor pagination がこの契約に乗る。

### E. 交差型 (`&`) で「基底 + viewer 相対」を合成

`lib/api/feedPage.ts`:

```ts
export type FeedPagePost = Post & {
  // viewer 相対の派生フィールド (my_like など) を Post に足す
};
```

- **基底ドメイン型 `Post`** に**閲覧者依存の派生** を交差型で重ねる設計。`models.ts` の `Post` を single source とし、フィード文脈固有の追加だけを局所化している。
- `lib/cacheUpdates/feedPagePatcher.ts` の部分パッチ型も型安全:
  ```ts
  type Patch = Partial<FeedPagePost> | ((post: FeedPagePost) => FeedPagePost);
  ```
  `Partial<T>` で「任意キーだけ更新」を、関数版で「現値から算出」を、どちらも `FeedPagePost` の形に縛って表現している。[[State管理 (Zustand・React Query)]] / [[Zustand・React Query ベストプラクティス]] の楽観更新と直結。

### F. `unknown` + キャストで外部境界を扱う (が、ここが穴になり得る)

`lib/api/account.ts` (データエクスポート) は外部形が読めない領域を `unknown` で受けている:

```ts
posts: unknown[];
comments: unknown[];
// ...
profile: (profileRes.data as Record<string, unknown> | null) ?? null,
```

- **良い点**: `any` ではなく `unknown[]` を使い、`no-explicit-any: error` を守っている。「正体不明なものは触れない箱に入れる」原則どおり。
- **注意 (de-anon と直結)**: `account.ts` の export は `author_id` を直読みしているため、[[匿名性設計と de-anon ホール]] / `project_geek_v4_post_column_hole` の **migration 0138 (author_id REVOKE 是正) のブロッカー** になっている。型を `unknown` で逃がしている箇所こそ、サーバが返すマスク済みフィールド (`pseudonym_id` / `is_own` / `avatar_*`) に**型レベルで寄せる** と、`author_id` 直参照が型エラーで炙り出せる。`models.ts:44` の `author_id?` を将来 deprecated コメント付きで縛り、新規参照を増やさない運用が有効。
- `lib/clipboardImage.ts:38` / `lib/media.ts:178` の `as unknown as {...}` は **二段キャスト** (構造的に非互換な型を無理やり変換するときの定石)。これは「ブラウザ API の欠けた型を補う」用途で、乱用ではないが grep 可能な形 (`as unknown as`) にして監査対象を可視化している。

### G. Geek 流の型安全チェックリスト (新規コードで守る)

- [ ] 新しいドメイン値は `string` でなく **literal union** か **branded type** にできないか考える (`models.ts` のスタイルに揃える)。
- [ ] 「状態」を boolean 複数で持っていないか → **判別可能 union** + `switch` + `assertNever`。
- [ ] `any` / `as Foo` を書きそうになったら **`unknown` + 型ガード** か **`satisfies`** に置換 (`no-explicit-any: error` で lint が止める)。
- [ ] 配列/オブジェクト index は `T | undefined` 前提 (`noUncheckedIndexedAccess`) — `?.` / `?? fallback` / 明示ナローで受ける。
- [ ] 公開 API (`lib/api/*`) の戻り型は**明示注釈**。内部ローカルは推論に任せる。
- [ ] `catch (e)` は `e` を `unknown` として扱い `e instanceof Error` で絞る (Geek の `swallow('scope', e)` 経路もこの前提)。

---

## 出典 (URL一覧)

- TypeScript 公式 — TSConfig: noUncheckedIndexedAccess: <https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html>
- TypeScript 公式 — TSConfig Reference (全フラグ): <https://www.typescriptlang.org/tsconfig/>
- TypeScript 公式 — Everyday Types (Union Types): <https://www.typescriptlang.org/docs/handbook/2/everyday-types.html>
- microsoft/TypeScript Issue #46273 — noUncheckedIndexedAccess の型レベル限界: <https://github.com/microsoft/TypeScript/issues/46273>
- Chris Krycho — Making Illegal States Unrepresentable—In TypeScript: <https://v5.chriskrycho.com/journal/making-illegal-states-unrepresentable-in-ts/>
- DevIQ — Make Illegal States Unrepresentable: <https://deviq.com/principles/make-illegal-states-unrepresentable/>
- Convex — Discriminated Union (TypeScript Guide): <https://www.convex.dev/typescript/advanced/type-operators-manipulation/typescript-discriminated-union>
- Atomic Object — Make Better Use of Discriminated Unions: <https://spin.atomicobject.com/2021/11/10/discriminated-unions-typescript-project/>
- DEV (whoffagents) — Branded Types, Discriminated Unions, and Exhaustive Checks: <https://dev.to/whoffagents/advanced-typescript-patterns-branded-types-discriminated-unions-and-exhaustive-checks-3go5>
- Maciej Osytek (Medium) — TypeScript nominal typing and branded types: <https://medium.com/@maciej.osytek/typescript-nominal-typing-and-branded-types-38ec8160f7b4>
- oneuptime — How to Enable and Use TypeScript Strict Mode Effectively: <https://oneuptime.com/blog/post/2026-02-20-typescript-strict-mode-guide/view>
- DEV (gabrielanhaia) — TypeScript's noUncheckedIndexedAccess: Turn It On, See What Breaks: <https://dev.to/gabrielanhaia/typescripts-nouncheckedindexedaccess-turn-it-on-see-what-breaks-8lh>
- Flux.ai — Adapting TypeScript Codebase for noUncheckedIndexedAccess: <https://www.flux.ai/p/blog/convert-your-typescript-codebase-to-no-unchecked-indexed-access>
- DEV (tarunmj6) — Type-Safe By Design: Architecting Applications That Make Bugs Impossible: <https://dev.to/tarunmj6/type-safe-by-design-architecting-applications-that-make-bugs-impossible-2fi7>
