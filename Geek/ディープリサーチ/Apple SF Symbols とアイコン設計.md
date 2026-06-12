# Apple SF Symbols とアイコン設計

> SF Symbols は **5,000+ の Apple 公式アイコン**を SF Pro と完全に共役する形で提供する icon system。**6 weight × 3 scale**、**filled / outlined / multi-color variants**、**Dynamic Type 自動連動** が四本柱。React Native では `expo-symbols` または `sf-symbols-image` で iOS native 呼び出しが可能。
> 出典: HIG SF Symbols、SF Symbols 6 App、Apple Design Resources、expo-symbols 公式

---

## 1. 一文要約

> SF Symbols は **「テキストと完全に同じスケールで動く icon」** として設計されている。SF Pro のフォントウェイトと完全に共役するため、icon は text と同じ Dynamic Type 倍率で自動拡縮し、配置の重心がずれない。

---

## 2. SF Symbols の数値設計

### 2.1 6 weight × 3 scale

| Weight | Scale |
|---|---|
| Ultralight | Small |
| Thin | Medium (default) |
| Light | Large |
| **Regular** (default) | |
| **Medium** | |
| Semibold | |
| Bold | |
| Heavy | |
| Black | |

→ **9 weight × 3 scale = 27 種の可変点** を 1 icon が持つ。これが SF Pro と同じ自由度。

### 2.2 4 種の variant (色塗り)

| Variant | 例 |
|---|---|
| **Monochrome** | 単色 (デフォルト) |
| **Hierarchical** | 1 色相 + 透明度 3 段 |
| **Palette** | 2–3 色を指定 |
| **Multicolor** | 公式の固有色 (heart.fill = 赤、moon.stars.fill = 青) |

### 2.3 filled / outlined のペア

ほとんどの icon に `xxx` (outlined) と `xxx.fill` (filled) のペアがある:
- `heart` / `heart.fill`
- `house` / `house.fill`
- `bookmark` / `bookmark.fill`
- `bell` / `bell.fill`

**選択状態は filled** が iOS 標準。

### 2.4 SF Symbols 6 (iOS 18+)

iOS 18 で SF Symbols 6 が登場:
- **アニメーション付き** (bounce, pulse, scale, variableColor, etc.)
- **Wiggle / Breath effects** (バウンド、揺れ)
- 新規 800+ icons

---

## 3. アイコン設計の原則

### 3.1 一貫性は最強の親しみ

「同じアプリ内で複数の icon set を混在させない」が鉄則。
- ✅ 全 icon が SF Symbols
- ✅ 全 icon が Lucide
- ❌ ヘッダーは SF Symbols、フィードは Lucide、設定は Material Icons

混在は ユーザーが「アプリの一貫した personality」を読み取れなくなる。

### 3.2 weight と stroke の一致

icon の stroke weight が text の font weight と一致するべき:
- Body text (Regular) + icon (Regular)
- Headline (Semibold) + icon (Semibold)
- Section header (Bold) + icon (Bold)

### 3.3 サイズの 3 段

- **Small** (17pt 相当): inline (text 横)
- **Medium** (20pt 相当): button / control
- **Large** (24pt 相当): toolbar / FAB

### 3.4 active / inactive の表現

| 状態 | 表現 |
|---|---|
| Default | outlined (`heart`) |
| Active / Selected | filled (`heart.fill`) |
| Disabled | outlined + opacity 0.4 |
| Pressed | scale 0.95 |

---

## 4. React Native での実装

### 4.1 expo-symbols (iOS 16+ 推奨)

```tsx
import { SymbolView } from 'expo-symbols';

<SymbolView
  name="heart.fill"
  size={24}
  tintColor={C.accent}
  weight="medium"           // SF Symbol weight
  scale="medium"            // small / medium / large
  type="hierarchical"       // monochrome / hierarchical / palette / multicolor
/>
```

iOS 16+ で動く。Android / Web は何も描画しないので fallback 必須。

### 4.2 Platform 出し分け Facade

```tsx
// components/ui/UIIcon.tsx
import { Platform } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Heart, HeartFilled } from 'lucide-react-native';

type IconName = 'heart' | 'heart.fill' | 'house' | 'house.fill' | /* ... */;

const ICON_MAP: Record<IconName, { sf: string; lucide: any; lucideFilled?: any }> = {
  'heart':       { sf: 'heart',       lucide: Heart },
  'heart.fill':  { sf: 'heart.fill',  lucide: HeartFilled },
  'house':       { sf: 'house',       lucide: Home },
  'house.fill':  { sf: 'house.fill',  lucide: HomeFilled },
  // ...
};

export function UIIcon({ name, size = 24, color, weight = 'regular' }: Props) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={ICON_MAP[name].sf}
        size={size}
        tintColor={color}
        weight={weight}
      />
    );
  }
  const Lucide = ICON_MAP[name].lucide;
  return <Lucide size={size} color={color} strokeWidth={weightToStroke(weight)} />;
}

function weightToStroke(w: string): number {
  return { ultralight: 1.0, thin: 1.4, light: 1.8, regular: 2.0, medium: 2.4, semibold: 2.6, bold: 2.8 }[w] ?? 2;
}
```

### 4.3 サードパーティ icon 単体使用 (Android/Web 主体)

Android / Web では Lucide 一本に絞る。SF Symbols 名で呼ぶ Facade を維持して、iOS だけ native 化。

---

## 5. SF Symbols と他 icon の混在ルール

### 5.1 推奨パターン

- **iOS 主体アプリ**: SF Symbols 一本、Android/Web は Lucide fallback
- **マルチ platform 等価**: Lucide 一本 (一貫性優先)
- **Brand icon は別**: 自社ロゴ / コミュニティ icon は独自 SVG (icon set とは別扱い)

### 5.2 反パターン

- ❌ iOS で SF Symbols と Lucide を混在 (stroke weight が揃わない)
- ❌ 「SF にない icon は Material から」(personality が割れる)
- ❌ Tab bar だけ SF、それ以外 Lucide

---

## 6. GEEK にどう活かすか

### 6.1 現状 (audit より)

- **lucide-react-native 単独**: 一貫性は OK
- **`SIZE.icon*` 4 段定義** (Sm 16 / Md 20 / Lg 24 / Xl 28) あるが、Icon prop での利用 **2 件のみ**
- **size 30 種、strokeWidth 13 種が混在** → 厳密な weight/scale 一致が崩れている
- **SF Symbols dead MAPPING**: `components/ui/icon-symbol.ios.tsx` で 4 icon 分の MAPPING はあるが**実利用 0** (dead)
- **TabIcon の active**: accent 色 crossfade のみで filled variant なし

### 6.2 P1 — UIIcon Facade 新設 + SF Symbols 統合

```tsx
// constants/icons.ts を拡張
export const ICON_MAP = {
  'heart':       { sf: 'heart',       sfFill: 'heart.fill',       lucide: Heart },
  'house':       { sf: 'house',       sfFill: 'house.fill',       lucide: Home },
  'magnifyingglass': { sf: 'magnifyingglass', sfFill: 'magnifyingglass', lucide: Search },
  // 全 alias を 3 つ組で
};
```

```tsx
// components/ui/UIIcon.tsx (新規)
export function UIIcon({ name, active, size = 24, color, weight = 'regular' }) {
  const symbol = active ? ICON_MAP[name].sfFill : ICON_MAP[name].sf;
  if (Platform.OS === 'ios') {
    return <SymbolView name={symbol} size={size} tintColor={color} weight={weight} />;
  }
  return <Lucide name={ICON_MAP[name].lucide} size={size} color={color} strokeWidth={STROKE[weight]} />;
}
```

### 6.3 P1 — TabIcon の active = filled variant

```tsx
<UIIcon name="house" active={isActive} size={26} color={isActive ? C.accent : C.text2} />
// iOS: 非選択は house、選択は house.fill ← Apple HIG 標準
```

### 6.4 P1 — STROKE token 化 + codemod

```tsx
export const STROKE = {
  ultralight: 1.0,
  thin: 1.4,
  light: 1.8,
  regular: 2.0,
  medium: 2.4,
  semibold: 2.6,
  bold: 2.8,
};
```

codemod で `strokeWidth: 2.2 / 2.6 / 3.0` 等の 13 種を `STROKE.medium` 等 7 段に丸める。

### 6.5 P2 — `SIZE.icon*` 利用強制

ESLint で `Icon size={数値リテラル}` 禁止、`SIZE.icon*` 経由のみ。

### 6.6 触らないことを決める (温存)

- **Lucide 単独構成 (Android/Web)**: 既に揃っている、変えない
- **コミュニティ icon (絵文字)**: SF Symbols でも Lucide でもなく **emoji** だが、ユーザー生成コンテンツとしての性質上 emoji が正解 → 温存
- **GEEK ロゴ**: 独自 SVG (Syne_700Bold + gradient) は brand identity、温存

---

## 7. SF Symbols 推奨 mapping (GEEK 用)

| GEEK use case | SF Symbol | Lucide (fallback) |
|---|---|---|
| Home (Feed) | `house` / `house.fill` | Home |
| 検索 | `magnifyingglass` | Search |
| コミュニティ | `person.3` / `person.3.fill` | Users |
| マイページ | `person.crop.circle` / `person.crop.circle.fill` | UserCircle |
| 投稿 (FAB) | `plus.circle.fill` | Plus |
| いいね | `heart` / `heart.fill` | Heart |
| コメント | `bubble.left` / `bubble.left.fill` | MessageCircle |
| 引用投稿 | `quote.bubble` / `quote.bubble.fill` | Quote |
| シェア | `square.and.arrow.up` | Share |
| 通知 | `bell` / `bell.fill` | Bell |
| 設定 | `gearshape` / `gearshape.fill` | Settings |
| 戻る | `chevron.left` | ChevronLeft |
| 閉じる (Modal) | `xmark` | X |
| メニュー (…) | `ellipsis` | MoreHorizontal |
| ブロック | `hand.raised` | Hand |
| 報告 | `exclamationmark.bubble` | Flag |
| 編集 | `pencil` | Edit |
| 削除 | `trash` | Trash |
| 検索クリア | `xmark.circle.fill` | XCircle |
| ロケーション | `mappin.and.ellipse` | MapPin |

---

## 8. 数値ルールまとめ

| 項目 | 値 |
|---|---|
| Weight 段階 | 9 (Ultralight〜Black) |
| Scale 段階 | 3 (Small / Medium / Large) |
| Variant 種別 | 4 (mono / hierarchical / palette / multicolor) |
| icon size 3 段 | 17 / 20 / 24 pt |
| Tab icon | 25pt Medium |
| Selected = filled | xxx.fill |
| stroke = font weight 連動 | regular ↔ 2.0 / medium ↔ 2.4 / bold ↔ 2.8 |

---

## 9. 出典

- **HIG SF Symbols** — https://developer.apple.com/design/human-interface-guidelines/sf-symbols
- **SF Symbols 6** — https://developer.apple.com/sf-symbols/
- **expo-symbols** — https://docs.expo.dev/versions/latest/sdk/symbols/
- **Apple Design Resources** — https://developer.apple.com/design/resources/

---

## 関連ノート

- [[Apple Typography — SF Pro と Dynamic Type]] — SF Pro と SF Symbols は共役
- [[Apple カラーシステム — System Colors と Vibrancy]] — icon の tintColor
- [[Apple ナビゲーション — TabBar・NavBar・Sheet・Modal]] — TabIcon の active 表現
- [[GEEK × Apple HIG 監査レポート 2026-06]] — icons 監査結果
