---
tags: [research, クリーンコード, clean-code, naming, functions, DRY, KISS]
---

# Clean Code 原則

Robert C. Martin (Uncle Bob) の『Clean Code』(2008) を起点に、命名・関数・コメント・DRY/KISS を整理し、2023-2025 の最新の批判的視点(Rule of Three / 「wrong abstraction」論争)を統合する。最後に **geek-v4 の実コード**へどう適用するかを具体ファイルで示す。

> 関連: [[素晴らしいコードとは — 総論]] / [[可読性・保守性]] / [[SOLID 原則と React 実践]] / [[関数型プログラミングパターン]] / [[TypeScript 型安全性]] / [[テスタビリティとテスト戦略]] / [[地雷・落とし穴 総覧]]

---

## 定義・原則

Clean Code は「**他人(半年後の自分を含む)が最小の認知コストで読み・変更できるコード**」を指す。Martin の核は「コードは書く時間より読まれる時間の方が圧倒的に長い → 読みやすさが最優先」。

### Martin の 5 大カテゴリ(Cheat Sheet)

| カテゴリ | 主要ルール |
|---|---|
| **命名 (Naming)** | 説明的で曖昧でない / 意味のある区別 / 発音可能 / 検索可能 / マジックナンバーは名前付き定数に / 型プレフィックス(ハンガリアン)を付けない |
| **関数 (Functions)** | 小さく / 1 つのことだけ / 説明的な名前 / 引数は少なく(理想 0-2) / 副作用を消す / フラグ引数を作らない(別関数に分ける) |
| **コメント (Comments)** | まずコードで表現を試みる / 情報を重複させない / 自明なことを書かない / 閉じ括弧注釈を書かない / コメントアウトした死コードは消す(VCS が履歴を持つ) / 残すなら「意図・明確化・警告」 |
| **構造 (Formatting)** | 概念的に違うものは縦に分離 / 関連は近くに / 変数は使う直前で宣言 / 依存関数は隣接 / 上から下へ依存順 / 行は短く |
| **オブジェクト/データ** | 実装詳細を隠蔽 / クラスは小さく / 単一責任 / インスタンス変数は少なく / Law of Demeter(直接の依存しか知らない) |

### 横断する 4 つの定番原則

- **DRY (Don't Repeat Yourself)** — 「すべての知識は、システム内で単一で明確な表現を持つべき」(Hunt & Thomas)。重複は更新漏れによるバグの温床。
- **KISS (Keep It Simple, Stupid)** — 複雑さを避ける。「賢い圧縮」より「凡庸だが一読で分かる」を選ぶ。
- **YAGNI (You Aren't Gonna Need It)** — 将来使うかもしれない機能を今作らない。投機的な汎用化を避ける。
- **Boy Scout Rule** — 「来た時より少しだけきれいにして帰る」。触ったファイルを毎回ほんの少し改善。

### Code Smells(警告サイン)

Martin が挙げる設計の腐敗兆候 — **Rigidity**(1 変更が連鎖する)/ **Fragility**(1 箇所直すと別が壊れる)/ **Immobility**(再利用できない)/ **Needless Complexity**(過剰設計)/ **Needless Repetition**(重複)/ **Opacity**(読めない)。

---

## 具体例(コードブロック)

TypeScript で。出典: [labs42io/clean-code-typescript](https://github.com/labs42io/clean-code-typescript)。

### 命名 — 検索可能な定数 / 意味のある区別

```typescript
// ❌ Bad — マジックナンバー / 引数の意味が分からない
setTimeout(restart, 86400000);
function between<T>(a1: T, a2: T, a3: T): boolean {
  return a2 <= a1 && a1 <= a3;
}

// ✅ Good
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
setTimeout(restart, MILLISECONDS_PER_DAY);
function between<T>(value: T, left: T, right: T): boolean {
  return left <= value && value <= right;
}
```

### 関数 — 1 つのことだけ / 関数合成

```typescript
// ❌ Bad — lookup と filter と email が 1 関数に混在
function emailActiveClients(clients: Client[]) {
  clients.forEach((client) => {
    const record = database.lookup(client);
    if (record.isActive()) email(client);
  });
}

// ✅ Good — 各関数が 1 抽象レベル / 名前が動作を語る
function emailActiveClients(clients: Client[]) {
  clients.filter(isActiveClient).forEach(email);
}
function isActiveClient(client: Client) {
  return database.lookup(client).isActive();
}
```

### 関数 — フラグ引数を作らない

```typescript
// ❌ Bad — boolean が「2 つのことをしている」証拠
function createFile(name: string, temp: boolean) {
  if (temp) fs.create(`./temp/${name}`);
  else fs.create(name);
}

// ✅ Good — 呼び出し側が意図を表現できる
function createFile(name: string) { fs.create(name); }
function createTempFile(name: string) { createFile(`./temp/${name}`); }
```

### 関数 — 副作用を消す / 引数を不変に

```typescript
// ❌ Bad — 引数を破壊的に変更
function addItemToCart(cart: CartItem[]): void {
  cart.push({ item, date: Date.now() });
}

// ✅ Good — 新しい配列を返す純関数
function addItemToCart(cart: CartItem[]): CartItem[] {
  return [...cart, { item, date: Date.now() }];
}
```

### 条件式に名前を付ける(Encapsulate Conditionals)

```typescript
// ❌ Bad
if (subscription.isTrial || account.balance > 0) { /* ... */ }

// ✅ Good — 条件そのものがドキュメント化される
function canActivateService(sub: Subscription, acc: Account) {
  return sub.isTrial || acc.balance > 0;
}
if (canActivateService(subscription, account)) { /* ... */ }
```

---

## よくあるアンチパターン

| アンチパターン | なぜダメか | 直し方 |
|---|---|---|
| マジックナンバー/文字列 (`* 0.58`, `'cover'`) | 意味不明・grep 不能・変更点が散る | 名前付き定数へ |
| 単一文字変数 (`d`, `tmp`, `x`) | mental mapping を強いる | 説明的な名前(`createdAt`, `decay`) |
| フラグ引数 (`fn(x, true)`) | 呼び出し箇所で意図が読めない | 別関数に分割 |
| God function(数百行) | テスト不能・1 抽象レベル違反 | 小関数へ抽出 |
| `getUserInfo`/`getUserData`/`getUserDetails` 混在 | 同じ概念に複数語彙 | 1 概念 1 語彙に統一 |
| コメントアウトした死コード | 腐る・誤解を生む | 消す(VCS が履歴を持つ) |
| 自明コメント (`i++ // i に 1 足す`) | ノイズ | 消す。コメントは「なぜ」を書く |
| `try { ... } catch {}`(silent swallow) | 本物の障害が消える | ログ/breadcrumb を残す(後述) |
| 二重否定 (`if (isNotEmpty)`) | 認知負荷 | 肯定形に |

### ★最新(2023-2025): DRY の「行き過ぎ」批判

`Clean Code` の中で最も再評価が進んだのが DRY の機械的適用。**「見た目が同じ ≠ 同じ概念」** であり、早すぎる共通化は flag と条件分岐が積み上がって「重複より読みにくい抽象」を生む。

- **Sandi Metz の格言**: 「**Duplication is far cheaper than the wrong abstraction**(重複は、間違った抽象よりはるかに安い)」。間違った抽象は剥がすコストが高く、保守を悪化させる。
- **Rule of Three (WET = Write Everything Twice)**: 「**3 回目の重複を見るまで抽象化を導入しない**」。2 回までは複製でよい。3 回見えて初めて「本当に共通な部分」と「たまたま似ているだけの部分」を見分けられる。
- **判断ヒューリスティック**: 抽出した共通物に **明確で意味のある名前を付けられないなら、その抽象はまだ存在しない**。名前が付かない共通化は剥がす。
- **Casey Muratori "Clean Code, Horrible Performance" (2023)**: ポリモーフィズム/OCP を switch ベースの直接計算に置き換えて 15x 高速化を実証。**ホットパスでは「きれいさ」より計測されたパフォーマンスが優先**されうる(→ [[React Native・Expo パフォーマンス最適化]])。

つまり 2025 年の合意は「**Clean Code は絶対律法ではなく、文脈で重み付けする経験則の束**」。DRY/SOLID も、目的(変更容易性)を見失った機械適用は害になる。

---

## ★Geek への適用

geek-v4 は既に「Clean Code 寄り」の文化が根付いている(`CLAUDE.md` §5, §6, §14)。ここでは **実在ファイル**を引いて、4 つの柱がどう体現/強化されるかを示す。

### 1. 命名 — 既に良い例 + 強化方針

`lib/feed/smartRank.ts` は命名の手本。関数名が「動作」を語り、定数が「意図」を語る:

```typescript
// lib/feed/smartRank.ts
const HALF_LIFE_HOURS = 24;                 // ✅ 検索可能な定数(マジック 24 ではない)
function recencyDecay(createdAt: string): number { /* ... */ }   // ✅ 何を返すか自明
function engagementScore(p: Post): number { /* ... */ }          // ✅ 名詞句で「スコア」
export function smartScore(p, ctx, mode): number { /* ... */ }   // ✅ 動詞性のある説明名
```

`lib/passwordPolicy.ts` も `MIN_PASSWORD_LEN = 8` / `MAX_PASSWORD_LEN = 72 // bcrypt 上限` と**マジックナンバーを名前付き定数化 + なぜその値かをコメント**している(72 は bcrypt 制約、という「コードで表現できない知識」)。

- **強化**: 新規でも `p`, `q`, `tmp` のような略名を避ける。`smartRank.ts` の `p`(= post)は forEach 直近スコープなので許容範囲だが、モジュール公開シグネチャ(`smartScore(p, ...)`)は将来 `post` に寄せる余地あり。
- **1 概念 1 語彙**: `lib/api/` 内のクエリ関数名は `fetchOne` / `list` のように動詞を統一(`CLAUDE.md` §5.1 の例)。`get`/`fetch`/`load` を混ぜない。

### 2. 小さな関数 — `lib/` の純関数文化

`hooks/useDebounce.ts` は **11 行で 1 つのことだけ**やる理想形:

```typescript
// hooks/useDebounce.ts — 単一責任・テスト容易・副作用は cleanup で回収
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
```

`smartRank.ts` の `smartScore`→`smartSort` も **小関数の合成**(`recencyDecay` / `engagementScore` を組み合わせる)で 1 抽象レベルを保っている。

- **方針**: `components/feed/` の大きな Card 系は、表示ロジックを純関数として `lib/` か hook に逃がす(`AnonPostCard` を分割した前例あり: commit `fd391c2`)。レンダーと計算を混ぜない = テスト可能になる(→ [[テスタビリティとテスト戦略]])。
- **副作用の分離**: 「`lib/api/*` を経由し component から直接 `supabase.from()` を叩かない」(`CLAUDE.md` §14)は、まさに **副作用(I/O)を端に押し出す** Clean Code 実践。

### 3. コメント文化 — 「なぜ」を厚く、「何」は書かない

geek-v4 の良い慣習は **設計判断を日本語で厚くコメントする**(`CLAUDE.md` §6)。`lib/swallow.ts` は手本:

```typescript
// lib/swallow.ts(抜粋)
// 旧コードは `try { something(); } catch {}` で error を完全に握りつぶしていた。
// 99% は意図的な defensive code だが、**本当に何かが壊れている** ケースも紛れ込む。
// swallow() を使うと: 1) 本筋を止めない 2) Sentry breadcrumb を残す 3) __DEV__ で warn
```

これは Martin の「コメントは intent(なぜこの設計か)を説明せよ」に完全合致 — **コードからは読み取れない「歴史と意図」**を残している。`passwordPolicy.ts` の「本物の防御は Supabase ダッシュボード側。クライアントは UX 目的」も同種の良コメント。

- **NG にすべきコメント**: `// i に 1 足す` のような自明な説明、コメントアウトした死コード(`CLAUDE.md` §14 に既に明記)。
- **重い設計判断は枠コメント**: `// ===...===` で囲む慣習(`lib/realtime.ts`, `feedPagePatcher.ts`, `swallow.ts`)を新規の「踏みやすいファイル」でも踏襲。

### 4. DRY / マジック値排除 — geek-v4 の中央集約

geek-v4 は DRY を**「単一の source of truth」**として正しく運用している:

- **文字列**: `constants/strings.ts` の `S` 定数(`POST_SUCCESS: '投稿しました。'` 等)で UI 文言を一元化。トースト文言をベタ書きしない = i18n 漏れ・表記ゆれを防ぐ。
- **デザイントークン**: `design/tokens.ts`(`C` / `GRAD` / `SP` / `R` / `SIZE`)で色・余白・角丸を一元化(`CLAUDE.md` §3)。`#7C6AF7` をコンポーネントに直書きしない。
- **キャッシュ書き戻し**: `lib/cacheUpdates/feedPagePatcher.ts` の `patchFeedPagePost` で「全 feed-page cache を 1 関数で更新」= optimistic update の重複ロジックを 1 箇所に。
- **クエリキー生成**: `lib/utils/queryKey.ts` の `stableKeyFor()` で key 生成規則を集約。

#### ★ただし Geek でも「行き過ぎ DRY」に注意(Rule of Three)

`smartRank.ts` の `WEIGHTS`(hot/new/top の重み)は 3 モードあるので集約が正しい。一方で:

- **2 箇所だけ似ているコード**を急いで共通化しない。例えば feed カードと bbs カードの軽い見た目の重複は、**3 回目が出るまで複製のまま**でよい(Sandi Metz の格言)。`CLAUDE.md` §17 の「やりすぎを恐れる / 1 PR 1 目的」とも整合。
- 共通化する関数に**明確な名前が付かないなら抽象が間違っている**サイン → 複製に戻す。

### Geek 適用チェックリスト(レビュー観点)

- [ ] マジックナンバー/文字列を直書きしていないか(→ `constants/`, `design/tokens.ts`)
- [ ] 関数は 1 つのことだけか / フラグ引数(`fn(x, true)`)になっていないか
- [ ] `try{}catch{}` を `swallow('scope', e)` にしたか(`CLAUDE.md` §14)
- [ ] component から直接 `supabase.from()` を叩いていないか(→ `lib/api/`)
- [ ] コメントは「なぜ」を書いているか / 自明な「何」や死コードを残していないか
- [ ] 共通化は 3 回目か / 抽出物に意味ある名前が付くか(間違った抽象を作っていないか)
- [ ] 新しい純関数を書いたら `tests/unit/` にテストを足したか(`CLAUDE.md` §10)

---

## 出典(URL一覧)

- Robert C. Martin『Clean Code』要約 (wojteklu gist): <https://gist.github.com/wojteklu/73c6914cc446146b8b533c0988cf8d29>
- Clean Code concepts adapted for TypeScript (labs42io): <https://github.com/labs42io/clean-code-typescript>
- A Deep Dive Into Clean Code Principles (Codacy): <https://blog.codacy.com/clean-code-principles>
- Don't make Clean Code harder to maintain, use the Rule of Three (Understand Legacy Code): <https://understandlegacycode.com/blog/refactoring-rule-of-three/>
- 7 Clean Coding Principles Every Developer Should Know (Pull Checklist): <https://www.pullchecklist.com/posts/clean-coding-principles>
- Clean Code: The Good, the Bad and the Ugly (gerlacdt): <https://gerlacdt.github.io/blog/posts/clean_code/>
- A guide to the DRY principle and the wrong abstraction (Samuel Wilson, Medium): <https://medium.com/@sunnywilson.veshapogu/a-guide-to-the-dry-principle-code-duplication-and-why-the-wrong-abstraction-is-worse-than-51a68734a162>
- It's probably time to stop recommending Clean Code (qntm): <https://qntm.org/clean>
- geek-v4 ソース: `lib/feed/smartRank.ts` / `lib/swallow.ts` / `lib/passwordPolicy.ts` / `hooks/useDebounce.ts` / `constants/strings.ts` / `CLAUDE.md`
