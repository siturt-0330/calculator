---
tags: [research, クリーンコード, パフォーマンス, react-native, expo]
---

# React Native・Expo パフォーマンス最適化

> Web ディープリサーチ + 実 Geek (geek-v4) コードの突合せノート。
> 「何が遅いか」を **2 つのスレッド** と **フレーム予算** の言葉で語れるようになるのが第一歩。
> 関連: [[パフォーマンス最適化]] は実コードの hotspot 台帳、こちらは原理・パターンの一次情報まとめ。
> 姉妹ノート [[UI の滑らかさ — スクロール追従と画面遷移]] = スクロール追従・画面遷移・遷移アニメ・Web INP に特化した「なめらかさ」研究。
> 横断: [[Zustand・React Query ベストプラクティス]] / [[画像・メディアパイプライン]] / [[フィード・ランキング・レコメンド]] / [[モバイル UX 品質指標]] / [[地雷・落とし穴 総覧]]

---

## 定義・原則

### 2 つのスレッドとフレーム予算 (これが土台)

React Native の性能議論はほぼ全て「**JS スレッド** と **UI (Main) スレッド** のどちらが詰まっているか」に帰着する。

| スレッド | 担当 | 詰まると起きること |
|---|---|---|
| **JS スレッド** | ビジネスロジック / React の render・reconciliation / API 呼び出し / タッチイベント処理 / `setState` | タップ反応の遅延、リスト描画の遅れ、`Animated`(JS駆動) のカクつき |
| **UI / Main スレッド** | ネイティブ描画、`ScrollView`/`FlatList` のスクロール自体、`useNativeDriver:true` の Animated、Reanimated worklet | スクロール中のジャンク、重い view ツリーの合成落ち |

- **フレーム予算**: 60FPS なら **1 フレーム ≈ 16.67ms**。120Hz ProMotion なら **約 8ms**。この予算を 1 フレームでも超えるとドロップ = 体感ジャンク。
- 重要な含意: **スクロール自体は UI スレッドで走る**ので、JS スレッドが多少詰まってもネイティブ ScrollView はスクロールできる。だが「スクロールに追従して JS で新しいセルを描く」処理は JS スレッドなので、ここが間に合わないと **blank cell (白い穴)** が出る。リスト最適化の本質はこの追従。
- 計測の鉄則: **必ず release ビルドで測る**。dev ビルドは warning/error チェックの overhead が大きく、性能数値が全く当てにならない。

### 主要メトリクス
- **TTI (Time To Interactive)**: 起動してから操作可能になるまで。Hermes / バンドルサイズ / スプラッシュ演出が効く領域。
- **FPS**: スクロール・アニメ中のなめらかさ。リスト仮想化 / Reanimated / 再レンダ抑制が効く領域。
- **INP / interaction-to-next-paint**: タップしてから画面が変わるまで。`requestAnimationFrame` でのフィードバック分離が効く。

### 最適化の優先順位 (ROI 順の経験則)
1. **リスト仮想化** (FlatList → FlashList) — 大量データ画面では桁違いに効く
2. **不要な再レンダの抑制** (`memo` / 安定参照 / atomic selector)
3. **重い処理を UI スレッド or ネイティブへ逃がす** (Reanimated worklet / `useNativeDriver`)
4. **バンドルサイズ / 起動** (Hermes / tree-shaking / フォント subset / `transform-remove-console`)
5. **画像** (サムネ化・キャッシュ・prefetch)

---

## 具体例 (コードブロック)

### 1. リスト仮想化 — FlashList (cell recycling)

`FlatList` は `VirtualizedList` ベースで「画面外セルを unmount」する。`FlashList` は **RecyclerListView 方式の cell recycling** — 画面外に出た view を**捨てずに再利用**して中身だけ差し替える。view の生成/破棄コストが消えるのでスクロールが軽い。

```tsx
import { FlashList } from '@shopify/flash-list';

<FlashList
  data={items}
  renderItem={({ item }) => <Row item={item} />}
  keyExtractor={(it) => it.id}          // ❌ index を key にしない (recycle で崩れる)
  getItemType={(it) => it.type}         // ★ 種類別に recycle pool を分ける → 同型セル間でのみ再利用
  estimatedItemSize={640}               // v1: 必須。初期描画数・overscan の計算基準
  drawDistance={600}                    // viewport 外に先行描画する px (大きいほど blank が減るが重い)
/>
```

- **`estimatedItemSize` (v1)**: 実測の P50〜P75 に近い値を入れる。**過小だと overscan バッファが小さくなり、fast scroll で blank が出る**。過大だと余分に描いて重い。
- **`getItemType`**: 投稿カードと広告カードのように見た目が違うものを混ぜるとき必須。これが無いと別レイアウトのセルを recycle しようとして無駄な再レイアウトが起きる。
- **FlashList v2 (新アーキ前提・2025〜)**: New Architecture の**同期レイアウト測定**を使い、**`estimatedItemSize` が不要**になった。Progressive rendering → type ベース予測 → `useLayoutEffect` での paint 前補正、の 3 段で「推定なしで pixel-perfect」を実現。`maxItemsInRecyclePool` で pool 上限を制御、masonry が prop 化、`maintainVisibleContentPosition` が既定 ON (チャット/フィードの差分追加でスクロール位置が飛ばない)。**JS-only 実装**になり web サポートも改善。
- FlatList しか選べない場合の追い込み: `getItemLayout`(測定スキップ)、`removeClippedSubviews`、`windowSize`/`maxToRenderPerBatch`/`initialNumToRender` のチューニング。

### 2. UI スレッドアニメ — Reanimated worklet

`'worklet'` ディレクティブ付き関数は **UI スレッド上の別 JS ランタイム**で同期実行される。JS スレッドの混雑と無関係に 60FPS を出せる。

```tsx
const progress = useSharedValue(0);   // JS↔UI 間で JSI 経由・同期共有される値

// UI スレッドで毎フレーム評価されるスタイル (JS スレッドを介さない)
const style = useAnimatedStyle(() => ({
  opacity: progress.value,
  transform: [{ translateY: (1 - progress.value) * 12 }],
}));

const pan = Gesture.Pan().onChange((e) => {
  'worklet';                          // ← この関数は UI スレッドで走る
  progress.value = clamp(e.translationX / WIDTH, 0, 1);
}).onEnd((e) => {
  'worklet';
  progress.value = withSpring(e.velocityX > 0 ? 1 : 0);
  runOnJS(setOpen)(true);             // ★ UI→JS へ戻すときは runOnJS
});
```

- **`runOnJS` / `runOnUI`**: worklet (UIスレッド) から `setState` 等の JS 関数を呼ぶには `runOnJS` で包む。逆に JS から worklet を発火するのが `runOnUI`。
- **旧 `Animated` + `useNativeDriver:true`**: Reanimated を入れない場合の手段。アニメ情報を開始前に一括でネイティブへ送って UI スレッドで再生する。**制約: `transform` / `opacity` / `backgroundColor` など非レイアウト系のみ。`width`/`height`/`flex` はレイアウト再計算が要るので native driver 不可。**
- **iOS で width/height を直接アニメすると重い** → `transform:[{scale}]` で代替する (レイアウトを動かさず合成だけで済む)。

### 3. 不要な再レンダの抑制 — 安定参照 + memo

リスト行はとにかく再レンダさせないのが正義。`React.memo` は **props の参照** で再レンダ要否を判定するので、**親が毎 render で新しい配列・オブジェクト・アロー関数を渡すと memo が即死する**。

```tsx
// ❌ renderItem 内で毎回新しい配列/関数 → 子の memo が常に false
<Row data={item.tags ?? []} onPress={() => go(item.id)} />

// ✅ 空配列はモジュール定数で共有、ハンドラは id 別に useMemo でキャッシュ
const EMPTY: string[] = [];
const handlers = useMemo(() => {
  const dict: Record<string, () => void> = {};
  for (const id of ids) dict[id] = () => go(id);
  return dict;
}, [ids, go]);                        // ids (安定 ID セット) が変わった時だけ作り直す
<Row data={item.tags ?? EMPTY} onPress={handlers[item.id]} />
```

- `useMemo` = 重い計算結果 / 参照の安定化。`useCallback` = 関数参照の安定化。**どちらも「子の memo を生かす」「下流 useMemo の deps を安定させる」ためにある**。
- カスタム `arePropsEqual` を `memo(Comp, (prev,next)=>...)` で渡すと、比較するキーを明示できて意図が読める (後述 Geek の `AnonPostCard` が好例)。

### 4. バンドル / 起動 — Hermes・console strip・tree-shaking

```js
// babel.config.js — production だけ console.log を除去 (error/warn は残す)
plugins: [
  ['transform-remove-console', { exclude: ['error', 'warn'] }],
]
```

- **Hermes**: JS を**ビルド時に bytecode へ AOT コンパイル**。起動時に JS パースが要らず TTI 短縮、メモリ削減、JSC より小さいバイナリ (JSC ~12MB→Hermes ~8MB、HermesV1 で 2.8→2.1MB 等の実測報告)。Expo の**既定エンジン**。`app.json` の `"jsEngine": "hermes"`。
- **console.log は本番で確実に消す**: JS スレッドで実行され、特にループ/スクロール中だと重い。
- **バンドル削減**: 巨大 barrel import (`import { X } from 'icon-lib'`) は Metro が tree-shake しないので、**per-icon の deep import** に書き換えると未使用分が落ちる (後述 Geek の lucide 対策)。

---

## よくあるアンチパターン

| アンチパターン | なぜ悪い | 正しいやり方 |
|---|---|---|
| dev ビルドで性能を測る | 数値が overhead で全く当てにならない | release / production ビルドで計測 |
| `key={index}` (リスト/`.map`) | recycle・並び替え・削除で行が崩れる、FlashList で特に致命的 | 一意な `id` を key に |
| `renderItem` 内で `?? []` / `() => {}` を直書き | 毎 render 新参照 → 子 `memo` が全滅 → 全カード再レンダ | モジュール定数の空配列 / `useMemo` 化したハンドラ辞書 |
| Zustand/Context を**全 destructure** で購読 | store の **どこか 1 フィールド**変更で全 subscriber が再レンダ | atomic selector `useStore(s => s.x)` で必要な値だけ購読 |
| `width`/`height`/`flex` を Animated | レイアウト再計算で native driver 不可・重い | `transform:[{scale}]` / `translate` で合成のみ |
| `FlatList` で巨大リスト + 重いセル | unmount/再 mount のコスト + blank cell | FlashList(recycle) + `getItemType` |
| `console.log` を本番に残す | JS スレッド浪費、特に高頻度経路で顕著 | `transform-remove-console` で除去 |
| 巨大アイコン/ユーティリティ barrel を named import | tree-shake されず全部バンドルに乗る | deep import / 使う分だけ import |
| `onScroll` の結果を `setState` | 毎スクロールで画面全体が再レンダ | `useRef` に書いて再レンダを起こさない |
| worklet 内から直接 `setState` | クラッシュ / 動かない (スレッド違い) | `runOnJS(setState)(...)` で JS スレッドへ戻す |
| `estimatedItemSize` を過小設定 (v1) | overscan が痩せて fast scroll で白い穴 | 実測 P50〜P75 に合わせる、or v2 へ移行して撤廃 |

---

## ★ Geek (geek-v4) への適用

Geek は RN **0.76.9 + Expo SDK 52 + New Arch + Hermes**。上記の原則がほぼ全領域で実装済み。詳細台帳は [[パフォーマンス最適化]]。

### リスト仮想化 — FlashList 1.7.3 (= v1)
- `app/(tabs)/feed.tsx` のホームフィードが `@shopify/flash-list@1.7.3`。**v1 なので `estimatedItemSize` が必須**で、現在 **`estimatedItemSize={640}`**（mixed feed=text+media の P50/P75 経験値）、`drawDistance={600}`。
  - 過去の地雷: `estimatedItemSize 300→520→640` / `drawDistance 250→600` と段階調整した。メディアカード実寸 500-700px に対し**過小見積もりが blank セル/位置ズレ**を起こしていた (memory: perf_hotspots)。
- **`getItemType={(item) => isAdItem(item) ? 'ad' : 'post'}`** で投稿カードと広告カードの recycle pool を分離。混在フィードの正しい型分けの実例。
- `keyExtractor` は `isAdItem(item) ? item.key : item.id` で**一意 id 厳守**(index key 禁止は CLAUDE.md §14 にも明記)。
- ページ境界の**重複 id を Set で de-dup** (`hooks/useFeed.ts` の `rawPosts` useMemo)。cursor pagination の tie-break 漏れで同一 post が複数ページに跨ると、FlashList の keyExtractor が同 key を 2 回返し "same key" 警告フラッド + 表示崩れになるため。
- **将来課題**: New Arch 前提なら **FlashList v2 へ移行で `estimatedItemSize` 撤廃** + `maintainVisibleContentPosition` 既定 ON が効く (フィードの新着差し込みでスクロール位置が飛ばない)。ただし v1→v2 は API 契約変更があるので flag-gated で検証ロールアウトが筋。

### 再レンダ抑制 — 安定参照の徹底
- `feed.tsx` 冒頭にモジュール定数 **`EMPTY_REACTIONS` / `EMPTY_ADDED_TAGS` / `EMPTY_COMMUNITIES` / `EMPTY_BOOL_MAP`**。`renderItem` で `?? []` を書くと毎回新配列 → `AnonPostCard` の memo が壊れて全カード再レンダする問題への対策。コメント曰く **「re-render を 15-22% 削減」**。
- **per-post ハンドラ辞書 `handlersByPostId`** (`feed.tsx`) を `useMemo`。deps を `posts`(毎 render 新参照) ではなく **`postIds`(安定 ID セット)** にし、background refetch で内容が同じなら全ハンドラ再生成を防ぐ。最新 `tag_names` は `postsRef.current` から逆引きして stale closure を回避。
- **`AnonPostCard` の明示的 `arePropsEqual`** (`components/feed/AnonPostCard.tsx:1231`) が load-bearing — 「このカードが本当に気にする props」だけを参照比較する:
  ```tsx
  export const AnonPostCard = memo(AnonPostCardInner, (prev, next) => {
    if (prev.post !== next.post) return false;
    if (prev.liked !== next.liked) return false;
    // ... reactions/addedTags/poll/communities/各ハンドラを参照比較 ...
    return true; // それ以外は skip re-render
  });
  ```
  ハンドラ参照が親で安定化されているからこの比較が成立する (上の `handlersByPostId` とセット)。子コンポーネント `SingleMediaItem` / `ReactionPill` / `AdCard` / `TrendingRow` も個別に `memo` 済。
- **atomic Zustand selector** が全面方針 (CLAUDE.md §5.4)。`useFeedStore((s) => s.sort)` のように 1 フィールドずつ購読。`_layout.tsx` で settings 16 フィールドを全 destructure して navigation tree 全体が再レンダ→「かくかく」した事故が原典。未読バッジも `useUnreadCount` の `select` で**件数(number)まで絞る** narrow selector 化済 (配列全体購読→件数不変でも再レンダしていた)。詳細は [[Zustand・React Query ベストプラクティス]]。
- `extraData={fullPosts}` を FlashList に渡す注意点: FlashList は `data` 参照が変わらないと再レンダしない。スタンプ toggle が feed-page cache のみ更新する場合に行が更新されないため、cache 由来の `fullPosts` を `extraData` に渡して強制再レンダ経路を確保している (memo が中身比較するので過剰描画はしない)。

### UI スレッド / 60FPS — Reanimated 3.16 worklet
- HomeDrawer (X 風左ドロワー) が `feed.tsx` の worklet 実装の見本。`drawerProgress = useSharedValue(0)` を UI スレッドで共有し、`Gesture.Pan().onChange((e)=>{ 'worklet'; ... })` で指追従、`onEnd` で `withSpring`。**コミット確定時に `runOnJS(setDrawerOpen)(true)`** で JS 側の scroll lock を即時化し、開アニメ中の縦スクロール競合と着地フレームのカクつきを排除。
- 速度に応じた挙動切替も worklet/ref で実装: `handleScroll` は **`onScroll` の結果を `useRef`(`scrollVelocityRef`) に書く** (state にすると毎スクロールで feed 全体が再レンダ)。low-pass フィルタ(0.7旧+0.3新)でスパイク抑制。`scrollEventThrottle={16}` で 60fps サンプル。
- per-row 入場アニメ `FeedRowEnter` (opacity 0→1 + translateY 12→0): **render 中に shared value を書かず `useEffect` で開始** (並行モードの二重 invocation でアニメが走らない問題回避)、stagger を `index*40ms` で **上限 6 cell=240ms に cap** (50+ items でも待たされない)、**reduceMotion 時は初期値 1/0 で固定して即表示**。
- reduce-motion 配慮は [[モバイル UX 品質指標]] / [[i18n・テーマ・デザインシステム]] とも連動 (`useReducedMotion`)。

### バンドルサイズ — lucide barrel + フォント
- **lucide-react-native barrel 対策が白眉**。`constants/icons.ts` で「実際に使うアイコンだけ」を named import した中央レジストリにし、**`babel.config.js` の `lucideDeepImportsPlugin`** (production のみ) が全 named import を `lucide-react-native/dist/esm/icons/<kebab>` の **per-icon deep import に AST 書換**。未使用 ~1460 icon をバンドルから落とす。
  - 実測効果: **web entry 7.2MB→5.64MB (-22%, gzip 1.46→1.31MB)**。旧名 (`Home→house`, `AlertTriangle→triangle-alert` 等 11 個) は `LUCIDE_ALIAS` map で canonical 名へ。`import type { LucideIcon }` は TS が elide するので無変換。
  - ⚠️ **Metro キャッシュ罠**: `babel.config.js` を変えても `.metro-cache/` は自動無効化されない。変更後は `.metro-cache/` 削除 (or `expo start --clear`) しないと旧変換が残り「効いてない」ように見える (実際 1 回目の build は 7.2MB のままだった)。
- **console strip**: `babel.config.js` で `transform-remove-console` を **production のみ** + `exclude:['error','warn']` (Sentry breadcrumb との整合)。CI で plugin が入らない事故に備え `require.resolve` で defensive にゲート (無くてもバンドルは動く)。
- **Reanimated plugin は必ず最後**: `'react-native-reanimated/plugin'` を plugins 配列末尾に固定 (worklet 解析が他 plugin 後の AST を見る必要があるため)。
- **フォントは残課題**: `@expo-google-fonts` の Noto Sans JP フル TTF 6weight=**26MB**, Inter 9weight ~2.8MB が dist に emit。ただし first paint はブロックしない (`useAppFonts` の 100ms forceFallback + system-font cascade)。改善は web で Google Fonts woff2 + unicode-range subset、または使う weight だけ deep import (font-family 名整合の検証が要る)。

### 画像
- 表示は必ず `lib/utils/imageUrl.ts` の `thumbedUrl()` で Supabase 変換 endpoint 経由 (帯域削減)。`expo-image` + `cachePolicy='memory-disk'`。
- **velocity-aware prefetch** (`feed.tsx`): viewport の最終 index から先を `ExpoImage.prefetch(thumbedUrl(u,480),'memory-disk')` で先読み。lookahead を **scroll px/s で 3→6→10 に切替** (静止/fast/fling)、**同時 prefetch 上限 4** (browser の host あたり 6 接続制限対策)、試行済 URL を Set で dedup。prefetch URL の `width=480` は表示側 `ProgressiveImage` の thumbWidth と**一致必須** (一致しないと cache hit しない)。
- 画像系の罠 (resize=cover の潰れ等) は [[画像・メディアパイプライン]] / CLAUDE.md §5.10 に集約。

---

## 出典 (URL一覧)

- React Native 公式 — Performance Overview: <https://reactnative.dev/docs/performance>
- React Native 公式 — Using Hermes: <https://reactnative.dev/docs/hermes>
- Expo 公式 — Using Hermes Engine: <https://docs.expo.dev/guides/using-hermes/>
- Shopify Engineering — FlashList v2: a ground-up rewrite for the New Architecture (2025): <https://shopify.engineering/flashlist-v2>
- FlashList 公式 — Writing performant components: <https://shopify.github.io/flash-list/docs/1.x/fundamentals/performant-components/>
- React Native Reanimated 公式 — Glossary (worklet / runOnUI / shared values / useAnimatedStyle): <https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/glossary/>
- Callstack — The Ultimate Guide to React Native Optimization (ebook): <https://www.callstack.com/ebooks/the-ultimate-guide-to-react-native-optimization>
- anisurrahman072 — React Native Advanced Guide (Performance Optimization coding guide): <https://github.com/anisurrahman072/React-Native-Advanced-Guide/blob/master/Performance-Optimization/Performance-Optimization-coding-guide.md>
- Whitespectre — FlashList vs FlatList: <https://www.whitespectre.com/ideas/better-lists-with-react-native-flashlist/>
- 関連 Geek 実コード: `geek-v4/app/(tabs)/feed.tsx` / `geek-v4/hooks/useFeed.ts` / `geek-v4/components/feed/AnonPostCard.tsx` / `geek-v4/babel.config.js` / `geek-v4/constants/icons.ts`
