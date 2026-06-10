---
tags: [research, パフォーマンス, 滑らかさ, smoothness, react-native, expo, flashlist, navigation, reanimated, web-vitals]
---

# UI の滑らかさ — スクロール追従と画面遷移

> 「**なめらかに動く**」を一次情報で分解したノート。`/deep-research`(21 一次ソース・100 主張→25 を 3票敵対検証→**0 件却下**) + 実 Geek (geek-v4) コードの突合せ。
> 既存 [[React Native・Expo パフォーマンス最適化]] が「**何が遅いか**(スレッド/フレーム予算/FlashList/memo/Hermes/バンドル)」を扱うのに対し、こちらは「**何がカクつくか / 引っかかるか**」= **スクロール追従**と**画面遷移**の滑らかさに特化する。
> 横断: [[パフォーマンス最適化]](実コード台帳) / [[モバイル UX 品質指標]] / [[フィード・ランキング・レコメンド]] / [[画像・メディアパイプライン]] / [[地雷・落とし穴 総覧]]

---

## 0. 「滑らか」を定義する — 3 つの体感と、それぞれの犯人

ユーザーが「なめらか」と感じるかは、実は **別々の 3 つの指標**に分かれる。混ぜて議論すると直せない。

| 体感 | 指標 | 詰まる場所 | 主な犯人 |
|---|---|---|---|
| **スクロールがヌルッと追従する** | FPS / フレームドロップ | スクロール追従の **JS スレッド**(新セル描画) | 行の再レンダ・重いセル・画像 decode・overscan 不足 |
| **タップ→画面が即変わる** | INP / interaction-to-next-paint | タップ処理の **JS スレッド** | 重い同期処理・遷移直前の再レンダ・blank screen |
| **画面遷移がスーッと流れる** | 遷移アニメの FPS | 遷移アニメの実行スレッド | **JS stack** だと JS スレッド・off-screen の無駄描画・freeze 不足 |

**フレーム予算 (大前提):** 60FPS = **1 フレーム 16.67ms**、120Hz ProMotion = **約 8.3ms**。1 フレームでも超えると 1 枚落ちて「カクッ」と知覚される。滑らかさ最適化とは「**毎フレーム予算内に収める**」こと、ただそれだけ。

**2 スレッドモデル (RN 公式):** RN は **JS スレッド**(ロジック・React reconciliation・タッチ処理・`setState`) と **UI/Main スレッド**(ネイティブ描画・ScrollView のスクロール自体・`useNativeDriver`/Reanimated worklet) を持つ。新アーキ(Fabric) では shadow tree が**イミュータブル**になり、高優先イベントは UI スレッド側で**同期**処理できる経路を持つ — これがスレッド安全性と応答性の土台。<sup>[RN-thread][RN-fabric]</sup>

> [!important] 滑らかさの第一原理
> **「スクロール」と「遷移アニメ」自体は UI スレッドで走り得る**。問題は必ず「**それに JS スレッドが追従できているか**」。だから滑らかさ対策は (a) JS スレッドの仕事を減らす、(b) 仕事を UI スレッドへ逃がす、(c) 先に描いておく(prefetch/overscan)、の 3 種類しかない。

---

## 1. リスト/スクロールの滑らかさ

### 1.1 カクつき・白い穴 (blank cell) の根本原因

スクロールは UI スレッドで進むが、**画面に入ってくる新セルの描画は JS スレッド**。スクロール速度に JS の描画が間に合わないと、まだ描けていない領域が **blank(白い穴)** になる。これが「fast scroll で白くチラつく」の正体。

対策は 2 系統:
1. **1 セルの描画を軽くする** → 再レンダ削減・memo・軽いツリー・画像 decode 削減
2. **先に広めに描いておく** → overscan(FlatList の `windowSize`/`maxToRenderPerBatch`、FlashList の `drawDistance`)

### 1.2 FlatList のチューニング (公式 4 ノブ) <sup>[RN-flatlist]</sup>

`FlatList`/`VirtualizedList` を使う場合、公式が挙げる効くノブ:

| prop | 効果 | トレードオフ |
|---|---|---|
| **`getItemLayout`** | 全アイテムが**同じ高さ**なら、これを与えると**動的測定をスキップ**でき、描画が速くなる | 高さが可変だと使えない |
| **`windowSize`** | レンダリング窓(viewport の何倍を保持するか)。**大きい=blank が減るがメモリ増、小さい=省メモリだが fast scroll で blank** | メモリ ↔ blank のトレードオフそのもの |
| **`maxToRenderPerBatch`** | 1 バッチで描く件数。**大きいほど可視 blank が減るが、その間 JS が詰まり応答が落ちる** | 描画密度 ↔ 応答性 |
| **`initialNumToRender`** | 初回に描く件数。first paint を軽くする | 初期スクロールで足りないと blank |

行コンポーネントは **`React.memo` で包んで再レンダを最小化**するのが公式の指示。<sup>[RN-flatlist]</sup>

### 1.3 FlashList — recycling という別物 <sup>[FL-perf][FL-known]</sup>

`FlashList` の速さの本質は **cell recycling**: 画面外に出た view を**破棄せず再利用**し中身だけ差し替える。view の生成/破棄コストが消えるのでスクロールが軽い。

**やってはいけない (公式 known-issues):**
- **アイテム内に `key` prop を付けない** → recycling を壊し、リサイクル時に再マウントが走って逆に重くなる。
- **FlatList の drop-in 置換ではない** → アーキテクチャが根本的に違う。`renderItem`/サイズ推定/`getItemType` を FlashList 流に書き直す必要がある。

**v1 (現行 Geek = 1.7.3) の必須作法:**
- `estimatedItemSize` を実測 P50〜P75 に。**過小だと overscan が痩せて fast scroll で blank**。
- `getItemType` で見た目の違うセル(投稿/広告)の recycle pool を分離。
- `keyExtractor` は一意 id (index 禁止)。

**v2 (新アーキ前提・2025〜) <sup>[FL-v2]</sup>:** 同期レイアウト測定で **`estimatedItemSize` 不要**、`maintainVisibleContentPosition` 既定 ON(新着差し込みでスクロール位置が飛ばない)、JS-only 実装で **web サポート改善**。→ Geek は New Arch なので移行候補(後述 §9)。

### 1.4 画像の decode を追従の邪魔にしない

スクロール中の最大の隠れコストは**画像 decode**(JPEG/PNG をピクセルに展開)。対策:
- **サムネ化**: 表示解像度ぴったりの幅で配信(Geek は `thumbedUrl(url, 480)`)。フル解像度を decode させない。
- **prefetch**: viewport 直前のセルの画像を**先読み**してキャッシュに載せ、表示時 decode 済みにする。
- **placeholder/blurhash**: decode 完了までの間を blur で埋め、レイアウトシフト(CLS)を出さない。
- 詳細は [[画像・メディアパイプライン]]。

---

## 2. 画面遷移/ナビゲーションの滑らかさ

ここが今回の研究で**最も収穫が大きかった**領域。「遷移がもっさり」「タブ切替で白くなる」「戻るが引っかかる」はほぼ全て下記で説明・対策できる。

### 2.1 native-stack > JS stack (これが分水嶺) <sup>[RNNav-stack][Expo-stack]</sup>

React Navigation の Stack には 2 種類ある:

| | **Native Stack** (`@react-navigation/native-stack`) | **JS Stack** (`@react-navigation/stack`) |
|---|---|---|
| 描画 | **ネイティブのナビゲーションプリミティブ**(`react-native-screens` の `UINavigationController`/`Fragment`)で描く | JS + Animated/gesture-handler で**JS 側で再現** |
| 遷移アニメ | **OS ネイティブの遷移**(UI スレッド) | **JS スレッド**でアニメを駆動 |
| 滑らかさ | OS と同じ・重い画面でもヌルッ | JS が詰まると遷移がカクつく |
| カスタム性 | OS の範囲(やや制約) | 自由にカスタム可 |

**結論:** 滑らかさ最優先なら **native-stack**。**Expo Router の `Stack` は内部で native-stack を使い、プラットフォーム固有のネイティブ遷移を既定適用する**<sup>[Expo-stack]</sup>。→ Geek は Expo Router なので**既にネイティブ遷移が効いている**(下記 §9 で確認)。

### 2.2 react-native-screens — そもそも何をしているか <sup>[RNS]</sup>

`react-native-screens` は**ネイティブのスクリーンコンテナ**を公開し、各画面を OS のネイティブ view 階層に載せる。これにより:
- **off-screen の画面をネイティブ側で detach/freeze** できる(メモリ・描画コスト削減)。
- ネイティブ遷移・ジェスチャ(iOS の edge swipe back 等)が**OS ネイティブ品質**になる。

modern RN では既定 ON。Expo Router/React Navigation はこれ前提で動く。

### 2.3 off-screen を凍結する — `freezeOnBlur` / react-freeze <sup>[react-freeze]</sup>

`react-freeze` は **画面外の React サブツリーの再レンダを止める**(Suspense を利用)。重要な性質:
- **凍結された画面は unmount されない** → 戻ったとき**状態が保持**され、再構築コストもゼロ。
- スタックナビでは、隠れている画面の**裏での無駄な再レンダを抑止**できる。

React Navigation では各画面の **`freezeOnBlur: true`** で有効化。**タブが裏に回っている間に走る無駄な再レンダ・タイマー・再計算を止める** → 前面のスクロール/遷移にフレーム予算を集中できる。

### 2.4 ⚠️ タブ切替で白くなる本当の原因 <sup>[RNNav-12755]</sup>

研究で特定した重要知見。**bottom-tab の blank-screen バグは `detachInactiveScreens: true` + 高速なタブ切替**の組み合わせで起きると報告されている(react-navigation #12755)。

- `detachInactiveScreens=true` は非アクティブ画面をネイティブ側から外してメモリを節約するが、**素早く切り替えると detach→再attach が描画に間に合わず一瞬白くなる**。
- 対策の方向: blank が出るタブでは **`detachInactiveScreens={false}`**(or 該当画面だけ freeze に切替)、あるいは **`lazy` + preload** で先に mount しておく。
- bottom-tab の **`animation` prop**(@react-navigation の比較的新しい指定)でタブ切替自体にアニメを付けられるが、これと detach の相互作用に注意。<sup>[RNNav-12755]</sup>

### 2.5 Shared Element Transition (SET) — 期待しすぎない <sup>[RNNav-shared]</sup>

「画像が一覧→詳細でスーッと拡大」の SET は魅力的だが、研究の結論は**慎重**:
- **experimental**(API が不安定・将来変わり得る)。
- **native stack でしか動かない**。
- → プロダクションの中核 UX に組むのはまだ早い。**やるなら ProgressiveImage の blurhash 連続性 + 共有レイアウト寸法**で「擬似的に繋がって見える」方を先に詰める方が堅実(Geek は既にこの路線)。

### 2.6 遷移の interruptibility(割り込み可能性)

滑らかな遷移は「**途中で指で引き戻せる**」。native-stack + gesture-handler の edge-swipe back は OS ネイティブなので割り込み可能。JS stack で頑張るより、**ネイティブ遷移に任せる**のが最短。ジェスチャ駆動の自前遷移を作るなら Reanimated worklet + shared value で UI スレッド完結にする(§4)。

---

## 3. 体感速度(perceived performance) — 「速く感じさせる」

実時間を縮めなくても**速く感じさせる**技術。滑らかさと両輪。

- **スケルトン / placeholder**: 空白やスピナーより、最終レイアウトに近い骨組みを即出す。**レイアウトシフトを出さない**ことが肝(後述 CLS)。
- **楽観的更新 (optimistic update)**: いいね等はサーバ応答を待たず即 UI を更新し、失敗時のみロールバック。タップ→反映の体感がゼロ遅延に。
- **prefetch / cache seed**: 次に見る画面のデータ・画像を**事前取得**、または遷移元が持つデータで遷移先 cache を**シード**して spinner を消す。
- **遷移の interruptibility**: §2.6。止められる/引き返せると「自分が制御している」感が出て滑らかに感じる。
- **`<200ms` は skeleton を出さない**: cache hit の高速応答時に skeleton をチラ見せすると逆に「点滅」して汚い。遅延表示(delayed loading)で回避。

→ 実装の実態は [[パフォーマンス最適化]] の「データ取得」「レンダリング」節、状態管理は [[Zustand・React Query ベストプラクティス]]。

---

## 4. アニメーションのベストプラクティス

### 4.1 Reanimated worklet — UI スレッドで動かす <sup>[Reanimated-glossary][Reanimated-worklets]</sup>

- **worklet** = `'worklet'` ディレクティブ付きの短命 JS 関数で、**UI スレッド上の別ランタイムで同期実行**される。JS スレッドの混雑と無関係に 60/120FPS を出せる。
- **shared value** = 全 Reanimated アニメの駆動源。**JS↔UI 間で JSI 経由・自動同期**される値。`useAnimatedStyle` は UI スレッドで毎フレーム評価される。
- worklet から JS の `setState` を呼ぶには **`runOnJS`**、逆は `runOnUI`。
- **render 中に shared value を書かない**(並行モードの二重実行でアニメが走らない)。開始は `useEffect` で。

### 4.2 旧 Animated + `useNativeDriver`

Reanimated を使わない場合の手段。アニメ情報を開始前に一括でネイティブへ送り UI スレッドで再生。**制約: `transform`/`opacity`/`backgroundColor` など非レイアウト系のみ。`width`/`height`/`flex` はレイアウト再計算が要るので native driver 不可** → `transform:[{scale}]`/`translate` で代替。

### 4.3 Layout Animation / Moti

- **Layout Animation**: 次の再レイアウトを自動でアニメ補間。手軽だが細かい制御は弱い。新アーキでの挙動は要確認。
- **Moti**: Reanimated の上に乗る宣言的 API。内部は worklet なので UI スレッド。**今回の研究の検証対象には含まれなかった**(caveat)ので、導入時は実測で確認。

---

## 5. Web 固有の滑らかさ (React Native Web / Expo Web)

native の話と**別物**。ブラウザは「**メインスレッド 1 本**」で JS もレイアウトも描画も回す。詰まると即カクつく。web.dev の一次情報ベース。<sup>[webdev-inp][webdev-compositor][webdev-layout][webdev-cls]</sup>

### 5.1 INP (Interaction to Next Paint) を縮める <sup>[webdev-inp]</sup>
- タップ→次の描画までを縮める指標(Core Web Vitals)。**長い JS タスクを分割**(`yield`/`scheduler`)し、入力ハンドラを軽く保つ。
- 重い処理は `requestIdleCallback`/タスク分割で逃がし、**入力に対して即・小さく描く**。

### 5.2 compositor-only プロパティだけでアニメする <sup>[webdev-compositor]</sup>
- **`transform` と `opacity` のみ**でアニメすると、**コンポジタスレッド**で処理され、レイアウト/ペイントを起こさず GPU 合成だけで動く=ヌルッと 60FPS。
- `top/left/width/height/margin` をアニメすると**レイアウト→ペイント→合成**の全工程が毎フレーム走り重い。
- **レイヤー数は管理する**: `will-change: transform` は GPU レイヤーを作って合成を速くするが、**貼りすぎるとメモリを食って逆効果**。アニメ直前に付けて終わったら外すのが理想。

### 5.3 layout thrashing を避ける <sup>[webdev-layout]</sup>
- **書き込み(style 変更)と読み取り(`offsetHeight` 等)を交互にやると**、ブラウザが強制同期レイアウトを繰り返して激重になる(forced synchronous layout / thrashing)。
- **読み取りをまとめてから書き込みをまとめる**(batch read → batch write)。
- レイアウトは**複雑さに比例**して重い。深い/広いツリーのレイアウトを毎フレーム触らない。

### 5.4 CLS(レイアウトシフト)を出さない <sup>[webdev-cls]</sup>
- 画像/広告/遅延要素には**事前に寸法を予約**(width/height or aspect-ratio)。後から入って**ガタッと動く**のを防ぐ。
- skeleton は最終レイアウトと**同じ寸法**で。

> [!note] Geek の web は RN Web 経由
> Reanimated worklet は web では JS フォールバック(`_WORKLET` polyfill)になり、`transform`/`opacity` の CSS に落ちる。**つまり §5.2 の compositor-only 原則がそのまま効く** — Geek のアニメが transform/opacity 中心なのは web でも正しい。`will-change` は Reanimated が管理(現状コードに明示 `will-change` 無し=妥当)。

---

## 6. 計測 — 推測で直さない <sup>[RN-profiling]</sup>

| 対象 | ツール | 見るもの |
|---|---|---|
| **native の FPS/フレームdrop** | RN 公式 **Perf Monitor** / DevTools の profiling<sup>[RN-profiling]</sup> | JS FPS と UI FPS を**別々に**。UI が落ちてれば描画ツリー、JS が落ちてれば再レンダ |
| **React の再レンダ** | React DevTools **Profiler** | どのコンポーネントが何回・なぜ再レンダしたか(why-did-you-render 的) |
| **web の応答性** | Lighthouse / Web Vitals (**INP** / **CLS**) | タップ→描画、レイアウトシフト |
| **web の長タスク** | Performance パネル(Long Tasks) | メインスレッドを 50ms 以上塞ぐ JS |

**鉄則:**
- **必ず release/production ビルドで測る**。dev ビルドの数値は overhead で当てにならない。
- **JS FPS と UI FPS を分けて見る**(犯人スレッドが変わると対策が真逆になる)。
- 「直った」は実測で確認。green build(type-check/lint 0)≠ 滑らか。→ [[地雷・落とし穴 総覧]]。

---

## 7. アンチパターン総覧(やってはいけない)

| アンチパターン | なぜカクつく/引っかかる | 正しいやり方 | 出典 |
|---|---|---|---|
| FlashList のアイテムに `key` を付ける | recycling を壊して再マウントが走る | `key` を付けない・`keyExtractor` 側で一意 id | [FL-known] |
| FlashList を FlatList の drop-in と思って移植 | アーキ非互換で崩れる/効かない | `getItemType`/サイズ推定/`renderItem` を FlashList 流に | [FL-known] |
| 重い画面遷移を **JS stack** でやる | 遷移アニメが JS スレッドで詰まる | **native-stack**(Expo Router 既定) | [RNNav-stack][Expo-stack] |
| `detachInactiveScreens=true` のまま高速タブ切替 | detach→再attach が間に合わず**白画面** | blank が出るタブは `false`、or `lazy`+preload | [RNNav-12755] |
| off-screen 画面を凍結しない | 裏で無駄に再レンダして前面の予算を食う | `freezeOnBlur:true` / react-freeze | [react-freeze] |
| SET をプロダクション中核に組む | experimental・native 限定で不安定 | blurhash 連続性+共有寸法で擬似 SET | [RNNav-shared] |
| web で `top/left/width/height` をアニメ | 毎フレーム layout→paint→composite | `transform`/`opacity` のみ(compositor) | [webdev-compositor] |
| web で style 書込と寸法読取を交互 | 強制同期レイアウト(thrashing) | read をまとめ→write をまとめる | [webdev-layout] |
| 遅延要素の寸法を予約しない | 後から入って CLS(ガタッ) | width/height/aspect-ratio を予約 | [webdev-cls] |
| dev ビルドで FPS を測る | overhead で数値が無意味 | release ビルドで計測 | [RN-profiling] |
| `width`/`height` を Animated(native) | レイアウト再計算で native driver 不可・重い | `transform:[{scale}]`/translate | — |
| worklet 内で直接 `setState` | スレッド違いで動かない/クラッシュ | `runOnJS(setState)(...)` | [Reanimated-glossary] |
| `onScroll` 結果を `setState` | 毎スクロールで画面全体が再レンダ | `useRef` に書いて再レンダを起こさない | — |

---

## 8. ★ チェックリスト(Geek のような Expo アプリにそのまま使える)

**リスト/スクロール**
- [ ] 大量リストは FlashList(recycle)。FlatList なら `getItemLayout`(等高なら)・`windowSize`・`maxToRenderPerBatch`・`initialNumToRender` を実測で調整
- [ ] 行コンポーネントは `React.memo` + 安定 props(空配列はモジュール定数・ハンドラは `useMemo` 辞書)
- [ ] FlashList: `estimatedItemSize`=実測 P50〜P75、`getItemType` で型分離、アイテムに `key` を付けない
- [ ] 画像はサムネ幅で配信 + viewport 直前 prefetch + blurhash placeholder
- [ ] `onScroll` の値は `useRef`(state にしない)

**画面遷移/ナビ**
- [ ] **native-stack** を使う(Expo Router の `Stack` は既定で OK)
- [ ] off-screen 画面に **`freezeOnBlur: true`**
- [ ] タブで白画面が出るなら `detachInactiveScreens` を見直す(高速切替 + detach の罠)
- [ ] 遷移は割り込み可能(ネイティブ edge-swipe back に任せる)
- [ ] SET は experimental と理解し、まず擬似 SET(blurhash 連続)で代替

**アニメ**
- [ ] アニメは Reanimated worklet(UI スレッド)/ shared value 駆動
- [ ] レイアウト系(width/height/flex)を直接アニメしない → transform/opacity
- [ ] render 中に shared value を書かない・worklet→JS は `runOnJS`
- [ ] `useReducedMotion` を尊重

**Web**
- [ ] アニメは `transform`/`opacity` のみ(compositor-only)
- [ ] `will-change` は貼りっぱなしにしない(レイヤー過多)
- [ ] read/write を batch 化(layout thrashing 回避)
- [ ] 遅延要素は寸法予約(CLS=0)・長 JS タスクを分割(INP)

**計測**
- [ ] release ビルドで測る・JS FPS と UI FPS を分けて見る
- [ ] React DevTools Profiler で再レンダ犯人を特定・web は INP/CLS を Lighthouse で

---

## 9. ★ Geek (geek-v4) への適用 — 現状と残ギャップ

Geek は RN **0.76.9 + Expo SDK 52 + New Arch + Hermes**。上の原則の**大半が既に実装済み**(詳細台帳: [[パフォーマンス最適化]])。本研究で**新たに見えたギャップ**だけ記す。

### 既に効いているもの(確認済)
- **FlashList 1.7.3** 全面採用: `estimatedItemSize`(feed=640)、`getItemType`(post/ad 分離)、velocity-aware 画像 prefetch(3→6→10 cell)、一意 keyExtractor。§1 をほぼ満たす。
- **native 遷移**: Expo Router `Stack` = 内部 native-stack + `contentStyle`(遷移中の白フラッシュ防止) + Platform 別 `animationDuration` + modal の vertical gesture。§2.1 は既に OK。
- **Reanimated 3.16 worklet** で全アニメ UI スレッド(HomeDrawer/FeedRowEnter/ProgressiveImage)。§4 を満たす。
- **体感速度**: skeleton + `useDelayedLoading(200)` + 楽観更新 + idle/押下 prefetch + cache seed。§3 を満たす。
- **web**: アニメは transform/opacity 中心(§5.2 準拠)、splash 注入、font subset。

### ✅ 2026-06-10 適用済み(本研究→18 候補を 3 レンズ敵対検証→P0 6 件適用。type-check/lint/test 704 全 green + bundle 実測で反映確認)
1. **`freezeOnBlur: true` を Tabs + root Stack に追加**(§2.3) — `app/(tabs)/_layout.tsx` / `app/_layout.tsx`。裏タブ/背面画面の再レンダ・effect を react-freeze で凍結(state 保持・native のみ・web は no-op)。root Stack 側は Fabric の shouldFreeze ガードで「深さ 2 以上」のみ凍結(modal 1 枚では背面凍結されない=仕様)。
2. **community フィードの FlashList を feed と同値に統一** — `estimatedItemSize` 520→**640**・`drawDistance` 250→**600**(同じ AnonPostCard を描く画面で値が乖離していた。1.7.3 は renderAheadOffset=drawDistance で blank に直接効くのは drawDistance [実証済])。
3. **`decelerationRate="fast"` を feed / community に追加** — bbs/tag/liked と慣性の止まり感を統一(3-0 全会一致)。
4. **community の画像 prefetch に dedup(Set) + 同時実行 cap=4 を移植** — 旧実装は無制限・dedup 無しで可視画像の本命取得と帯域を奪い合っていた。feed.tsx の enqueuePrefetch パターンを複製。`Math.max(...map)` も for-of に置換(中間配列排除)。
5. **v7 で no-op だった `lazyPreloadDistance:2` を撤去**(+`as object` キャスト除去) — bottom-tabs@7.16.0 に当該 prop は存在しない [実証済: node_modules grep 0 件]。stale コメント((tabs)/_layout.tsx・search.tsx)も実装に合わせて訂正。
6. **却下で確定**: feed への `removeClippedSubviews`(FlashList 1.7.3 が prop を捨てる完全 no-op [実証済])・web 限定 detachInactiveScreens(screens 無効で読まれない)・will-change 切替(かえってヒッチを作る)。

### ★ 残ギャップ(未適用 — 別途判断)
1. **P1: v7 `navigation.preload()` で隣接タブ実プリロード** — feed 内 `<TabPreloader />` を effect + idle で(render 中に preload を呼ぶと壊れる)。preload 済画面は freeze 除外で背面 re-render が生きる相互作用があるため、計測 3 点(paint 短縮/INP 非悪化/0x0 再レイアウト無し)合格後に keep(中リスク)。
2. **P2: FlashList v2 パイロット**(§1.3) — 一括 install は全 6 画面同時 v2 化で `estimatedItemSize` がコンパイル不能 [実証済] → npm alias `flash-list-v2` 並置 + flag-gated で feed のみ。SDK 53+ upgrade と同時が第一候補(高リスク)。
3. **Web INP / 長タスク分割**(§5.1) — boot 時の同期処理・feed 3 段ウォーターフォールが web メインスレッドを塞ぐ余地。計測してから(中)。
4. **P2(好み)**: Android 遷移を `ios_from_right`(視差付き push)に / PressableScale の dead な `filter` transition 除去 / no-op `removeClippedSubviews`(bbs/tag/liked) の掃除。

---

## 10. 出典 (一次情報 URL)

### リスト/スクロール
- `[RN-flatlist]` React Native 公式 — Optimizing FlatList Configuration: <https://reactnative.dev/docs/optimizing-flatlist-configuration>
- `[FL-perf]` FlashList 公式 — Performance: <https://shopify.github.io/flash-list/docs/fundamentals/performance/>
- `[FL-known]` FlashList 公式 — Known Issues: <https://shopify.github.io/flash-list/docs/known-issues/>
- `[FL-v2]` Shopify Engineering — FlashList v2 (New Architecture rewrite): <https://shopify.engineering/flashlist-v2>

### 画面遷移/ナビゲーション
- `[Expo-stack]` Expo Router 公式 — Stack: <https://docs.expo.dev/router/advanced/stack/>
- `[RNNav-stack]` React Navigation 公式 — Stack Navigator: <https://reactnavigation.org/docs/stack-navigator/>
- `[RNS]` react-native-screens (Software Mansion): <https://github.com/software-mansion/react-native-screens>
- `[RNNav-shared]` React Navigation 公式 — Shared Element Transitions: <https://reactnavigation.org/docs/shared-element-transitions/>
- `[react-freeze]` Software Mansion — react-freeze: <https://github.com/software-mansion/react-freeze>
- `[RNNav-12755]` react-navigation issue #12755 — bottom-tab blank screen: <https://github.com/react-navigation/react-navigation/issues/12755>

### 新アーキ/スレッド/アニメ
- `[RN-thread]` React Native 公式 — Threading Model: <https://reactnative.dev/architecture/threading-model>
- `[RN-fabric]` React Native 公式 — Fabric Renderer: <https://reactnative.dev/architecture/fabric-renderer>
- React Native 公式 — Architecture landing: <https://reactnative.dev/architecture/landing-page>
- `[Reanimated-glossary]` Reanimated 公式 — Glossary (worklet/shared value/runOnUI): <https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/glossary/>
- `[Reanimated-worklets]` Reanimated 公式 — Worklets: <https://docs.swmansion.com/react-native-reanimated/docs/2.x/fundamentals/worklets/>

### Web 固有
- `[webdev-inp]` web.dev — Optimize INP: <https://web.dev/articles/optimize-inp>
- `[webdev-compositor]` web.dev — Stick to compositor-only properties / manage layer count: <https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count>
- `[webdev-layout]` web.dev — Avoid large, complex layouts and layout thrashing: <https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing>
- `[webdev-cls]` web.dev — Optimize CLS: <https://web.dev/articles/optimize-cls>

### 計測
- `[RN-profiling]` React Native 公式 — Profiling: <https://reactnative.dev/docs/profiling>

> リサーチ統計: 5 アングル / 21 ソース取得 / 100 主張抽出 / 25 を 3 票敵対検証 → **25 確証・0 却下** / 統合後 7 主張。
> caveat(研究の自己申告): Web 滑らかさ・Moti・native-driver Animated・計測ツールの一部は**敵対検証の 25 件には含まれない**(一次情報としては web.dev/RN 公式に依拠)。導入時は実測で確認。

---

## 11. 関連

- [[React Native・Expo パフォーマンス最適化]] — スレッド/フレーム予算/FlashList/memo/Hermes の原理(姉妹ノート)
- [[パフォーマンス最適化]] — Geek 実コードの hotspot 台帳(★未適用/解消済の区別)
- [[モバイル UX 品質指標]] — INP/CLS/TTI など測定可能な UX 指標
- [[フィード・ランキング・レコメンド]] — feed 取得経路(3 段ウォーターフォール)
- [[画像・メディアパイプライン]] — thumbedUrl/サムネ化/decode/blurhash
- [[Zustand・React Query ベストプラクティス]] — selector/cache seed/楽観更新
- [[地雷・落とし穴 総覧]] — green build≠安全/Metro cache/silent degrade
- [[運用 — デプロイ・プレビュー・本番反映確認]] — release 計測/反映確認
