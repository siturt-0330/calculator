# Apple HIG 総論 — 二層原則 (WWDC17・WWDC26)

> Apple のデザイン哲学は WWDC17 の **Essential Design Principles** と WWDC26 の **Principles of Great Design** の二層で理解する。前者が古典的土台、後者が現代版の再整理。
> 出典: WWDC17/802、WWDC26/250、Apple HIG「Design principles」

---

## 1. 第一層 — WWDC17 三原則 (古典的土台)

Apple が 2017 年に公式化した「すべての UI 判断の根本」。今でも HIG の全章の暗黙の前提として効いている。

### 1.1 Wayfinding (道案内)

> **「どこにいる / どこへ行ける / 何があるか / どう出るか」** — UI の根本機能

UI の主要構成要素 (navigation bar / content area / tab bar) はすべて wayfinding システムとして設計する。「現在地」と「行き先」と「戻り方」が常時可視であること。

**チェックリスト**
- [ ] 画面タイトルで今の場所が分かるか
- [ ] tab bar で同階層の選択肢が分かるか
- [ ] back button で前画面の名前が分かるか
- [ ] modal の dismiss 手段が明示されているか

### 1.2 Feedback (応答)

> **clear / timely / understandable / informative** — ユーザーとの「会話」

ユーザー操作に対する応答は **4 つの問い** に答える:
1. 何ができるか (affordance)
2. 何が起きたか (acknowledgment)
3. 今何が起きているか (progress)
4. 次に何が起きるか (anticipation)

**実装パターン**
- tap → scale 0.96 + haptic light (3-1)
- long task → progress indicator (3-3)
- success → notification haptic + toast (3-2)
- destructive → confirm dialog (3-4)

### 1.3 Consistency (一貫性)

> **外的一貫性 (platform conventions)** + **内的一貫性 (controls/glyphs の視覚統一)**

両軸とも崩すと usability を直接破壊する。

- **外的**: iOS の慣習 (left back / right action / bottom tab) を守る
- **内的**: 同じ操作には同じ視覚言語 (アプリ全体で「いいね」は♥、色は accent)

---

## 2. 第二層 — WWDC26 八原則 (現代版再整理)

WWDC26「Principles of Great Design」(2026 年 6 月公開) で発表された、Apple の現代的な 8 原則。WWDC17 三原則を **包含・拡張** する形で再構成されている。

### 2.1 Purpose (目的)
- 機能を盛り込むのではなく、**何のアプリかを 1 文で言える**
- すべての画面・要素は「アプリの目的」に貢献するか問う
- GEEK 適用: 「匿名で趣味を語る場」が purpose。投稿/コミュニティ/通知は全てこれに従属

### 2.2 Agency (主体性)
- ユーザーが UI を **制御している感** を持てる
- 自動進行・強制遷移を避け、選択肢と取り消し手段を提示
- GEEK 適用: いいね/コメント/ブロックは optimistic update + undo toast

### 2.3 Responsibility (責任)
- ユーザーのデータ・時間・注意を**奪わない**設計
- 通知濫用・dark pattern・無断の動作はすべて違反
- GEEK 適用: 通知集約 (1 つの post への複数 like を 1 通知に統合)、permission 必須

### 2.4 Familiarity (親しみ)
- 既知のパターンに従い**新しさを最小化**
- 「学習コスト」をかけてまで革新するのは Purpose に資する時だけ
- GEEK 適用: TabBar = iOS 標準位置、Modal = swipe down dismiss、List = pull to refresh

### 2.5 Flexibility (柔軟性)
- 1 つの operation に複数の到達手段
- 速い操作 (gesture) と確実な操作 (button) の両方を提供
- GEEK 適用: 通知開封 = tap or swipe / 投稿削除 = long-press menu or 詳細画面の「…」

### 2.6 Simplicity (単純性)
- 必要なものだけを今表示する (progressive disclosure)
- 装飾より content を主役に (Liquid Glass の Deference 原則と一致)
- GEEK 適用: フィードカードは画像 + 本文 + 反応のみ。メタデータは長押し詳細へ

### 2.7 Craft (職人技)
**WWDC26 で最も強調された原則。** Apple 自身が「great design must keep evolving」と明言。

Craft の構成要素 (WWDC26/250 逐語):
- **Typography across devices** (デバイス越境のタイポ)
- **Light/dark 適応カラー** (semantic colors)
- **Clear iconography** (SF Symbols の weight 一貫性)
- **Responsive animations that feel fluid** (perceptual spring)

→ Typography / Color / Icons / Motion の 4 章は全てこの Craft を実装に落とすためのもの。

### 2.8 Delight (歓び)
- 期待を**少しだけ**超える微差
- 過剰な演出ではなく、自然な手触りの極まり
- GEEK 適用: スクロールの慣性、いいね double-tap の heart pop、tab pill morph

---

## 3. 二層の関係と運用

### 3.1 包含関係

| WWDC17 三原則 | 対応する WWDC26 原則 |
|---|---|
| Wayfinding | Familiarity + Simplicity + Agency |
| Feedback | Craft (responsive animations) + Delight + Responsibility |
| Consistency | Familiarity + Craft (typography/colors/iconography) |

→ WWDC17 の 3 原則は「**機能** としての設計原則」、WWDC26 の 8 原則は「**態度** としての設計原則」と理解できる。

### 3.2 「great design must keep evolving」の含意

Apple は HIG を**最終形ではなく現在地**と位置付けている。iOS 17 → 18 → 26 で原則は一貫しているが、表現 (Liquid Glass / SF font 可変化 / Concentric Shapes) は更新され続ける。

→ 「HIG を**写経する**」のではなく「**Apple が次に何を選ぶか**を予測できる目」を養うのが本質。

---

## 4. React Native での再現

WWDC17/26 原則は実装言語に依存しないが、Reanimated / Expo SDK 52 で各原則を支える「使うべき API」がある:

| 原則 | 主に使う API |
|---|---|
| Wayfinding | `expo-router` Stack / Tabs、`presentation:'modal'`、`headerShown` |
| Feedback (anim) | Reanimated `withTiming(300, Easing.inOut(Easing.quad))`、`withSpring` |
| Feedback (haptic) | `expo-haptics` `Haptics.impactAsync(.light/.medium/.heavy)` |
| Consistency | Design tokens (`C.*` / `T.*` / `SP.*`) + lint で逸脱検知 |
| Craft (typography) | `react-native-google-fonts`、`PixelRatio.getFontScale()` で Dynamic Type 近似 |
| Craft (color) | `Appearance.getColorScheme()` + theme store + dynamic palette |
| Craft (motion) | Reanimated v3 `useAnimatedStyle` + `worklet` で 60fps |
| Delight | 小さな spring と haptic のレイヤリング |

---

## 5. GEEK にどう活かすか

### 5.1 強み — 既に三原則を満たしている領域

- **Wayfinding**: TabBar (Liquid Glass v3) で 4 主要動線が常時可視、`presentation:'modal'` + `gestureDirection:'vertical'` で modal 滑落 dismiss
- **Feedback**: PressableScale (0.96) + haptic + accessibility role が一貫
- **Consistency**: semantic token `C.*` / `T.*` / `SP.*` がほぼ全画面で揃っている (spacing は 52% が SP 経由)

(→ 詳細は [[GEEK × Apple HIG 監査レポート 2026-06]] §2 強み)

### 5.2 P0 gap — 三原則を破っている致命箇所

1. **Feedback 違反**: ErrorBoundary が `error.message` を本番でも生表示 (英文 stack や "Network request failed" がユーザーに到達) → understandable でない
2. **Consistency 違反**: Sheet 10 箇所で grabber を見せているのに引っ張れない (gesture 不在) → Familiarity と Feedback の両方を破る
3. **Agency + Responsibility 違反**: OS の Reduce Motion 設定を購読していない → ユーザーの選択を尊重していない

(→ 詳細は [[GEEK × Apple HIG 監査レポート 2026-06]] §3 P0)

### 5.3 Craft 強化の方向性

WWDC26 が強調した Craft の 4 要素 (typography / colors / iconography / animations) を 1〜2 ヶ月で順次強化:

- Typography → Dynamic Type 部分対応 (`AppText` wrapper、`maxFontSizeMultiplier={1.6}`)
- Colors → dark theme text4 を WCAG AA 合格値に格上げ (#52525b → #7B7E8A)
- Iconography → SF Symbols 統合 (`UIIcon` Facade、`Platform.OS === 'ios'` で出し分け)
- Animations → inline spring 11 箇所を `design/motion.ts` の token 参照に統一

---

## 6. レビューチェックリスト (WWDC17 三原則)

新画面・新機能の PR レビュー時に毎回問う:

**Wayfinding**
- [ ] 画面タイトルで現在地が分かる
- [ ] tab/header で同階層の選択肢が分かる
- [ ] 戻る/閉じるが明示されている
- [ ] modal の dismiss 手段が複数ある (button + gesture)

**Feedback**
- [ ] 全 tap に視覚 + haptic フィードバック
- [ ] 1 秒超の処理に progress 表示
- [ ] 成功/失敗の semantic haptic + toast
- [ ] エラーは原因と次のアクションを平易日本語で

**Consistency**
- [ ] iOS 標準の位置/動作を踏襲
- [ ] アプリ内の同操作は同じ視覚言語
- [ ] semantic token (`C.*` / `T.*` / `SP.*`) を使用、ハードコード値なし
- [ ] 画像/動画/テキスト/インタラクションの間隔がリズム的 (4pt grid)

---

## 7. 出典

- **WWDC17/802** "Essential Design Principles" — https://developer.apple.com/videos/play/wwdc2017/802/
- **WWDC26/250** "Principles of Great Design" — https://developer.apple.com/videos/play/wwdc2026/250/
- **HIG Design Principles** — https://developer.apple.com/design/human-interface-guidelines/design-principles

---

## 関連ノート

- [[Apple Liquid Glass 設計言語]] — Craft 原則の現代的表現
- [[Apple 「気持ちいい」微差 — 細部の interaction]] — Delight の実装
- [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] — Responsibility の実装
- [[GEEK × Apple HIG 監査レポート 2026-06]] — 三原則の GEEK 実装現状
