# Apple スペーシング・角丸 — 4pt Grid と Concentric Shapes

> Apple は spacing を **4pt grid (4/8/12/16/20/24)** で揃え、角丸は **Concentric Shapes** (3 種別: Fixed / Capsule / Concentric) で nested layout を美しく入れ子にする。iOS 26 / SwiftUI には `ConcentricRectangle` として API 化された。
> 出典: HIG Layout、WWDC25/356、SwiftUI ConcentricRectangle、Apple Design Tips

---

## 1. 一文要約

> spacing は 4 の倍数、角丸は **「親の角丸 − padding = 子の角丸」** で揃える。これだけで Apple っぽさが 8 割揃う。

---

## 2. 4pt Grid

### 2.1 基本リズム

Apple の HIG では明示的な「grid system」を打ち出してはいないが、**実装値はすべて 4 の倍数**。

| Spacing | 値 | 用途 |
|---|---|---|
| 0 | 0 | 隣接 |
| xs | 4 | inline icon-text 間 |
| sm | 8 | tight cluster (button 内 padding) |
| md | 12 | 関連要素 |
| **lg** | **16** | **section padding 標準** |
| xl | 20 | section 間 |
| 2xl | 24 | 画面外周 padding (一部) |
| 3xl | 32 | 大セクション間 |
| 4xl | 48 | 画面間の大空間 |

→ **16pt = 標準**。画面外周 / card padding / section gap の最も多い値。

### 2.2 Safe Area との関係

- Top / Bottom は safe area inset を**そのまま** padding にする
- Left / Right は **16pt 最低** (iPhone 横向きでも notch まで詰めない)
- Tab bar / Home indicator 上は `useSafeAreaInsets().bottom + 12pt` (Liquid Glass pill の場合)

---

## 3. Concentric Shapes (iOS 26 正式ルール)

WWDC25/356 で 3 種別が明確化:

### 3.1 Fixed Shapes (一定角丸)

子要素のサイズに関わらず固定の角丸:
- 小 button: 8pt
- card: 12pt or 16pt
- modal sheet: 20pt (corner radius)

```tsx
<View style={{ borderRadius: 12 }}>...</View>
```

### 3.2 Capsule (高さの半分)

`borderRadius = height / 2` で「丸い両端」:
- pill button
- tag chip
- TabBar (Liquid Glass)

```tsx
<View style={{
  height: 36,
  borderRadius: 18,        // = height / 2
}}>...</View>
```

→ React Native では `borderRadius: 9999` でも実質 capsule になる (clipping)。

### 3.3 Concentric (親角丸 − padding)

**最も重要なルール:** 入れ子の子要素は

> **子角丸 = 親角丸 − padding**

で揃える。これで親子の角丸が**同心円**になる。

例: 親 card `borderRadius: 16` + `padding: 8` の中に置く子 button は `borderRadius: 8`。

```tsx
// 親
<View style={{ borderRadius: 16, padding: 8 }}>
  {/* 子 */}
  <Pressable style={{ borderRadius: 8 }}>...</Pressable>
</View>
```

### 3.4 SwiftUI API

```swift
// iOS 26+
ConcentricRectangle()    // 親に応じて自動補正

// or 明示
.containerShape(RoundedRectangle(cornerRadius: 16, style: .concentric))
```

---

## 4. React Native 実装ユーティリティ

### 4.1 concentricRadius helper

```ts
// design/shape.ts
export function concentricRadius(parentRadius: number, padding: number): number {
  return Math.max(0, parentRadius - padding);
}

// 使用
const CARD_RADIUS = 16;
const CARD_PADDING = 12;
<View style={{ borderRadius: CARD_RADIUS, padding: CARD_PADDING }}>
  <Button style={{ borderRadius: concentricRadius(CARD_RADIUS, CARD_PADDING) }} />
</View>
```

### 4.2 R token を 4 倍数化

```tsx
export const R = {
  none: 0,
  xs: 4,
  sm: 8,      // 小 button
  md: 12,     // card
  lg: 16,     // section / 大 card
  xl: 20,     // sheet
  '2xl': 24,
  '3xl': 32,
  full: 9999, // capsule
};
```

### 4.3 SP token を 4pt grid に厳格化

```tsx
export const SP = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20,
  6: 24, 7: 28, 8: 32, 10: 40, 12: 48, 16: 64,
  20: 80, 24: 96,
};
```

---

## 5. 数値ルールまとめ

| 項目 | 値 | 根拠 |
|---|---|---|
| Grid 単位 | **4pt** | 業界標準 + Apple 実装値分析 |
| 画面外周 padding | **16pt 最低** | HIG Layout |
| Standard padding | **16pt** | HIG 標準 |
| Card radius | 12pt or 16pt | iOS 26 デフォルト |
| Modal sheet radius | **20pt** | iOS 26 デフォルト |
| Sheet grabber | 36 × 5 pt | WWDC25/356 |
| 小 button radius | 8pt | HIG Buttons |
| Capsule radius | height / 2 | HIG Buttons |
| **Concentric 公式** | **子角丸 = 親角丸 − padding** | WWDC25/356 |

---

## 6. GEEK にどう活かすか

### 6.1 強み (audit より)

**Spacing トークン (`SP`) の規律は既に揃っている:**
- 4pt grid 厳格遵守 (0/4/8/12/16/20/24/28/32/40/48/64/80/96)
- 509 件の padding 系のうち 264 件 (**52%**) は `SP[]` 経由
- フィードの主要動線 (`AnonPostCard.tsx:899-901` の H16/V12) では揃っている

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §2.5)

### 6.2 P1 — R token の奇数値を 4 倍数化

**現状**:
```ts
R = {
  none: 0,
  sm: 6,    // ← 奇数寄り
  md: 10,   // ← 4 の倍数でない
  lg: 14,   // ← 4 の倍数でない
  xl: 20,
  '2xl': 28,
  '3xl': 36,
  full: 9999,
};
```

**Apple HIG 寄り**:
```ts
R = {
  none: 0,
  sm: 8,    // 小 button
  md: 12,   // card 標準
  lg: 16,   // 大 card
  xl: 20,   // sheet
  '2xl': 24,
  '3xl': 32,
  full: 9999,
};
```

**問題**:
- `Button.tsx:58 RADIUS=12` と `PolishedButton.tsx:118 R.lg=14` の split → 統一すべき
- 313 件のハードコード radius (13/17/19/22/23/30) → codemod で R token に丸める

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §4 Phase 3-5)

### 6.3 P2 — concentricRadius helper の導入

```tsx
// design/shape.ts (新規)
export function concentric(parent: number, padding: number): number {
  return Math.max(0, parent - padding);
}
```

使用例:
```tsx
const CARD_RADIUS = R.lg;     // 16
const CARD_PADDING = SP[3];   // 12

<View style={{ borderRadius: CARD_RADIUS, padding: CARD_PADDING }}>
  <Button style={{ borderRadius: concentric(CARD_RADIUS, CARD_PADDING) }} />
  {/* 子 button radius は 16 - 12 = 4 で同心円 */}
</View>
```

### 6.4 触らないことを決める (温存)

- **TabBar pill `borderRadius: 30` (= height 60 / 2)**: Capsule 規約に合致、温存
- **modal `presentation:'modal'` の iOS native 角丸**: OS 任せで OK、独自指定不要

---

## 7. lint / test 化

```ts
// tests/unit/spacingLock.test.ts
import { SP, R } from '../../design/tokens';

test('SP は全て 4pt grid', () => {
  Object.values(SP).forEach(v => expect(v % 4).toBe(0));
});

test('R は full を除き 4pt grid', () => {
  Object.entries(R).forEach(([k, v]) => {
    if (k === 'full' || k === 'none') return;
    expect(v % 4).toBe(0);
  });
});
```

```ts
// ESLint
{
  "no-restricted-syntax": [
    "warn",
    {
      "selector": "Property[key.name='borderRadius'] > Literal:not([value=0])",
      "message": "borderRadius はリテラル禁止、R.* token を使ってください (concentric なら concentric() helper)。"
    }
  ]
}
```

---

## 8. 出典

- **HIG Layout** — https://developer.apple.com/design/human-interface-guidelines/layout
- **WWDC25/356** "Build a SwiftUI app with the new design" — https://developer.apple.com/videos/play/wwdc2025/356/
- **SwiftUI ConcentricRectangle** — https://developer.apple.com/documentation/swiftui/concentricrectangle
- **Apple Design Tips** — https://developer.apple.com/design/tips/

---

## 関連ノート

- [[Apple Liquid Glass 設計言語]] — Sheet radius と grabber は spacing と一体
- [[Apple Typography — SF Pro と Dynamic Type]] — text padding は @ScaledMetric で連動
- [[GEEK × Apple HIG 監査レポート 2026-06]] — spacing-radius 監査結果
