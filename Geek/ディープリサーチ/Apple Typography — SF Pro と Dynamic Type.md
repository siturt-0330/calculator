# Apple Typography — SF Pro と Dynamic Type

> San Francisco は 2020 年から**可変フォント化**され、SF Text と SF Display のハードブレーク (20pt) は消失して 17–28pt で連続光学補間に移行した。**最小フォント 11pt**、**Body 17pt**、**Tight/Loose Leading ±2pt**、**Dynamic Type は UIFontMetrics / @ScaledMetric で custom font にも適用**。
> 出典: WWDC20/10175「The details of UI typography」、UIFontMetrics 公式、@ScaledMetric 公式、Apple Design Tips

---

## 1. 一文要約

> Apple のタイポグラフィは **11 種の Text Styles × Dynamic Type × Tight/Loose Leading** の三軸で完全に体系化されており、custom font であっても `@ScaledMetric(relativeTo:)` を使えば system font 同等の自動スケーリングを得られる。

---

## 2. 11 種の Text Styles (HIG 公式)

iOS は本文系・見出し系・補助系を含む 11 種の Text Styles を持つ。これが Dynamic Type の単位でもある。

| Text Style | Size (pt) | Weight | 用途 |
|---|---|---|---|
| **Large Title** | 34 | Regular | 画面トップの大見出し |
| **Title 1** | 28 | Regular | section の大見出し |
| **Title 2** | 22 | Regular | section の中見出し |
| **Title 3** | 20 | Regular | section の小見出し |
| **Headline** | 17 | **Semibold** | リスト項目の見出し |
| **Body** | 17 | Regular | **本文標準** |
| **Callout** | 16 | Regular | やや小さい本文 |
| **Subhead** | 15 | Regular | 補助情報 |
| **Footnote** | 13 | Regular | 脚注 |
| **Caption 1** | 12 | Regular | キャプション |
| **Caption 2** | 11 | Regular | **最小フォント (限界)** |

→ **Body 17pt がデフォルト。GEEK の `body=15` はやや小さい** (Apple 本文水準より −2pt)。

---

## 3. SF Pro の可変フォント化 (2020〜)

### 3.1 ハードブレーク消失

2020 以前: SF Text (<20pt) と SF Display (≥20pt) の二光学サイズで切替
2020〜: SF Pro は **可変フォント化**され、**17–28pt で連続補間** に移行

| 旧 (2017–2020) | 新 (2020–) |
|---|---|
| <20pt は SF Text | 17pt: 自動で SF Text 風 (字間広め、ストロークやや太め) |
| ≥20pt は SF Display | 28pt: 自動で SF Display 風 (字間狭め、ストローク細め) |
| 20pt 境界で**ジャンプ** | 17→28pt で**連続補間** |

→ 開発者は font family を切替えなくていい。system font API は自動的に最適化される。

### 3.2 React Native で同等を狙う

```tsx
import { Platform } from 'react-native';

// iOS: PlatformDefault (= -apple-system = SF Pro 可変)
// Android: Inter (近似)
// Web: -apple-system 優先
const FONT_FAMILY = Platform.select({
  ios: 'System',
  android: 'Inter_400Regular',
  web: '-apple-system, "SF Pro Text", "SF Pro Display", "Inter", sans-serif',
});
```

iOS で `fontFamily: 'System'` は SF Pro 可変を使う。サイズに応じて光学最適化される。

---

## 4. Tight / Loose Leading (±2pt)

iOS の Text Styles には system-sanctioned な leading variant が存在:

- **Tight leading = default −2pt**
- **Loose leading = default +2pt**
- **watchOS だけは ±1pt**

### 4.1 SwiftUI / UIKit での指定

```swift
// SwiftUI
.font(.body.leading(.tight))   // -2pt
.font(.body.leading(.loose))   // +2pt

// UIKit
UIFontDescriptor.SymbolicTraits.traitTightLeading
UIFontDescriptor.SymbolicTraits.traitLooseLeading
```

### 4.2 React Native で同等

```tsx
const T = {
  body: { fontSize: 17, lineHeight: 22 },        // default
  bodyTight: { fontSize: 17, lineHeight: 20 },   // -2pt leading
  bodyLoose: { fontSize: 17, lineHeight: 24 },   // +2pt leading
};
```

**使い分け**:
- **Tight**: dense な情報 (表、設定リスト、コードブロック)
- **Loose**: 長文読み物 (記事、コメント、説明文)
- **Default**: UI 全般

---

## 5. Dynamic Type — Apple の真骨頂

ユーザーが Settings > Display & Brightness > Text Size で 7 段階 (xSmall 〜 xxxLarge + 5 accessibility size) を選べる。**system font API は自動 opt-in**、custom font は手動対応が必要。

### 5.1 サイズ倍率

| Size 設定 | 倍率 (Body 17pt 基準) |
|---|---|
| xSmall | 0.82× (14pt) |
| Small | 0.88× (15pt) |
| Medium | 0.94× (16pt) |
| **Large (default)** | **1.0× (17pt)** |
| xLarge | 1.12× (19pt) |
| xxLarge | 1.24× (21pt) |
| xxxLarge | 1.35× (23pt) |
| Accessibility 1 | 1.65× (28pt) |
| Accessibility 5 | **3.10× (53pt)** |

→ Accessibility 5 では Body が **53pt** に。**全画面で機能する**ことが App Review の合否ライン。

### 5.2 UIKit での実装

```swift
// system font は自動
label.font = .preferredFont(forTextStyle: .body)
label.adjustsFontForContentSizeCategory = true

// custom font は UIFontMetrics で手動
let customFont = UIFont(name: "Inter-Regular", size: 17)!
label.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: customFont)
```

### 5.3 SwiftUI での実装

```swift
// system font は自動
Text("body").font(.body)

// custom font は relativeTo で
Text("custom").font(.custom("Inter-Regular", size: 17, relativeTo: .body))

// padding/spacing も連動させる
@ScaledMetric(relativeTo: .body) var iconSize: CGFloat = 24
Image(systemName: "heart").font(.system(size: iconSize))
```

→ **@ScaledMetric が key**。サイズ連動で padding / icon / spacing も全部スケールさせる。

### 5.4 React Native での実装

system font API のような自動 opt-in はない。手動で `PixelRatio.getFontScale()` を読む。

```tsx
import { PixelRatio, Text } from 'react-native';

export function useScaledMetric(baseValue: number, textStyle: 'body' | 'caption' = 'body') {
  const scale = PixelRatio.getFontScale();  // 0.82 〜 3.10
  return baseValue * scale;
}

// 使用
function Card() {
  const iconSize = useScaledMetric(24);
  const padding = useScaledMetric(16);
  return (
    <View style={{ padding }}>
      <Icon size={iconSize} />
      <Text style={{ fontSize: 17, allowFontScaling: true }}>本文</Text>
    </View>
  );
}
```

**`allowFontScaling={true}`** が React Native での `adjustsFontForContentSizeCategory` 相当。デフォルト true だが、数字 counter / fixed layout には `false` で固定する。

### 5.5 上限を設ける

```tsx
<Text style={T.body} maxFontSizeMultiplier={1.6}>本文</Text>
```

`maxFontSizeMultiplier` で「これ以上は崩れる」上限を設定。本文系は 1.6、UI 系は 1.3、固定 layout は 1.0。

---

## 6. 数値ルールまとめ

| 項目 | 値 | 根拠 |
|---|---|---|
| 最小フォント | **11pt** | Apple Design Tips、claim 6 (3-0 verified) |
| Body デフォルト | **17pt** | iOS Text Styles |
| Headline 太さ | **Semibold** | iOS Text Styles |
| Tight leading | **−2pt** | UIFontDescriptor |
| Loose leading | **+2pt** | UIFontDescriptor |
| watchOS leading | **±1pt** | WWDC20/10175 |
| SF Pro 連続補間範囲 | **17–28pt** | WWDC20/10175 |
| Dynamic Type 最大倍率 | **3.10×** (AX5) | UIContentSizeCategory |

---

## 7. GEEK にどう活かすか

### 7.1 現状サマリー (audit より)

`design/typography.ts` の `T` に 17 種:
- `hero=40/48`, `display=34/40`, `h1=28/34`, `h2=22/30`, `h3=18/26`, `h4=16/22`
- `body=15/22`, `bodyM=15/22`, `bodyB=15/22`
- `small=13/18`, `smallM=13/18`, `smallB=13/18`
- `caption=11/16`, `captionM=11/16`
- `num=15/20`, `numLg=22/28`, `mono=13/18`
- `buttonLg=16/22`, `buttonMd=14/20`, `buttonSm=12/16`

### 7.2 Apple との Gap

| GEEK | Apple HIG | 差 |
|---|---|---|
| `body=15/22` | Body=17/22 | **−2pt** (本文が小さい) |
| Headline 欠落 | Headline=17 Semibold | UI list 項目で Headline 不在 |
| `h3=18/26` | Title 3=20 | −2pt |
| `h4=16/22` | Callout=16 ✅ | 一致 |
| Dynamic Type | UIFontMetrics | **0 対応** |
| 9pt 散発 (`AdCard.tsx:105` / `CommentThreadItem.tsx:453,494,522` / `DiscoverPhotoGrid.tsx:200-223`) | 11pt 下限 | **HIG 違反** |

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §5 typography 行)

### 7.3 P0 — 直ちに直す (verify 未昇格、P2 扱い)

- **9pt 撲滅**: `tokens.ts` で `fontSize` リテラル `<11` を ESLint で warn 化 + 既存箇所を `T.caption` (11pt) に底上げ

### 7.4 P1 — 中期で詰める

- **`AppText` wrapper 新設**: 本文系に `maxFontSizeMultiplier={1.6}` を default 適用
  ```tsx
  // components/ui/AppText.tsx
  export function AppText({ scale = 'body', ...props }) {
    const max = scale === 'body' ? 1.6 : scale === 'ui' ? 1.3 : 1.0;
    return <Text maxFontSizeMultiplier={max} {...props} />;
  }
  ```
- **`useScaledMetric` hook**: padding / icon size / line-height を Dynamic Type に連動
- **HIG 名 alias を `T` に並列追加**:
  ```tsx
  T.largeTitle = { fontSize: 34, lineHeight: 40 };
  T.title1 = { fontSize: 28, lineHeight: 34 };
  T.headline = { fontSize: 17, lineHeight: 22, fontWeight: '600' };
  T.bodyHig = { fontSize: 17, lineHeight: 22 };
  // 既存 alias は残しつつ、新規 component は HIG 名を使う規律
  ```

### 7.5 P2 — 機を見て

- **本文を 17pt に上げる**: `T.body = { fontSize: 17, lineHeight: 22 }` への移行 (情報密度が下がるので段階的に)
- **Tight/Loose alias**: `T.bodyTight`, `T.bodyLoose` を追加し dense 表 / 長文の使い分け

---

## 8. lint / test 化

```ts
// ESLint custom rule (.eslintrc)
{
  "rules": {
    "no-restricted-syntax": ["warn", {
      "selector": "Property[key.name='fontSize'] > Literal[value<11]",
      "message": "fontSize は 11pt 未満禁止 (Apple HIG: Design Tips)。T.caption を使ってください。"
    }]
  }
}
```

```ts
// tests/unit/typographyLock.test.ts
import { T } from '../../design/typography';

test('caption は 11pt 以上', () => {
  expect(T.caption.fontSize).toBeGreaterThanOrEqual(11);
});

test('Headline は 17pt Semibold', () => {
  expect(T.headline?.fontSize).toBe(17);
  expect(T.headline?.fontWeight).toBe('600');
});
```

---

## 9. 出典

- **WWDC20/10175** "The details of UI typography" — https://developer.apple.com/videos/play/wwdc2020/10175/
- **UIFontMetrics** — https://developer.apple.com/documentation/uikit/uifontmetrics
- **@ScaledMetric** — https://developer.apple.com/documentation/swiftui/scaledmetric
- **Apple Design Tips** (11pt 最小) — https://developer.apple.com/design/tips/
- **HIG Typography** — https://developer.apple.com/design/human-interface-guidelines/typography

---

## 関連ノート

- [[Apple カラーシステム — System Colors と Vibrancy]] — text color は label/secondaryLabel 等の semantic で
- [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] — Dynamic Type の審査基準
- [[Apple スペーシング・角丸 — 4pt Grid と Concentric Shapes]] — typography と spacing は連動
- [[GEEK × Apple HIG 監査レポート 2026-06]] — typography 監査結果
