---
tags: [research, アーキテクチャ, クリーンコード, フロントエンド設計]
aliases: [FSD, Atomic Design, Clean Architecture, フロントアーキテクチャ]
---

# アーキテクチャパターン (FSD・Atomic・Clean)

フロントエンドの「フォルダをどう切るか」「依存をどう流すか」を決める 3 大方法論 ―
**Feature-Sliced Design (FSD)** / **Atomic Design** / **Clean Architecture** ―
の定義・コード例・アンチパターンを一次情報から整理し、最後に **Geek (geek-v4) の現状**を実ファイルで評価して改善余地を提案する。

> 大前提: React/React Native はフォルダ構成を強制しない。「どう切るか」は完全に自由 = だからこそ**意図的な設計**が保守性を分ける。3 方法論は解く問題が違う ―
> - **Atomic Design** = UI コンポーネントの**粒度**を整理する (見た目の語彙)
> - **FSD** = プロジェクト全体を**業務ドメイン × 技術目的**で切る (フォルダの語彙)
> - **Clean Architecture** = **依存の向き**を制御し業務ロジックを framework から独立させる (依存の語彙)
>
> 排他ではなく**重ねて使える**。FSD の各 slice 内部を Clean Architecture で組み、UI segment を Atomic で粒度分けする、が王道。

関連: [[アーキテクチャパターン (FSD・Atomic・Clean)]] の土台として [[素晴らしいコードとは — 総論]] / [[SOLID 原則と React 実践]] / [[可読性・保守性]] / [[Geek 側は [[アーキテクチャ概要]]]]。

---

## 定義・原則

### 1. Atomic Design (Brad Frost)

UI を化学のメタファで 5 段に分解する**メンタルモデル**。「UI を*全体*としても*部品の集合*としても同時に捉える」ための語彙。

| 段 | 定義 | 例 |
|----|------|----|
| **Atoms (原子)** | これ以上分解すると機能を失う最小要素。基礎 HTML 相当 | `Button` `Input` `Label` `Avatar` `Icon` |
| **Molecules (分子)** | atom を数個組み合わせた**機能単位** | 検索フォーム (label + input + button) |
| **Organisms (有機体)** | molecule/atom を束ねた**独立した UI セクション**。state を持ってよい | ヘッダ、フッタ、商品カード、ナビバー |
| **Templates (雛形)** | organism をレイアウトに配置した**構造の骨格**。中身は placeholder | 記事ページの枠組み |
| **Pages (ページ)** | template に**実データ**を流した具体インスタンス | 実際の記事ページ |

**重要な原則 (誤解されやすい)**:
- **線形ではない**。「atom を全部作ってから molecule」ではなく**並行**に進める。画家がキャンバスから一歩引いて全体を見るのと同じ。
- Atomic Design は**デザインシステムの語彙**であって、アプリ全体のアーキテクチャではない。state 管理やデータ取得の話は守備範囲外。

### 2. Feature-Sliced Design (FSD)

フロントエンドの**プロジェクト全体構成**を標準化する方法論。3 階層の入れ子: **Layers (層) → Slices (スライス) → Segments (セグメント)**。

**Layers (上から下へ。import は厳格に下方向のみ)**:

| 層 | 役割 | slice の有無 |
|----|------|------|
| `app` | 起動に必要な全て: routing / entrypoint / global style / providers | segment のみ |
| `processes` | ページ跨ぎの複雑フロー (**非推奨・廃止方向**) | slice |
| `pages` | 1 ページ全体 or ネストルーティングの大きな塊 | slice |
| `widgets` | 自己完結した大きな機能/UI 塊 (1 ユースケース相当) | slice |
| `features` | 再利用される**プロダクト機能**実装 (ビジネス価値を提供) | slice |
| `entities` | プロジェクトが扱う**業務エンティティ** (`user` `product` `post`) | slice |
| `shared` | プロジェクト/業務から切り離された再利用部品 (UI kit, API client, lib) | segment のみ |

**Slices** = 層を**業務ドメイン**で分割する単位。鉄則: **同じ層の隣の slice からは import できない** (= high cohesion / low coupling)。

**Segments** = slice 内を**技術目的**で分割する単位:
- `ui` … UI コンポーネント・formatter・style
- `api` … バックエンド通信・request 関数・データ型
- `model` … schema / interface / store / ビジネスロジック
- `lib` … その slice 専用のライブラリコード
- `config` … 設定・feature flag

**The Import Rule (FSD の核心)**:
> *"Modules on one layer can only know about and import from modules from the layers strictly below."*
> (ある層のモジュールは、**厳密に下の層**からしか import できない)

これが循環依存を構造的に禁止し、「下層を触っても上層が壊れない / 上層を消しても下層は無傷」という**変更の局所性**を保証する。

### 3. Clean Architecture (フロントエンド適用)

Robert C. Martin の同心円を frontend に写したもの。**依存は常に内向き**という 1 つのルールがすべて。

| 層 (内→外) | 内容 |
|----|------|
| **Domain (中心)** | entities + 純粋なデータ変換。**何にも依存しない**。「アプリを他と区別するコアそのもの」 |
| **Application (中間)** | use case = domain ロジックと外部の**オーケストレーション**。**ports** (外界との通信方法を定義する interface) をここで宣言 |
| **Adapters / Infrastructure (外周)** | 決済 API / HTTP / DB / **UI framework** など具体実装。incompatible な外部 API を port の形に**変換 (adapter)** する |

**The Dependency Rule**:
> *"only the outer layers can depend on the inner layers"*
> domain は独立 / application は domain に依存 / 外周は何にでも依存可。**内側は外側を一切知らない。**

**実践パターン — Impure Sandwich (不純なサンドイッチ)**: use case を `副作用 → 純粋関数 → 副作用` で組む。
1. storage からデータ取得 (副作用)
2. domain 変換を適用 (**純粋**)
3. 永続化 or 返却 (副作用)

→ ビジネスロジックを純粋に隔離しつつ、必要な I/O だけ端に寄せる。[[関数型プログラミングパターン]] の functional core / imperative shell と同型。

**トレードオフ**: 利点=疎結合・差し替え可能・テスト容易・domain 分離。コスト=初期コスト増・記述が冗長・bundle 肥大の懸念・学習曲線。著者の結論は「**domain 抽出と依存ルールだけは非交渉。残りは実用主義で**」。

---

## 具体例 (コードブロック)

### FSD のフォルダツリー

```
src/
├── app/                  # providers, router, global styles (segment のみ)
│   ├── providers/
│   └── styles/
├── pages/
│   ├── feed/
│   │   ├── ui/           # FeedPage.tsx
│   │   └── index.ts      # public API (barrel)
│   └── post-detail/
├── widgets/
│   └── post-card/
│       ├── ui/
│       └── model/
├── features/
│   ├── like-post/        # 「いいね」機能 = 1 slice
│   │   ├── ui/LikeButton.tsx
│   │   ├── model/useLike.ts
│   │   └── api/like.ts
│   └── compose-post/
├── entities/
│   └── post/             # Post という業務エンティティ
│       ├── model/post.ts # 型・store
│       ├── api/postApi.ts
│       └── ui/PostMeta.tsx
└── shared/
    ├── ui/               # Button, Input … (atoms)
    ├── api/              # supabaseClient
    └── lib/              # date, format
```

**Public API (barrel) の徹底** — slice は `index.ts` だけを外に晒し、内部実装を隠蔽する:

```ts
// features/like-post/index.ts ― これ以外を外から import 禁止
export { LikeButton } from './ui/LikeButton';
export { useLike } from './model/useLike';
// ./api/like.ts は内部実装なので export しない
```

```ts
// ❌ FSD 違反: 隣の feature の内部を直接掘る
import { likeApi } from '../like-post/api/like';
// ❌ FSD 違反: 下層が上層を import (entities が features を知る)
import { LikeButton } from 'features/like-post';   // entities/post 内では NG

// ✅ OK: 上層が下層の public API を使う
import { LikeButton } from 'features/like-post';    // pages/feed 内なら OK
```

### Atomic Design の React 実装

```tsx
// atoms/Button.tsx ― 最小・state を持たない・props で全制御
export const Button = ({ label, onPress }: { label: string; onPress(): void }) => (
  <Pressable onPress={onPress}><Text>{label}</Text></Pressable>
);

// molecules/SearchForm.tsx ― atom を組み合わせた機能単位
export const SearchForm = ({ onSubmit }: { onSubmit(q: string): void }) => {
  const [q, setQ] = useState('');
  return (<View><Input value={q} onChangeText={setQ} /><Button label="検索" onPress={() => onSubmit(q)} /></View>);
};

// organisms/Header.tsx ― molecule/atom を束ね state を持つセクション
export const Header = () => (<View><Logo /><Nav /><SearchForm onSubmit={search} /></View>);
```

→ **state は organism/template に置き、下 (molecule/atom) へは props で流す**のが定石。atom を「賢く」しない。

### Clean Architecture の TypeScript 実装 (port & adapter)

```ts
// ---- domain (中心: 何にも依存しない純粋ロジック) ----
export type Post = { id: string; likes: number; mine: boolean };
export const toggleLike = (p: Post): Post =>           // 純粋関数
  ({ ...p, mine: !p.mine, likes: p.likes + (p.mine ? -1 : 1) });

// ---- application (port = 外界への要求を interface で宣言) ----
export interface PostStorage {                          // port
  load(id: string): Promise<Post>;
  save(p: Post): Promise<void>;
}
export const likeUseCase = (storage: PostStorage) => async (id: string) => {
  const post = await storage.load(id);                  // 副作用 (端)
  const next = toggleLike(post);                        // 純粋 (中央) = impure sandwich
  await storage.save(next);                             // 副作用 (端)
  return next;
};

// ---- adapter (外周: port を Supabase で具体実装) ----
export const supabasePostStorage: PostStorage = {
  load: async (id) => (await supabase.from('posts').select().eq('id', id).single()).data!,
  save: async (p) => { await supabase.from('posts').update(p).eq('id', p.id); },
};
// UI は likeUseCase(supabasePostStorage) を呼ぶだけ。Supabase を mock に差し替えれば domain を純粋にテストできる。
```

---

## よくあるアンチパターン

| アンチパターン | 何が問題か | 正しい方向 |
|---|---|---|
| **God components フォルダ** (全 .tsx を `components/` 直下にフラット) | 100 個並ぶと探せない・どれが atom かページ専用か不明 | feature か粒度で分割 |
| **Atomic の過剰タクソノミー論争** | 「これは molecule か organism か」で議論が無限ループ。境界が曖昧 | 厳密分類より「再利用される最小単位か」で実用判断。迷ったら 1 段上 |
| **Atomic を全アーキテクチャと誤認** | data fetch/state を atoms/molecules に押し込み肥大化 | Atomic は UI 語彙だけ。データは別レイヤ (FSD の api/model や Clean の use-case) |
| **FSD の cross-slice import** | 隣 slice の内部を `../other-feature/model/x` で直接掘る → 結合爆発・循環依存 | public API (index.ts) 経由のみ。共有したいなら下層 (shared/entities) へ降ろす |
| **FSD の逆流 import** | 下層 (entities) が上層 (features) を import | 依存は厳密に下向き。共通化は更に下へ |
| **Clean の over-engineering** | 小さな CRUD アプリに 4 層 + DI コンテナ + repository interface を全部 | domain 抽出と依存ルールだけ死守、他は規模に応じ省略 |
| **Anemic domain (貧血ドメイン)** | domain が型 (data) だけで振る舞いゼロ、ロジックが全部 UI/use-case に散る | 業務ルールは domain の純粋関数に集約 |
| **Type-first 肥大の罠** | `components/` `utils/` `hooks/` で type 別に切ると、1 機能が全フォルダに散る → 機能追加で 5 箇所横断・削除で消し漏れ | 一定規模を超えたら feature 別 (colocation) へ移行 |
| **早すぎる抽象化** | 機能 3 個の段階で FSD 7 層フル装備 | 「小さくフラットに始め、痛くなったら feature 化」(2025 のコンセンサス) |
| **Barrel の暴走** | 巨大 `index.ts` で全 re-export → tree-shaking 阻害・bundle 肥大・循環依存源 | slice public API は最小限に。barrel に「全部入れる」をやめる ([[パフォーマンス最適化]] 参照) |

---

## ★ Geek への適用

### Geek (geek-v4) の現状アーキテクチャ

実ファイル調査の結果、Geek は **type-first (技術目的別) レイヤリング + 各層内での feature 二次グルーピング** という構成。`tsconfig.json` の path alias は `@/*` 一本のみ (`./*` にマップ)。

```
geek-v4/
├── app/              # Expo Router file-based routing = de-facto「pages 層」
│   ├── (auth)/  (tabs)/  admin/  bbs/  corners/  drafts/
│   ├── post/  user/  search.tsx  onboarding/  settings/ …
│   └── _layout.tsx   # providers / root
├── lib/
│   ├── api/          # ★ ~70 ファイル = データアクセス層 (posts.ts, homeFeed.ts,
│   │                 #   communities-*.ts, comments.ts, admin*.ts, search*.ts …)
│   ├── feed/  community/  ai/  safety/  search/  personalize/  trust/  i18n/  theme/
│   │                 # ← lib 内が機能別に二次グルーピング (smartRank, feedQuery 等)
│   └── supabase.ts  format/  utils/  validation.ts …
├── components/
│   ├── ui/           # ★ 55+ atoms/molecules フラット (Button Input Avatar Badge =atom,
│   │                 #   ActionSheet BottomSheet Toast Skeleton =molecule/organism)
│   └── feed/ community/ post/ admin/ search/ tag/ map/ mypage/ …  # 機能別グルーピング
├── stores/           # Zustand ~22 (authStore, feedStore, draftStore, toastStore …)
├── hooks/            # ★ ~75 (useFeed, useLike, usePostDetail, useSearchV4 …)
│                     #   = 実質「use-case / application 層」
└── types/            # models.ts (Post, AccountState …) + api.ts ― 全体共有の型
```

**評価サマリ**:

| 観点 | 現状 | 判定 |
|---|---|---|
| Atomic Design | `components/ui/` が atoms/molecules の置き場 (厳密な階層フォルダ無し)。`components/<feature>/` が organism 相当 | △ 影響は受けているが非厳密。実用上は十分機能 |
| FSD | `features/` `entities/` `widgets/` `slices/` フォルダは**存在しない**。slice 概念なし。barrel (`index.ts`) も components に **0 個** | ✗ 不採用。ただし `lib/api/`+`lib/<feat>/`+`components/<feat>/` で**疑似スライス**を手動運用 |
| Clean Architecture | `lib/api/` (adapter/data) → `hooks/` (use-case) → `components/` (UI) と、層の分離は**実態として存在**。domain の純粋ロジックは `lib/feed/smartRank.ts` `lib/utils/*Sort.ts` 等に散在 | △ 暗黙の 3 層。port/adapter の明示や DI は無く Supabase 直結 |
| 型の集約 | `types/models.ts` に `Post` 等の中核型を一括 (frontmatter コメントで DB migration 由来を注記) | ○ 単一の真実源として機能。ただし肥大化傾向 |

### 何が起きているか — 「feed」機能の散らばり (type-first の代償)

1 つの「フィード」機能が **6+ フォルダに分散**している:
- `app/(tabs)/` … フィード画面 (pages 層)
- `components/feed/` … `AnonPostCard` `FeedMediaGrid` `PollCard` `SortTabs` 等 14 ファイル (UI)
- `lib/feed/` … `feedQuery.ts` `smartRank.ts` (domain/query)
- `lib/api/homeFeed.ts` `feedPage.ts` `posts.ts` … (data access)
- `hooks/useFeed.ts` `useFeedPage.ts` `useFeedRealtime.ts` `useLike.ts` … (use-case)
- `stores/feedStore.ts` … (UI state)

→ FSD/feature-based の観点では「feed slice を追加・削除・把握するのに毎回 6 箇所を横断」する典型的 type-first コスト。機能の**凝集度が低い**。逆に「同種のものが 1 箇所にまとまる」発見性は高い、というトレードオフの裏返し。

### 改善余地の提案 (Geek 文脈・実用優先)

> 全面 FSD 移行は ~70 API + ~75 hooks + Expo Router 前提を考えると**コスト過大・非推奨**。`app/` の file-based routing は FSD の `pages` 層と相性が良い一方、`features/entities` への大移動は破壊的。**段階的・部分採用**が現実解。

1. **`components/ui/` に Atomic の軽い 2 分割を導入**
   55+ がフラットで探しづらい。フォルダを割らずとも、せめて命名 or サブフォルダで `ui/primitives/` (Button, Input, Avatar, Badge, Toggle = atoms) と `ui/composites/` (BottomSheet, ActionSheet, ImageLightbox, Skeleton 系 = molecules/organisms) に分けると認知負荷が下がる。詳細は [[i18n・テーマ・デザインシステム]]。

2. **`entities/` 相当の薄い導入 (型 + 純粋ロジックの集約)**
   `types/models.ts` の肥大化対策として、中核エンティティ単位 (`post` `community` `user`) で「型 + 純粋変換 + API 薄ラッパ」を 1 箇所に寄せる小実験。いきなり全面でなく `post` だけ試す。これは Clean の domain 抽出にも効く。

3. **domain ロジックの「純粋関数」明示と集約**
   `smartRank.ts` や `*Sort.ts`、いいね計算 ([[フィード・ランキング・レコメンド]] / vote fuzz バグ記憶あり) のような**純粋ビジネスロジック**は `lib/domain/` 等に集約し UI/hook から分離 → unit test を貼りやすくする ([[テスタビリティとテスト戦略]])。Impure Sandwich を意識し、副作用は hook 端へ。

4. **Supabase の port 化 (限定的)**
   全面 Clean は過剰だが、テストしたい中核ユースケース (like, post 投稿) だけ port interface を切り `supabase.ts` を adapter 化すると、mock 差し替えで domain を純粋テストできる。`lib/api/` 全体の書き換えは不要。詳細は [[データ層・Supabase・RLS・マイグレーション運用]]。

5. **cross-import 規律の lint 化**
   FSD フォルダを入れなくても「`components/<A>` が `components/<B>` の内部を import しない」「`lib/api` が `components` を import しない (逆流禁止)」を **eslint-plugin-boundaries** 等で機械強制すると、type-first のまま依存の健全性を守れる。[[SOLID 原則と React 実践]] の DIP に直結。

6. **新機能は「疑似スライス」で colocation を試す**
   既存を壊さず、**今後の新機能**だけ `features/<name>/` に ui/model/api を colocate する実験 → 痛みが少なければ徐々に拡大。「小さく始め痛くなったら feature 化」の 2025 コンセンサスに沿う。

> Geek 全体像は [[アーキテクチャ概要]]、state 層は [[State管理 (Zustand・React Query)]] / [[Zustand・React Query ベストプラクティス]]、落とし穴は [[地雷・落とし穴 総覧]] を参照。

---

## 出典 (URL 一覧)

- Feature-Sliced Design 公式 — Overview: https://feature-sliced.design/docs/get-started/overview
- Feature-Sliced Design 公式サイト: https://feature-sliced.design/
- FSD documentation (GitHub): https://github.com/feature-sliced/documentation
- Clean Architecture in Frontend (FSD blog): https://feature-sliced.design/blog/frontend-clean-architecture
- Brad Frost — Atomic Design Methodology (Chapter 2): https://atomicdesign.bradfrost.com/chapter-2/
- Alex Bespoyasov — Clean Architecture on Frontend: https://bespoyasov.me/blog/clean-architecture-on-frontend/
- How to Structure a React Project in 2025 (dev.to): https://dev.to/algo_sync/how-to-structure-a-react-project-in-2025-clean-scalable-and-practical-15j6
- Recommended Folder Structure for React 2025 (dev.to): https://dev.to/pramod_boda/recommended-folder-structure-for-react-2025-48mc
- Atomic Design Pattern: Structuring Your React Application (Medium): https://rjroopal.medium.com/atomic-design-pattern-structuring-your-react-application-970dd57520f8
- Clean Architecture With React (Better Programming): https://betterprogramming.pub/clean-architecture-with-react-cc097a08b105
- Godel Technologies — FSD: A Guide To Scalable Frontend Architecture: https://www.godeltech.com/blog/feature-sliced-design-a-guide-to-scalable-frontend-architecture/
