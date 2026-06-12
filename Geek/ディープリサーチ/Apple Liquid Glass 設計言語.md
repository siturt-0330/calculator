# Apple Liquid Glass 設計言語

> iOS 26 で導入された Apple 最大規模のデザインシステム更新。**Lensing** (光を散乱でなく屈折・集束させる) を核とする meta-material。navigation 層に限定し、glass-on-glass を避け、3 つのアクセシビリティ設定を自動 honor する。
> 出典: WWDC25/219、WWDC25/356、Apple Newsroom 2025-06、NN/g「Liquid Glass」レビュー

---

## 1. 一文要約

> Liquid Glass は **「コンテンツの上に浮かぶ navigation 層」** を物理的に表現する設計言語で、Apple は「最も大規模なソフトウェアデザインアップデート」と位置付けた。

iOS 26 / iPadOS 26 / macOS 26 / watchOS 26 / tvOS 26 / visionOS 26 を横断する共通言語として 2025 年 6 月発表。WWDC25/219 と WWDC25/356 が公式の一次資料。

---

## 2. 核心概念 — Lensing

旧来の frosted glass / blur は「光を**散乱** (scatter) させる」表現。Liquid Glass は「光を**屈折・集束** (bend / shape / concentrate) させる」表現。

| 項目 | 旧 Material (iOS 7–25) | Liquid Glass (iOS 26+) |
|---|---|---|
| 光の扱い | 散乱 (scatter) | 屈折・集束 (lensing) |
| 質感 | フロスト (霜) | レンズ (光学ガラス) |
| 動き | 静的 | 動的 (Material が周辺光に応答) |
| 階層 | 背景の一部 | コンテンツの上に**浮かぶ** |

→ 「**Material が光を歪めて見せる**」がエッセンス。これを RN で完全再現するのは現状不可能だが、**意図を理解した近似** は BlurView + tint dynamic で可能。

---

## 3. 4 つの運用ルール (Apple 公式)

### 3.1 Navigation 層に限定

> Liquid Glass should be reserved for the **navigation layer** that floats above content.

Tab bar / navigation bar / toolbar / sidebar / sheet ヘッダなど「ユーザーが操作する**チラチラ動かない**枠」だけに使う。コンテンツ本体 (card / cell / image) は Liquid Glass にしない。

**なぜ**: Material は「層」として機能する。content も Material にすると「層」が消える。

### 3.2 Glass-on-glass を禁止

> Don't stack Liquid Glass on top of Liquid Glass.

Glass の上に Glass を重ねると Lensing が二重になり破綻する。重ねる時は:
- **fills** (不透明色)
- **transparency** (alpha) 
- **vibrancy** (色相シフト)
のいずれかを使う。

### 3.3 小要素は light↔dark を flip、大要素は flip しない

- 小要素 (navbar / tabbar) は背景の明度に応じて自動で light/dark を切替
- 大要素 (menu / sidebar) は flip しない (面積が大きく遷移が散漫になる)

### 3.4 Focus shift で recede

Sheet を上にドラッグするなど focus が深まる操作で、navigation 層の Material は **subtly recede** (引っ込む) しつつ opacity が増える。「ユーザーが今どこに集中しているか」を Material 自身が表現する。

modal task では dimming layer と組み合わせる (= 背景全体を暗くしつつ Material は subtly recede)。

---

## 4. 自動アクセシビリティ honor

Apple は Liquid Glass について明言:
> Available **automatically** whenever you use the new material.

3 つの OS 設定を Material 側が自動で読み取る:

| OS 設定 | Liquid Glass の挙動 |
|---|---|
| **Reduce Transparency** | frostier (より霜化) にして背景を遮蔽 |
| **Increase Contrast** | 純黒/純白に近づき、contrasting border を追加 |
| **Reduce Motion** | 弾性プロパティを無効化、効果強度を下げる |

→ ネイティブ実装は何もしなくていい。React Native では **手動で購読する必要あり** (§7 参照)。

---

## 5. 構成要素別の運用

### 5.1 Tab Bar

- 浮かせる (floating)、画面下端に貼り付かない
- 角丸 capsule
- 背景を blur で受ける
- scroll-driven shrink (小要素では Apple 自身の Mail/Music で実装)

### 5.2 Navigation Bar

- 上端で transparent → スクロールで Material が現れる (scroll edge appearance)
- Large Title → Inline title への遷移は scroll に追従

### 5.3 Sheet

- grabber 36×5 を上端に
- swipe down で滑落
- 背景は dimming layer (modal task)
- detent (medium / large) で停止可能

### 5.4 Toolbar / Menu

- Toolbar は Material (Liquid Glass)
- Menu は Material だが flip しない (大要素扱い)

---

## 6. 数値とパラメータ

| 項目 | 値 | 根拠 |
|---|---|---|
| Tab bar pill 角丸 | capsule (= height / 2) | WWDC25/219 |
| Sheet grabber | 36 × 5 pt | WWDC25/356 |
| Sheet corner radius | 20 pt (detent によらず固定) | iOS 26 デフォルト |
| Material 透過率 | ultraThin / thin / regular / thick の 4 段 | UIKit Material API |
| Reduce Transparency 時 | 不透明 (opacity 1.0) に倒す | OS 自動 |
| Reduce Motion 時 | 弾性アニメ無効、強度 -50% | OS 自動 |

---

## 7. React Native での再現

### 7.1 BlurView + dynamic tint

```tsx
import { BlurView } from 'expo-blur';
import { useColorScheme } from 'react-native';

const isDark = useColorScheme() === 'dark';

<BlurView
  intensity={36}                      // Liquid Glass 近似値
  tint={isDark ? 'dark' : 'light'}    // §3.3 small element flip
  style={{
    borderRadius: 30,                  // capsule
    overflow: 'hidden',
  }}
>
  {/* content */}
</BlurView>
```

iOS は `UIVisualEffectView` を内部で使用。Android / Web は emulation で品質劣化。

### 7.2 Web の backdrop-filter (RNW で StyleSheet 経由は不可)

```tsx
import { StyleSheet, View } from 'react-native';

const webGlassStyle = Platform.OS === 'web' ? ({
  backdropFilter: 'blur(30px) saturate(180%)',
  WebkitBackdropFilter: 'blur(30px) saturate(180%)',
} as any) : {};

<View style={[styles.bar, webGlassStyle]} />
```

`saturate(180%)` で Vibrancy 近似。

⚠️ **web では transform 中の backdrop-filter が毎フレーム resample** → 動く要素には絶対つけない (GEEK TabBar v5.1 で発覚した教訓: [[リキッドタブインジケーター完全ガイド]])。

### 7.3 OS 設定の購読 (3 つ全て)

```tsx
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion as useRNReducedMotion } from 'react-native-reanimated';
import { useEffect, useState } from 'react';

export function useAppleLiquidGlassA11y() {
  const reduceMotion = useRNReducedMotion();
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [increaseContrast, setIncreaseContrast] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled?.().then(setReduceTransparency);
    AccessibilityInfo.isHighTextContrastEnabled?.().then(setIncreaseContrast);
    const sub1 = AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', setReduceTransparency);
    const sub2 = AccessibilityInfo.addEventListener?.('highTextContrastChanged', setIncreaseContrast);
    return () => { sub1?.remove?.(); sub2?.remove?.(); };
  }, []);

  return { reduceMotion, reduceTransparency, increaseContrast };
}
```

### 7.4 Reduce Transparency 対応

```tsx
const { reduceTransparency } = useAppleLiquidGlassA11y();

<BlurView
  intensity={reduceTransparency ? 0 : 36}
  style={{
    backgroundColor: reduceTransparency
      ? (isDark ? '#0A0A0A' : '#FFFFFF')   // 不透明 fallback
      : 'transparent',
  }}
/>
```

### 7.5 Increased Contrast 対応

```tsx
const { increaseContrast } = useAppleLiquidGlassA11y();

<View style={{
  borderWidth: increaseContrast ? 2 : 1,
  borderColor: increaseContrast
    ? (isDark ? '#FFFFFF' : '#000000')    // 高コントラスト境界
    : C.border,
}} />
```

---

## 8. GEEK にどう活かすか

### 8.1 既に Apple 水準

- **TabBar v5.1 (Liquid Glass pill)**: `PILL_HEIGHT=60` + `PILL_RADIUS=30` (capsule) + `BlurView intensity=36` + dynamic tint + sheen + rim light + 4 主要動線が常時可視 → iOS 26 想定を**先取り**
- **TopBar**: iOS `systemUltraThinMaterialDark/Light` intensity 80、Web は `backdrop-filter: blur(30px) saturate(180%)` で最適パス
- **scroll edge appearance**: opacity 0→1 / hairline 30→60 で「上端透明 → スクロールで opaque」を再現

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §2.1, §2.4)

### 8.2 P0 — 直すべき

| # | 違反 | 修正 |
|---|---|---|
| **P0-5** | OS Reduce Motion 未購読 (`hooks/useReducedMotion.ts` が設定ストアのみ) | `import { useReducedMotion } from 'react-native-reanimated'` を OR 結合 |

`OS 設定` で `Reduce Motion` を ON にしたユーザーが GEEK で弾性アニメに巻き込まれる現状 = Apple の「自動 honor」原則違反。1 ファイル 1 行で解決。

### 8.3 P1 — 中期で詰める

- **Reduce Transparency 購読**: `useAppleLiquidGlassA11y` hook (上 §7.3) を新設、TabBar / TopBar / Sheet が opaque fallback
- **Increased Contrast 購読**: 同 hook で border 強化
- **Material 4 段スケール**: `design/materials.ts` に `ultraThin/thin/regular/thick` を定義し、現状散在する intensity 4 値 (20/30/36/40/80) を意味で揃える
- **ActionSheet / ConfirmDialog を `regularMaterial` 化**: 現在の `C.bg2` フラットから脱却

### 8.4 P2 — 機を見て

- **Lensing 完全再現**: Skia の RuntimeShader で GLSL カスタム書く / もしくは Native Module 経由で `UIVisualEffectView` を直接呼ぶ
- **Focus shift**: Sheet 展開時に TabBar が subtly recede + opacity 増の連動

### 8.5 触らないことを決める (温存)

- **TabBar 隣の投稿 FAB**: HIG 想定外だが「投稿」の独立動線価値が大きい → 温存
- **TabBar ball morph**: HIG 標準は常時 pill だが reduceMotion 対応済 + ball tap が scroll-to-top + 展開を同時発火するため semantics は HIG と揃う → 温存

---

## 9. 「Liquid Glass を使ってはいけない」場面

- **Content area** (フィード本体、card、image) → Material 化すると階層が消える
- **背景にすでに Material がある場所** → glass-on-glass 禁止
- **dialog 内の button group** → Material は層として機能する、button は層ではなく要素
- **長文 reading view** → 透過は読みにくさを生む

---

## 10. App Review との関係

Liquid Glass 自体は審査基準ではないが、**Reduce Transparency / Reduce Motion / Increase Contrast** 未対応は accessibility 違反として指摘される可能性。Apple は WWDC25/219 で「自動 honor は Material API 経由で**自動**」と明言しているため、ネイティブは無罪、React Native は手動実装義務。

→ [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] §3 と整合。

---

## 11. 出典

- **WWDC25/219** "Meet Liquid Glass" — https://developer.apple.com/videos/play/wwdc2025/219/
- **WWDC25/356** "Build a SwiftUI app with the new design" — https://developer.apple.com/videos/play/wwdc2025/356/
- **Apple Newsroom** "Apple introduces a delightful and elegant new software design" — https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- **NN/g** "Liquid Glass" — https://www.nngroup.com/articles/liquid-glass/
- **HIG Materials** — https://developer.apple.com/design/human-interface-guidelines/materials

---

## 関連ノート

- [[リキッドタブインジケーター完全ガイド]] — TabBar v5.1 の実装記録
- [[Apple モーション — Spring・曲線・Reanimated 実装]] — Material の動きは spring で
- [[Apple カラーシステム — System Colors と Vibrancy]] — Vibrancy は Material と一対
- [[GEEK × Apple HIG 監査レポート 2026-06]] — Liquid Glass 監査結果

---

## 改訂 / TODO

- iOS 26.x で Liquid Glass の仕様変更が来たら本ノート更新
- Skia RuntimeShader で Lensing 物理近似する POC は別途
- iOS 27 が出たら glass-on-glass 禁止が緩むか追跡
