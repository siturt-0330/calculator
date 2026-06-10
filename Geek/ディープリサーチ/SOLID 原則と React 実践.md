---
tags: [research, クリーンコード, react, solid, アーキテクチャ]
---

# SOLID 原則と React 実践

> OOP 由来の SOLID 5 原則を、**React の関数コンポーネント + hooks** という宣言的・関数的な世界にどう翻訳するか。
> 「クラス」がない React では原則を字義どおりには適用できない。**コンポーネント=ユニット / props=インターフェース / hooks=依存と振る舞いの抽象** という対応表で読み替えるのが要点。
> 関連: [[素晴らしいコードとは — 総論]] / [[Clean Code 原則]] / [[アーキテクチャパターン (FSD・Atomic・Clean)]] / [[可読性・保守性]] / [[テスタビリティとテスト戦略]] / [[関数型プログラミングパターン]]

---

## 定義・原則

SOLID は Robert C. Martin (Uncle Bob) がまとめた 5 つの設計原則の頭字語。元はクラスベース OOP の文脈だが、**「変更に強く、再利用・テストしやすいモジュール境界の引き方」** という本質は paradigm 非依存で、React にも効く。

| 文字 | 原則 | 一言 | React への翻訳 (関数コンポーネント+hooks) |
|---|---|---|---|
| **S** | Single Responsibility (単一責任) | モジュールが変わる理由は 1 つだけ | 1 コンポーネント = 1 関心事。表示と「データ取得/ロジック」を分離 (ロジックは custom hook へ) |
| **O** | Open/Closed (開放閉鎖) | 拡張に開き、修正に閉じる | 既存コンポーネント/hook を**書き換えず**、composition・render props・custom hook・`...rest` で拡張 |
| **L** | Liskov Substitution (置換可能) | 派生は基底とそのまま差し替え可能 | `Button`→`LinkButton` 等の variant は基底の props 契約を**狭めず**差し替えられる |
| **I** | Interface Segregation (インターフェース分離) | 使わないものに依存させない | props を小さく分割。巨大 props を関心ごとの型に割る／複数 hook に割る |
| **D** | Dependency Inversion (依存性逆転) | 上位/下位とも抽象に依存 | コンポーネントは具体 (fetch / Supabase) でなく**抽象 (custom hook / props で渡る interface / Context)** に依存 |

**なぜ React でも効くのか**: React は「コンポーネント = 関数」という構成で、props がその関数のシグネチャ (= インターフェース)、custom hook が「振る舞いと依存を切り出す手段」になる。だから「クラス」を「コンポーネント/hook」、「メソッド」を「props/フック返り値」に読み替えれば、SOLID の意図はそのまま移植できる ([Konstantin Lebedev](https://konstantinlebedev.com/solid-in-react/), [Persson Dennis](https://www.perssondennis.com/articles/write-solid-react-hooks))。

> 注意 (overengineering): SOLID は「読みやすさ・変更容易性」のための道具であって目的ではない。小さなコンポーネントに DI コンテナや Context を持ち込むのは [[可読性・保守性]] を下げる。Persson Dennis も「complexity が要らない場面で Context 注入を選ぶな、ただの props で十分」と明言している。原則は **痛みが出てから** 適用する。

---

## 具体例 (コードブロック)

### S — Single Responsibility: 表示とデータ取得を分ける

「同じコンポーネントの中でデータを fetch しつつ、その結果を描画する」のは責任が 2 つ。**ロジックは custom hook、表示はコンポーネント**に割る。

```tsx
// ❌ Bad: 1 コンポーネントが「取得」と「表示」を両方持つ (変わる理由が 2 つ)
function UserProfile({ id }: { id: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetch(`/api/users/${id}`).then(r => r.json()).then(setUser); // 取得ロジック
  }, [id]);
  return <div>{user?.name}</div>;                                 // 表示
}

// ✅ Good: 取得は hook、表示はコンポーネント
function useUser(id: string) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetch(`/api/users/${id}`).then(r => r.json()).then(setUser);
  }, [id]);
  return { user };
}

function UserProfile({ id }: { id: string }) {
  const { user } = useUser(id);     // 取得の "how" を知らない
  return <div>{user?.name}</div>;   // 表示だけが責任
}
```

hook 同士でも SRP は効く。ユーザー情報と Todo を 1 つの hook で抱えるのは 2 つのアクターへの責任なので、`useUser` と `useTodoTasks` に割る ([Persson Dennis](https://www.perssondennis.com/articles/write-solid-react-hooks))。

### O — Open/Closed: 基底を書き換えず composition で拡張

```tsx
// ❌ Bad: バリアントが増えるたびに本体を if で増改築 (修正に開いている)
function Button({ variant }: { variant: 'primary' | 'danger' | 'ghost' }) {
  if (variant === 'primary') return <button className="bg-blue" />;
  if (variant === 'danger')  return <button className="bg-red" />;
  // 新 variant のたびにこの関数を編集 → 既存の回帰リスク
}

// ✅ Good: 振る舞いを注入できる形にして、本体は閉じる
type ButtonProps = React.ComponentProps<'button'> & { leftIcon?: React.ReactNode };
function Button({ leftIcon, children, ...rest }: ButtonProps) {
  return <button {...rest}>{leftIcon}{children}</button>; // 拡張点は children / icon / ...rest
}
// 新しい見た目は "包む" ことで足す (本体は無修正)
const DangerButton = (p: ButtonProps) => <Button {...p} className="bg-red" />;
```

hook 版の OCP は「基底 hook を compose する specialized hook を作る」。`useUser` を編集せず `useAdmin` が `useUser` を呼んで admin 機能を足す ([Persson Dennis](https://www.perssondennis.com/articles/write-solid-react-hooks))。

### L — Liskov Substitution: variant は基底の契約を狭めない

```tsx
// 基底の契約: onClick を受け、押せる
type BaseButtonProps = { onClick?: () => void; children: React.ReactNode };

// ❌ Bad: LSP 違反 — onClick を握りつぶし、必須 props を新設して "差し替え不能" にした
function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href}>{children}</a>; // onClick が消えた → Button の場所に置くと壊れる
}

// ✅ Good: 基底 props を全部受け、振る舞いを保ったまま拡張だけ足す
function LinkButton({ href, onClick, children, ...rest }: BaseButtonProps & { href: string }) {
  return <a href={href} onClick={onClick} {...rest}>{children}</a>;
}
```

LSP 違反の典型 ([DEV / Mikhael Esa](https://dev.to/mikhaelesa/liskov-substitution-principle-in-react-2p1n), [Creowis](https://www.creowis.com/blog/liskov-substitution-principle-in-react)):
- **事前条件の強化** = optional だった props を required にする。
- **事後条件の弱化** = 基底が必ず返す要素を派生では `null` を返しうる、にする。
- **props を握りつぶす** = `onClick` を無視する等。
- 対策: 基底の props を継承し `...restProps` で素通しして、追加 props は**増やすだけ**にする。

### I — Interface Segregation: props を小さく分割

```tsx
// ❌ Bad: 1 つの巨大 props。使わないフィールドにも依存してしまう
type CardProps = {
  title: string; body: string;
  authorName: string; authorAvatar: string; authorBadge: string;  // ← 表示専用 Card には不要
  onLike: () => void; onShare: () => void; onDelete: () => void;   // ← 全 caller が全部渡す羽目に
};

// ✅ Good: 関心ごとに型を割り、コンポーネントは必要な分だけ要求
type CardContent = { title: string; body: string };
type CardAuthor  = { name: string; avatar: string };
type CardActions = { onLike: () => void; onShare: () => void };

function Card({ content, author, actions }: { content: CardContent; author: CardAuthor; actions: CardActions }) { /* ... */ }
```

React では **props がコンポーネントのインターフェース**。ISP は「使わない props を強制するな=小さく focused に保て」と読み替える ([DEV / Zahid Hasan](https://dev.to/zahidhasan24/interface-segregation-principle-in-react-2k8c), [Creowis](https://www.creowis.com/blog/interface-segregation-principle-isp-in-react-development))。効用は: テスト時に不要 props を mock せずに済む／LEGO のように組み替え可能／React が「実際に使う props だけ」に依存するので再 render 最適化が効く。

### D — Dependency Inversion: 具体でなく抽象に依存

```tsx
// ❌ Bad: コンポーネントが fetch という具体実装に直結 (テスト不能・差し替え不能)
function Users() {
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => { fetch(URL).then(r => r.json()).then(setUsers); }, []);
  return <>{users.map(u => <div key={u.id}>{u.name}</div>)}</>;
}

// ✅ Good (A): データ取得を hook の抽象へ逆転
function useFetch<T>(url: string): T[] {
  const [data, setData] = useState<T[]>([]);
  useEffect(() => { fetch(url).then(r => r.json()).then(setData); }, [url]);
  return data;
}
function Users() {
  const users = useFetch<User>(URL); // "how" を知らない。axios/cache へ替えても本体無修正
  return <>{users.map(u => <div key={u.id}>{u.name}</div>)}</>;
}

// ✅ Good (B): interface を props で注入 (テスト時に mock を差し込める)
interface UserRepository { getUser(): Promise<User>; }
function UserProfile({ repo }: { repo: UserRepository }) { /* repo.getUser() */ }
// test: render(<UserProfile repo={new MockUserRepository()} />)
```

DIP の React 実装は 3 系統 ([mohammadfaisal](https://dev.to/mohammadfaisal/apply-the-dependency-inversion-principle-in-react-1cao), [cekrem](https://cekrem.github.io/posts/dependency-inversion-in-react/)):
1. **custom hook** = データ取得/副作用を抽象化 (`useFetch`)。「component は how を気にするな」。
2. **props として interface を注入** = `UserRepository` を渡す。テストで `MockUserRepository` に差し替え可能 ([[テスタビリティとテスト戦略]])。
3. **Context API** = ツリー上位で依存を provide、下位は抽象 interface だけ consume。`useContext` 自体が DIP の体現 (具体実装を知らずに抽象に依存)。

---

## よくあるアンチパターン

- **God Component**: `fetch` + 状態 + バリデーション + レイアウト + アニメを 1 ファイルに全部。SRP 違反。→ ロジックを hook、UI を子に割る。
- **Props 爆発 / バケツリレー**: 20 個の props を受け、半分しか使わない。ISP 違反 (使わない props に依存)。「props が多すぎる=分割サイン」 ([Frontend Highlights](https://medium.com/@ignatovich.dm/applying-solid-principles-in-react-applications-44eda5e4b664))。
- **`variant` 増改築**: バリアント追加のたびに本体に `if/switch` を足す。OCP 違反 (修正に開く)。→ composition / `...rest` / render prop。
- **握りつぶし variant**: 拡張のつもりで `onClick` を無視、必須 props を新設。LSP 違反 (基底の場所で壊れる)。
- **具体への直結**: コンポーネント本体で `import { supabase }` して直接クエリ。DIP 違反 (テスト時に実 API を叩く羽目／差し替え不能)。→ hook / repository / Context へ逆転。
- **過剰な DI / 抽象化**: 小コンポーネントに DI コンテナや Context を持ち込み、ただの props で済むものを複雑化。**SOLID の名のもとの overengineering**。[[可読性・保守性]] を下げる本末転倒。
- **hook の責任過多**: 1 つの custom hook がユーザー情報も todo もフォーム状態も持つ。hook レベルの SRP 違反。

---

## ★Geek への適用

Geek (geek-v4, React Native + Expo + Supabase + TanStack Query + Zustand。全体像は [[アーキテクチャ概要]] / [[機能一覧・仕様サマリー]]) では SOLID が**実コードに落ちている**。とくに ISP と DIP は意識的に適用済み。

### ISP — `AnonPostCard` を 3 つに分割し、props を関心ごとに割った ★中心事例

巨大化していた `components/feed/AnonPostCard.tsx` を **ヘッダー (`components/post/PostCardHeader.tsx`) / アクション行 (`components/post/PostCardActions.tsx`)** に分割。各子コンポーネントは「自分が使う props だけ」を受け取り、巨大 props を**関心ごとの小さな型に分割して合成**している。これは ISP の教科書どおりの形。

`PostCardHeader.tsx` の props 定義 (コメントに「Interface Segregation Principle 適用」と明記):
```ts
/** 投稿本体データ */
export type PostHeaderPostData = { post: Post };
/** コミュニティ表示に必要なデータ */
export type PostHeaderCommunityData = {
  communities: PostCommunityRef[];
  primaryCommunity: PostCommunityRef | undefined;
  viewContext: 'home' | 'community';
};
/** 投稿者アイデンティティ / 権限コンテキスト */
export type PostHeaderAuthorContext = {
  pseudonymId: string | null; isOwnPost: boolean; isMod: boolean;
};
/** ヘッダー行の安定化済みハンドラ群 */
export type PostHeaderCallbacks = {
  onPrimaryCommunityPress: () => void; goToPseudoProfile: () => void;
  handleMoreMenu: () => void; onModActionComplete: () => void;
};
/** すべてを合成 (intersection) して 1 つの props 型に */
export type PostCardHeaderProps =
  PostHeaderPostData & PostHeaderCommunityData & PostHeaderAuthorContext & PostHeaderCallbacks;
```
親 `AnonPostCard` 側も同じ流儀で `AnonPostCardData & AnonPostViewerState & AnonPostDisplayContext & AnonPostInteractionCallbacks` を intersection している (`AnonPostCard.tsx` の `AnonPostCardProps`)。`PostCardActions.tsx` も `PostReactionState & PostCountsSnapshot & PostMemeReactionData & PostActionCallbacks & PostActionExtras`。

**なぜこれが ISP として効くか**:
- `PostCardActions` は「いいね/コメント/シェア/リアクション」に必要な props だけを要求し、ヘッダー専用の `pseudonymId` / `isMod` 等には**一切依存しない**。逆も同様。
- 結果として、ヘッダーの仕様変更 (mod メニュー追加など) がアクション行のテストや再 render に波及しない。FlashList 上で 100 枚マウントされるカードの再 render コスト最適化 (各子は `memo` + 安定 props) とも噛み合う ([[React Native・Expo パフォーマンス最適化]] / [[パフォーマンス最適化]])。
- `onQuote?: () => void` のように **optional は「未指定ならボタン非表示」** とし、caller に不要なハンドラを強制しない (ISP の精神)。

> 関連: [[匿名性設計と de-anon ホール]] — `AnonPostViewerState.isOwn` は author_id 非依存の自投稿判定。props 分割が「匿名性に関わるフィールドだけを差し替える」設計にも寄与している。

### DIP / SRP — データ取得・副作用を custom hook の抽象へ逆転

Geek は「**コンポーネントから `supabase.from(...)` を直接叩かない**」を規約 (CLAUDE.md §14 の NG リスト) にしている。これは DIP そのもの。コンポーネントは Supabase という**具体**でなく、`hooks/useLike.ts` `hooks/useFeedPage.ts` 等の**抽象 (hook)** に依存する。

`hooks/useLike.ts` の `useLike()` は、楽観更新・snapshot/revert・連打の smart-queue・cache patch をすべて hook 内に封じ、コンポーネントには `{ toggle, isPending }` という最小インターフェースだけを返す:
```ts
export function useLike() {
  // ... 楽観 patch / cancelQueries / onError revert / smart-queue (連打 parity) ...
  return { toggle, isPending: mutation.isPending };
}
```
- **SRP**: like の「取得 (`useLikes`)」「toggle 副作用 (`useLike`)」が別 hook。表示する `AnonPostCard` は `onLike()` を呼ぶだけで how を知らない。
- **DIP**: Supabase 実装・cache 戦略を hook 裏に隠蔽。`lib/api/*` 層を差し替えても、また RPC 経路 (`feedPagePatcher`) を変えても、カード本体は無修正。
- **OCP**: `useLikes` (取得) を編集せず `useLike` (操作) が機能を足す＝基底を compose して拡張する Persson Dennis の OCP パターン。

### DIP / OCP — テーマ・i18n・feature flag の抽象化

- `hooks/useColors.ts`: `useColors()` / `useGradients()` / `useShadows()` がテーマ palette を返す抽象。コンポーネントは light/dark の具体値を知らず `const C = useColors()` だけ。テーマ追加・色変更は palette 側で完結 (OCP)。`import { C } from design/tokens` からの **gradual migration** 戦略もコメントに明記 ([[i18n・テーマ・デザインシステム]])。
- `hooks/useFeatureFlag.ts`: `useFeatureFlag('markdown_render')` という抽象に依存。`AnonPostCard` は markdown を出すか否かを **flag という抽象**で決め、ロールアウト判定 (`userInRollout`) の中身を知らない。新フラグ追加で本体は無修正 (OCP)。これは「振る舞いを外から注入して条件分岐を本体に増やさない」OCP/DIP の併用。
- `lib/i18n.ts` の `useT()`: コンポーネントは辞書実装でなく `t('好きなタグ')` という抽象に依存 (DIP)。

### OCP / SRP — `MediaWithCWGuard` で「振る舞いを包む」

`components/post/MediaWithCWGuard.tsx` は CW (content warning) 付き media を「タップして表示」に変換する**ラッパ**。`AnonPostCard` は media を `<MediaWithCWGuard>` で**包むだけ**で、ぼかし/CTA/reveal ロジックを本体に書かない:
```tsx
<MediaWithCWGuard cwCategory={cwCategory} blurhash={mediaBlurhashes[0]}>
  <FeedMediaGrid items={mediaGridItems} onPress={onMediaGridPress} />
</MediaWithCWGuard>
```
- **OCP**: CW の挙動 (spoiler/nsfw/violence/sensitive ごとの分岐) はガード側に閉じ、media を出す側は無修正で「CW 対応」を獲得。composition による拡張。
- **SRP**: 「reveal 状態管理 + ぼかし表示」だけがこのコンポーネントの責任。`revealed` を **component local** に持ち、再 mount で reset する設計判断もコメント化されている。

### Geek における「やり過ぎない」線引き

Geek は **Context をほぼ使わず Zustand selector + custom hook** で依存を供給している (`grep createContext` はほぼヒットなし)。これは「DI = Context」と短絡せず、過剰抽象を避ける Persson Dennis の警告に沿った判断。状態は `stores/*` の Zustand を **selector 購読** (全 destructure 禁止＝再 render 連鎖回避) で取り、ロジックは hook へ。Context の prop-drilling 回避メリットが要らない局面で Context を持ち込まない、という [[Zustand・React Query ベストプラクティス]] / [[State管理 (Zustand・React Query)]] とも一貫した設計。

---

## 出典 (URL一覧)

- Konstantin Lebedev — Applying SOLID principles in React: <https://konstantinlebedev.com/solid-in-react/>
- Persson Dennis — Write SOLID React Hooks: <https://www.perssondennis.com/articles/write-solid-react-hooks>
- Frontend Highlights (Ignatovich) — Applying SOLID Principles in React Applications: <https://medium.com/@ignatovich.dm/applying-solid-principles-in-react-applications-44eda5e4b664>
- Nile Bits — How To Apply SOLID Principles In React: <https://www.nilebits.com/blog/2024/05/how-to-apply-solid-principles-in-react/>
- DEV / Zahid Hasan — Interface Segregation Principle in React: <https://dev.to/zahidhasan24/interface-segregation-principle-in-react-2k8c>
- Creowis — Interface Segregation Principle (ISP) in React Development: <https://www.creowis.com/blog/interface-segregation-principle-isp-in-react-development>
- DEV / Mikhael Esa — Liskov Substitution Principle in React: <https://dev.to/mikhaelesa/liskov-substitution-principle-in-react-2p1n>
- Creowis — Liskov Substitution Principle in React: <https://www.creowis.com/blog/liskov-substitution-principle-in-react>
- mohammadfaisal (DEV) — Apply the Dependency Inversion Principle in React: <https://dev.to/mohammadfaisal/apply-the-dependency-inversion-principle-in-react-1cao>
- cekrem — Dependency Inversion in React: Building Truly Testable Components: <https://cekrem.github.io/posts/dependency-inversion-in-react/>
- Juan Otálora — Mastering Dependency Injection in React: <https://juanoa.medium.com/mastering-dependency-injection-in-react-fbb78c4de08a>
- cekrem — Single Responsibility Principle in React: <https://cekrem.github.io/posts/single-responsibility-principle-in-react/>
