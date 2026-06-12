# Apple カラーシステム — System Colors と Vibrancy

> Apple のカラーは **semantic name** (`label` / `secondaryLabel` / `tertiaryLabel` / `quaternaryLabel`) と **alpha-based 階層** で組み立てる。Dark Mode は **同じ semantic name が自動で別の RGB を返す**。Vibrancy は Material の上で「下層の色を吸って **背景に応じた色味を返す**」第二の semantic 層。
> 出典: HIG Color、HIG Materials、UIColor (UIKit)、Color (SwiftUI)

---

## 1. 一文要約

> Apple のカラーシステムは「**raw 色を直接書かない**、すべて semantic name で書く、Dark Mode は自動で切り替わる、Vibrancy は Material と一対で語る」が原則。

---

## 2. Semantic Label Colors (4 段階)

iOS は本文/見出し色を **4 段の semantic name** で抽象化:

| Semantic name | Light | Dark | alpha |
|---|---|---|---|
| **label** | #000000 | #FFFFFF | 1.00 (Primary) |
| **secondaryLabel** | #3C3C43 60% | #EBEBF5 60% | 0.60 (Secondary) |
| **tertiaryLabel** | #3C3C43 30% | #EBEBF5 30% | 0.30 (Tertiary) |
| **quaternaryLabel** | #3C3C43 18% | #EBEBF5 16% | 0.18 / 0.16 (Quaternary) |

→ **色相は一つ、明度を alpha で 4 段** という設計。Light で `#3C3C43` 60% は実効 `#9B9BA0` 相当、Dark で `#EBEBF5` 60% は実効 `#8E8E93` 相当。

### 2.1 Fill Colors

背景/塗り用にも 4 段:
- **systemFill** (primary)
- **secondarySystemFill**
- **tertiarySystemFill**
- **quaternarySystemFill**

### 2.2 Background Colors

階層化された background:
- **systemBackground**: 最下層 (画面の地)
- **secondarySystemBackground**: その上 (card / group)
- **tertiarySystemBackground**: さらにその上 (nested card)

→ **Grouped 系 (`systemGroupedBackground` 等)** も別途あり。設定画面で使う。

---

## 3. System Colors (11 色)

Apple は 11 種のアクセント色を semantic に提供:

| Color | Light | Dark |
|---|---|---|
| systemRed | #FF3B30 | #FF453A |
| systemOrange | #FF9500 | #FF9F0A |
| systemYellow | #FFCC00 | #FFD60A |
| systemGreen | #34C759 | #30D158 |
| systemMint | #00C7BE | #63E6E2 |
| systemTeal | #30B0C7 | #40C8E0 |
| systemCyan | #32ADE6 | #64D2FF |
| systemBlue | #007AFF | #0A84FF |
| systemIndigo | #5856D6 | #5E5CE6 |
| systemPurple | #AF52DE | #BF5AF2 |
| systemPink | #FF2D55 | #FF375F |

→ Dark で**わずかに彩度を上げる**のがポイント (低照度環境で同じ視認性を得る)。

---

## 4. Vibrancy — Material の第二層

Material (Liquid Glass / 旧 frosted) の上で、テキスト/アイコンが「下層の色を吸う」semantic 色。

### 4.1 4 段の Vibrancy Label

- **labelVibrant** (Primary)
- **secondaryLabelVibrant**
- **tertiaryLabelVibrant**
- **quaternaryLabelVibrant**

### 4.2 Vibrancy の意味

通常の `label` (#000000) を Material の上に置くと「黒文字」になる。
Vibrancy の `labelVibrant` を置くと「**背景色に応じて文字色がシフト**」する。背景が暖色なら文字に冷色がうっすら混じり、視認性を保ったまま **馴染む**。

→ **Material と一対** で使う。Material 外で Vibrancy を使ってはいけない。

### 4.3 React Native では再現不能 (近似のみ)

React Native では `UIVisualEffectView` の vibrancy 効果に相当する API がない。`expo-blur` の `BlurView` でも vibrancy children は API 化されていない。

**近似策**:
- BlurView の上に `Text` を `color: '#FFFFFF'` で置く → 「白文字 on blur」止まりで vibrancy ではない
- 半透明白 (`rgba(255,255,255,0.85)`) を使うと多少自然
- カスタムシェーダ (Skia RuntimeShader) で物理近似は可能だが工数大

---

## 5. Dark Mode の設計

### 5.1 Apple の Dark Mode 三段階

iOS の Dark Mode は **一律黒** ではない。三段の background が階層を作る:

| Dark level | Light との関係 |
|---|---|
| `systemBackground` (#000000) | Light の最下層を反転 |
| `secondarySystemBackground` (#1C1C1E) | nested card |
| `tertiarySystemBackground` (#2C2C2E) | 更に nested |

→ **真っ黒 (`#000000`) は最下層だけ**。card は `#1C1C1E`、nested は `#2C2C2E`。階層が見える。

### 5.2 Increase Contrast 自動対応

System color はすべて Increase Contrast を ON にすると **より純黒/純白に近づく**。Material も同様に backdrop が遮蔽される。

→ React Native では `AccessibilityInfo.isHighTextContrastEnabled` を購読して手動で切替。

---

## 6. WCAG コントラスト比

| 基準 | コントラスト比 |
|---|---|
| **AA 本文** | **4.5:1** |
| **AA 大文字 (18pt+ or 14pt Bold+)** | 3.0:1 |
| **AAA 本文** | 7.0:1 |
| **AAA 大文字** | 4.5:1 |

→ Apple HIG は **AAA 7:1 推奨** を明記。多くのアプリは AA 4.5:1 で妥協。

---

## 7. React Native での再現

### 7.1 Theme-aware semantic palette

```tsx
// lib/theme/palettes.ts
export const darkPalette = {
  label: '#FFFFFF',
  secondaryLabel: '#EBEBF599',     // 60%
  tertiaryLabel: '#EBEBF54D',      // 30%
  quaternaryLabel: '#EBEBF529',    // 16%
  systemBackground: '#000000',
  secondarySystemBackground: '#1C1C1E',
  tertiarySystemBackground: '#2C2C2E',
  systemBlue: '#0A84FF',
  systemRed: '#FF453A',
  // ...
};

export const lightPalette = {
  label: '#000000',
  secondaryLabel: '#3C3C4399',     // 60%
  tertiaryLabel: '#3C3C434D',      // 30%
  quaternaryLabel: '#3C3C432E',    // 18%
  systemBackground: '#FFFFFF',
  secondarySystemBackground: '#F2F2F7',
  tertiarySystemBackground: '#FFFFFF',
  systemBlue: '#007AFF',
  systemRed: '#FF3B30',
  // ...
};
```

### 7.2 PlatformColor / DynamicColorIOS

React Native は iOS の dynamic color に直接アクセスできる:

```tsx
import { PlatformColor, DynamicColorIOS } from 'react-native';

const styles = {
  textPrimary: { color: PlatformColor('label') },   // iOS のみ
  textCustom: {
    color: DynamicColorIOS({
      light: '#3C3C4399',
      dark: '#EBEBF599',
    }),
  },
};
```

→ **iOS では PlatformColor を使うのがベスト**。Apple の Dark Mode 切替に完全追従。

### 7.3 Cross-platform fallback

```tsx
import { Platform, PlatformColor, useColorScheme } from 'react-native';
import { lightPalette, darkPalette } from './palettes';

export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? darkPalette : lightPalette;

  if (Platform.OS === 'ios') {
    return {
      label: PlatformColor('label'),
      secondaryLabel: PlatformColor('secondaryLabel'),
      // ...
      // 独自色はパレット
      accent: palette.accent,
    };
  }
  return palette;
}
```

---

## 8. GEEK にどう活かすか

### 8.1 現状 (audit より)

`design/tokens.ts` `C` に独自 semantic palette:
- `bg`, `bg2`, `bg3`, `bg4`, `bg5` (5 段)
- `text`, `text2`, `text3`, `text4` (4 段)
- `accent #7C6AF7`, `accentDeep #5E4FE0`, `accentLight #9F96F9`
- `green #22D3A4`, `amber #F5A623`, `red #E24B4A`, `pink #F472B6`, `blue #3B82F6`

✅ semantic 設計の規律は揃っている (Apple の `label/secondaryLabel/tertiaryLabel/quaternaryLabel` と概念一致)

### 8.2 P0 — Dark theme text4 が WCAG 大幅違反

**`lib/theme/palettes.ts:101` の `text4:'#52525b'` on `bg:'#0a0a0a'` でコントラスト ≈ 2.64:1**

| 比較 | コントラスト | WCAG |
|---|---|---|
| GEEK dark text4 (#52525b on #0a0a0a) | **2.64:1** | **AA 不適合** (4.5 / 3.0 大文字すら未満) |
| GEEK dark text3 (#71717a on #0a0a0a) | 4.13:1 | AA 不適合 (4.5 未満) |
| Apple secondaryLabel dark 相当 | 5-7:1 | AA 適合 |

**33 ファイル / 82 件で `text3/text4` を caption 用途で使用** → 全部が WCAG 違反。

**修正**:
```ts
// lib/theme/palettes.ts
text3: '#71717a' → '#9CA3AF',  // 4.93:1 (AA pass)
text4: '#52525b' → '#7B7E8A',  // 3.42:1 (large text / icon 用途に限定)
```

同時に `tests/unit/wcagContrastLock.test.ts` で contrast assert を入れる。

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §3 P0-4)

**注**: light theme の `text3` (#71717a on #fff) は ≈ 4.79:1 で AA 合格、修正不要。

### 8.3 P1 — Vibrancy 階層を 3 箇所だけ採用

現状 `systemUltraThinMaterial` 採用は **3 箇所のみ** (TabBar / TopBar / 一部 Sheet)。Material 上のテキストは独自 `C.text` を使用 → 厳密には Vibrancy ではない。

**改善案**:
- Material 上の text 用に `C.labelOnGlass` semantic を新設 (= 半透明 white / 半透明 black)
- Material 上の border 用に `C.borderOnGlass` を新設

### 8.4 P2 — PlatformColor 部分導入

iOS だけ `PlatformColor('label')` を使うことで Dark Mode 自動追従の精度を上げる:
```tsx
text: Platform.OS === 'ios' ? PlatformColor('label') : palette.label
```

ただし RN Web では PlatformColor 不可、Android では label が存在しない → web/android は独自 palette を維持。

### 8.5 触らないことを決める (温存)

- **GEEK の accent `#7C6AF7`**: System Blue/Purple とは別の brand identity。これは Purpose 原則に資する独自性として温存
- **bg/bg2/bg3/bg4/bg5 の 5 段** (Apple の 3 段より多い): フィード / card / nested の表現に必要、簡素化しない

---

## 9. lint / test 化

```ts
// tests/unit/wcagContrastLock.test.ts
import { darkPalette, lightPalette } from '../../lib/theme/palettes';

function contrastRatio(hex1: string, hex2: string): number { /* ... */ }

test('dark text3 on bg は AA 合格', () => {
  expect(contrastRatio(darkPalette.text3, darkPalette.bg)).toBeGreaterThanOrEqual(4.5);
});
test('dark text4 on bg は大文字 AA 合格', () => {
  expect(contrastRatio(darkPalette.text4, darkPalette.bg)).toBeGreaterThanOrEqual(3.0);
});
test('light text3 on bg は AA 合格', () => {
  expect(contrastRatio(lightPalette.text3, lightPalette.bg)).toBeGreaterThanOrEqual(4.5);
});
```

```ts
// ESLint
{
  "no-restricted-syntax": [
    "warn",
    {
      "selector": "Literal[value=/^#[0-9a-fA-F]{6,8}$/]",
      "message": "色リテラル禁止。C.* semantic を使ってください。"
    }
  ]
}
```

---

## 10. 数値ルールまとめ

| 項目 | 値 |
|---|---|
| Label 階層 | 4 段 (Primary / Secondary / Tertiary / Quaternary) |
| Background 階層 | 3 段 (System / Secondary / Tertiary) |
| System color 数 | 11 (Red/Orange/Yellow/Green/Mint/Teal/Cyan/Blue/Indigo/Purple/Pink) |
| WCAG AA 本文 | 4.5:1 |
| WCAG AA 大文字 | 3.0:1 |
| Apple 推奨 | AAA 7:1 |
| Dark Mode 最下層 | #000000 (#1C1C1E は card 用) |

---

## 11. 出典

- **HIG Color** — https://developer.apple.com/design/human-interface-guidelines/color
- **HIG Materials** — https://developer.apple.com/design/human-interface-guidelines/materials
- **UIColor** — https://developer.apple.com/documentation/uikit/uicolor
- **SwiftUI Color** — https://developer.apple.com/documentation/swiftui/color
- **WCAG 2.1** — https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html

---

## 関連ノート

- [[Apple Liquid Glass 設計言語]] — Vibrancy は Material と一対
- [[Apple Typography — SF Pro と Dynamic Type]] — text color は semantic で
- [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] — Increase Contrast 連携
- [[GEEK × Apple HIG 監査レポート 2026-06]] — color-system 監査結果
