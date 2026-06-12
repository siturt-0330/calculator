# MOC — Apple HIG 完全ガイド

> Apple Human Interface Guidelines × WWDC25/26 × GEEK v4 実装適用の MOC (Map of Content)
> 監査日: 2026-06-12 / 出典: Apple 公式 HIG・WWDC17/25/26 セッション・Apple Developer 公式ドキュメント

---

## このノート群の使い方

GEEK v4 (React Native 0.76 + Expo SDK 52) の UI/UX を **Apple HIG 水準** まで引き上げるための体系学習ノート。各章は「**原則 → 数値 → React Native 実装 → GEEK 適用**」の 4 段構成。実装で迷ったらまずこの MOC から該当章へ。

---

## 第 I 部 — 設計哲学

Apple のデザイン原則は **二層構造** で理解する。WWDC17 の古典三原則が土台、WWDC26 の八原則が現代版の再整理。

- [[Apple HIG 総論 — 二層原則 (WWDC17・WWDC26)]] — Wayfinding / Feedback / Consistency と Purpose / Agency / Responsibility / Familiarity / Flexibility / Simplicity / Craft / Delight
- [[Apple Liquid Glass 設計言語]] — iOS 26 の meta-material、Lensing、navigation 層限定運用、accessibility 自動 honor

## 第 II 部 — 視覚言語の数値

ピクセル単位で「正解」が決まっている領域。守れば自然に Apple 体感に近づく。

- [[Apple Typography — SF Pro と Dynamic Type]] — SF Text/Display 連続光学補間、11 種 Text Styles、Tight/Loose Leading、@ScaledMetric
- [[Apple カラーシステム — System Colors と Vibrancy]] — semantic label colors、Dark Mode 自動切替、Vibrancy 階層
- [[Apple スペーシング・角丸 — 4pt Grid と Concentric Shapes]] — Concentric (親角丸 − padding)、Capsule、Fixed の三種別

## 第 III 部 — 動きと触感

「気持ちいい」の核心。Apple は spring を物理ではなく**知覚パラメータ** (response / dampingRatio) で語る時代に移行した。

- [[Apple モーション — Spring・曲線・Reanimated 実装]] — withSpring/withTiming/withDecay、SwiftUI .smooth/.snappy/.bouncy 対応表
- [[Apple ハプティクス — Impact・Notification・Selection 使い分け]] — UIImpactFeedbackGenerator 系統と semantic mapping

## 第 IV 部 — アクセシビリティと審査

App Review で落ちる線。守らないと公開できない。

- [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] — 44pt × 44pt、VoiceOver only で全 task 完了、Dynamic Type、Reduced Motion

## 第 V 部 — ナビゲーションとコンテンツ

「どこに何を置くか」の作法。

- [[Apple ナビゲーション — TabBar・NavBar・Sheet・Modal]] — Wayfinding 実装、modal sheet detent、scroll edge appearance
- [[Apple SF Symbols とアイコン設計]] — 6 weight × 3 scale、filled variant、サードパーティ icon との混在ルール
- [[Apple オンボーディング・空状態・エラー・権限ダイアログ]] — 一画面一目的、装飾控えめ、平易な日本語

## 第 VI 部 — 細部の美学

ユーザーが「気持ちいい」と感じる微差。明文化されていないが Apple がやっていること。

- [[Apple 「気持ちいい」微差 — 細部の interaction]] — button press の影、scroll 慣性、keyboard avoidance、最小所作のチューニング

## 第 VII 部 — GEEK 実装適用

監査結果と改善ロードマップ。Phase 1 / 2 / 3 で 9.5 合目まで届く設計。

- [[GEEK × Apple HIG 監査レポート 2026-06]] — 14 領域 audit + P0 敵対検証 + 段階的ロードマップ

---

## 関連ノート (既存 Vault)

- [[リキッドタブインジケーター完全ガイド]] — Liquid Glass TabBar 実装の原典 (本 MOC 第 I・V 部から参照)
- [[UI の滑らかさ — スクロール追従と画面遷移]] — モーション実装の理論編
- [[モバイル UX 品質指標]] — App Review 合否の数値基準と隣接
- [[React Native・Expo パフォーマンス最適化]] — 60fps を維持する技術基盤

---

## 学習ロードマップ (推奨順)

**Day 1 (理念)** — 総論 → Liquid Glass を読み、Apple が「何を大事にしているか」を掴む
**Day 2 (数値)** — Typography → Color → Spacing で「Apple が動かさない数値」を覚える
**Day 3 (動き)** — Motion → Haptics で「気持ちいいの正体」を理解する
**Day 4 (審査)** — タッチターゲット・アクセシビリティ で「落ちない設計」を学ぶ
**Day 5 (配置)** — ナビゲーション → SF Symbols → オンボーディング で「どこに何を置くか」を体系化
**Day 6 (細部)** — 「気持ちいい」微差 で目利きを上げる
**Day 7 (実装)** — GEEK 監査レポート で「自分のアプリで何を直すか」を確定させる

---

## 1 ファイル学習で最低限抑える 7 つ

1. **Wayfinding / Feedback / Consistency** — 全画面のレビュー時に毎回 3 視点で問う
2. **Liquid Glass は navigation 層限定 / glass-on-glass 禁止** — iOS 26 の唯一の禁則
3. **44pt × 44pt / 11pt 最小** — Apple 公式の絶対線
4. **VoiceOver only で全 common task 完了** — App Review 合否の鋭利な線
5. **Concentric Shapes (子角丸 = 親角丸 − padding)** — nested layout の美の方程式
6. **Selection / Impact / Notification の semantic 使い分け** — 触感の語彙
7. **Reduced Motion / Transparency / Increased Contrast を 3 セット連携** — Apple 標準は OS 設定購読で自動

---

## 改訂履歴

- **2026-06-12** — 初版。deep-research (112 agents / 29 sources / 24 verified claims) + GEEK 監査 (30 agents / 14 領域 / P0 5 件) を統合
