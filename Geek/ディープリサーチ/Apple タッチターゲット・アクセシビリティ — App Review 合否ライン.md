# Apple タッチターゲット・アクセシビリティ — App Review 合否ライン

> Apple のアクセシビリティは **「VoiceOver だけで全 common task が完了できる」** が pass/fail ライン。**44pt × 44pt 最小タッチ領域**、**11pt 最小フォント**、**accessibilityLabel に control type / state 語を含めない**、**Reduce Motion / Transparency / Increase Contrast の自動 honor** が四本柱。守らないと App Review で落ちる。
> 出典: App Store Connect VoiceOver Evaluation Criteria、Larger Text Evaluation Criteria、HIG Accessibility、Apple Design Tips、WWDC25/224

---

## 1. 一文要約

> Apple は **「VoiceOver only で全 common task を完了できるか」** を App Store Connect に明文化した。VoiceOver、Dynamic Type、Reduce Motion、Reduce Transparency、Increased Contrast の 5 設定への対応が、Apple 水準 = App Review 合否ライン。

---

## 2. App Review 合否の鋭利な線

### 2.1 VoiceOver — 全 common task が完了できる

App Store Connect の **VoiceOver Evaluation Criteria** に明文化:

> Users can complete **all common tasks** using VoiceOver, without sighted assistance.

**意味**: VoiceOver を ON にして画面を見ない状態で、

- サインアップ
- ログイン
- メイン機能 (投稿、検索、購入 等)
- 設定変更
- ログアウト・退会

**すべて完了できる** こと。1 箇所でも label 欠落・focus 不可・操作不可があると審査に通らない。

### 2.2 accessibilityLabel の作法 (落ちる例)

```tsx
// ❌ NG (落ちる)
<Pressable accessibilityLabel="チェックボックス チェック済み"
           accessibilityRole="checkbox"
           accessibilityState={{ checked: true }}>
  ...
</Pressable>
// → VoiceOver が「チェックボックス チェック済み, チェックボックス, チェック済み」と冗長読み

// ✅ OK
<Pressable accessibilityLabel="通知を受け取る"
           accessibilityRole="checkbox"
           accessibilityState={{ checked: true }}>
  ...
</Pressable>
// → VoiceOver が「通知を受け取る, チェックボックス, チェック済み」(label + role + state)
```

**ルール**: `accessibilityLabel` には:
- 何を意味する control か (動詞 + 名詞)
- "ボタン" / "チェックボックス" / "選択" 等の **control type 語を含めない** (role が別途読む)
- "オン" / "チェック済み" 等の **state 語を含めない** (state が別途読む)

### 2.3 Larger Text Evaluation Criteria

App Store Connect は別途 **Larger Text Evaluation Criteria** も持つ:

> The app's text scales correctly when **larger text sizes** are enabled (Dynamic Type Accessibility sizes 1–5).

→ AX1 (1.65×) から AX5 (3.10×) まで **すべてのサイズで UI が崩れない** こと。

---

## 3. 数値の絶対線

### 3.1 44pt × 44pt 最小タッチ領域

Apple Design Tips が明示:
> Minimum tap target size: **44 × 44 points**.

これは "typical viewing distance without zooming" で操作可能な下限。

**WCAG 2.5.8** (24 × 24 CSS px) より厳しい。両者を満たす必要がある。

### 3.2 11pt 最小フォント

> Minimum text size: **11 points** (Apple Design Tips).

Caption 2 (11pt) が最小。それ以下は VoiceOver でも読みにくく、Dynamic Type で崩れる。

### 3.3 コントラスト

| 基準 | コントラスト比 |
|---|---|
| WCAG AA 本文 | 4.5:1 |
| WCAG AA 大文字 | 3.0:1 |
| WCAG AAA 本文 (Apple 推奨) | 7.0:1 |

### 3.4 hitSlop で 44pt 実効化

視覚サイズが小さくても `hitSlop` で実効 44pt にできる。

```tsx
<Pressable
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
  style={{ width: 24, height: 24 }}
/>
// 視覚 24×24、実効タッチ領域 44×44 ✅
```

---

## 4. 5 つの Accessibility 設定

| OS 設定 | 何を変えるべきか | React Native API |
|---|---|---|
| **VoiceOver** | accessibilityLabel/Role/State/Hint | `AccessibilityInfo.isScreenReaderEnabled` |
| **Dynamic Type** | allowFontScaling、@ScaledMetric 連動 | `PixelRatio.getFontScale()`、`allowFontScaling` |
| **Reduce Motion** | spring / 大移動アニメ無効化 | `useReducedMotion` (reanimated) or `AccessibilityInfo.isReduceMotionEnabled` |
| **Reduce Transparency** | Material を opaque 化 | `AccessibilityInfo.isReduceTransparencyEnabled` |
| **Increase Contrast** | border 強化、色を純黒/純白寄りに | `AccessibilityInfo.isHighTextContrastEnabled` |

### 4.1 5 設定を一括購読する hook

```tsx
// hooks/useA11y.ts
import { AccessibilityInfo, PixelRatio } from 'react-native';
import { useReducedMotion as useRNReducedMotion } from 'react-native-reanimated';
import { useEffect, useState } from 'react';

export function useA11y() {
  const reduceMotion = useRNReducedMotion();
  const fontScale = PixelRatio.getFontScale();
  const [voiceOver, setVoiceOver] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [increaseContrast, setIncreaseContrast] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setVoiceOver);
    AccessibilityInfo.isReduceTransparencyEnabled?.().then(setReduceTransparency);
    AccessibilityInfo.isHighTextContrastEnabled?.().then(setIncreaseContrast);
    const subs = [
      AccessibilityInfo.addEventListener('screenReaderChanged', setVoiceOver),
      AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', setReduceTransparency),
      AccessibilityInfo.addEventListener?.('highTextContrastChanged', setIncreaseContrast),
    ];
    return () => subs.forEach(s => s?.remove?.());
  }, []);

  return { voiceOver, reduceMotion, reduceTransparency, increaseContrast, fontScale };
}
```

---

## 5. accessibilityRole の正しい使い分け

| Role | 何 |
|---|---|
| `button` | tap で action 実行する control |
| `link` | 別画面 / 外部 URL に遷移 |
| `checkbox` | 2 値選択 (state.checked 併用) |
| `switch` | toggle (state.checked 併用) |
| `tab` | tab bar の選択肢 (state.selected 併用) |
| `header` | 見出し (VoiceOver の rotor 操作で navigation) |
| `image` | 画像 (label 必須、装飾的なら `accessibilityElementsHidden` 推奨) |
| `text` | static text (label 不要) |
| `search` | 検索フィールド |
| `none` | a11y tree から除外 |

→ **`role` を明示するだけで VoiceOver の読み上げ品質が一段上がる**。

---

## 6. App Review で落ちる "13 chk"

```
[ ] 1. 全 interactive control に accessibilityLabel
[ ] 2. label に control type 語 ("button" 等) を含めていない
[ ] 3. label に state 語 ("checked" 等) を含めていない
[ ] 4. accessibilityRole が指定されている
[ ] 5. accessibilityState (toggle/checkbox/tab) が指定されている
[ ] 6. 装飾画像は accessibilityElementsHidden=true
[ ] 7. 44 × 44pt 最小タッチ領域 (hitSlop でも可)
[ ] 8. 11pt 以上のフォント
[ ] 9. AA 4.5:1 (本文) / 3.0:1 (大文字) のコントラスト
[ ] 10. Dynamic Type AX5 (3.10×) でも崩れない
[ ] 11. Reduce Motion で弾性アニメ無効化
[ ] 12. Reduce Transparency で Material が opaque
[ ] 13. Increase Contrast で border が強化される
```

---

## 7. WWDC25/224 — Accessibility Nutrition Labels (2026 強化予定)

WWDC25/224 で **Accessibility Nutrition Labels** が導入。アプリ詳細ページに各種 a11y サポート状況を申告する制度。

申告できる項目:
- VoiceOver
- Voice Control
- Larger Text Sizes
- Reduce Motion
- Reduce Transparency
- Increased Contrast
- Differentiate Without Color
- Sufficient Contrast
- Captions
- Audio Descriptions

→ **嘘の申告はペナルティ対象** (2025 年制度導入、2026 年ペナルティ強化見込み)。

---

## 8. React Native での落とし穴

### 8.1 accessibilityLabel が web で機能しない時がある

React Native Web で `accessibilityLabel` は `aria-label` に変換されるが、`Text` 子要素を持つ場合は子の textContent が優先される。

```tsx
// ❌ 一見正しいが web で意図通りに動かない
<Pressable accessibilityLabel="削除">
  <Text>×</Text>
</Pressable>

// ✅
<Pressable accessibilityLabel="削除">
  <Text accessibilityElementsHidden>×</Text>
</Pressable>
```

### 8.2 Modal の focus management

Modal を開いた時に VoiceOver の focus が背後に残る問題。

```tsx
import { findNodeHandle, AccessibilityInfo } from 'react-native';

useEffect(() => {
  if (modalVisible) {
    const node = findNodeHandle(modalRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }
}, [modalVisible]);
```

### 8.3 Web focus-visible (Tab キー navigation)

Web で keyboard navigation の focus ring が見えない問題。`:focus-visible` を CSS で inject:

```css
/* global */
:focus-visible {
  outline: 2px solid #7C6AF7;
  outline-offset: 2px;
}
```

---

## 9. GEEK にどう活かすか

### 9.1 強み (audit より)

✅ **PressableScale `hitSlop ?? 8` 既定値で 44pt 構造的担保**:
- 48×28 の Toggle ですら実効 64×44 で HIG 合格
- `accessibilityRole='button'` fallback + `accessibilityState.disabled` 完備
- 根拠: `components/ui/PressableScale.tsx:36-119` (特に L84)

✅ **ReactionButton で 44pt 明示**:
- `minHeight: 44 / minWidth: 44 / hitSlop=10` 直書きで設計意図明示
- 根拠: `components/post/PostCardActions.tsx:73-80, 386-389, 506-580`

✅ **a11y label/role/state 普及 ~135 ファイル**:
- AnonPostCard の Like/Comment/Save/Share/Quote/Reaction/メニュー/コミュ名すべて動的 label 完備

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §2.2, §2.6)

### 9.2 P0 — Dark theme text4 が WCAG 大幅違反

`lib/theme/palettes.ts:101` の `text4:'#52525b'` on `bg:'#0a0a0a'` で **2.64:1** (AA / 3.0 大文字すら未満)。

修正:
```ts
text3: '#71717a' → '#9CA3AF',  // 4.93:1 (AA pass)
text4: '#52525b' → '#7B7E8A',  // 3.42:1 (大文字 / icon 用)
```

(→ [[Apple カラーシステム — System Colors と Vibrancy]] §8.2、[[GEEK × Apple HIG 監査レポート 2026-06]] §3 P0-4)

### 9.3 P0 — OS Reduce Motion 未購読

`hooks/useReducedMotion.ts` がアプリ設定のみで OS 設定無視。
修正は [[Apple モーション — Spring・曲線・Reanimated 実装]] §8.5 参照。

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §3 P0-5)

### 9.4 P1 — Reduce Transparency / Increased Contrast 購読

`hooks/useA11y.ts` (上 §4.1) を新設、TabBar / TopBar / Sheet に配線。
- Reduce Transparency 時: BlurView intensity 0 + opaque bg
- Increased Contrast 時: borderWidth 強化、純黒/純白に近づく color

### 9.5 P1 — Dynamic Type 部分対応

- `AppText` wrapper 新設 (本文系に `maxFontSizeMultiplier={1.6}`)
- `useScaledMetric(baseValue)` hook で padding / icon size 連動
- 詳細は [[Apple Typography — SF Pro と Dynamic Type]] §7.4

### 9.6 P1 — VoiceOver header navigation

`<HeadingText level={1|2|3}>` helper を新設、`T.h1/h2/h3` 使用箇所 ~30 を段階移行。
VoiceOver の rotor で "見出し" navigation が機能するようになる。

### 9.7 P1 — Permission 拒否後の deep link

`Linking.openSettings()` を `settings/notifications.tsx` + `PushNotificationToggle.tsx` に。
HIG "Requesting Permission" の基本動線。

### 9.8 P2 — 9pt 撲滅

`AdCard.tsx:105` / `CommentThreadItem.tsx:453,494,522` / `DiscoverPhotoGrid.tsx:200-223` / `TagRelations.tsx:88,92` の `fontSize:9` を `T.caption` (11pt) に。

ESLint `no-restricted-syntax` で `Property[key.name='fontSize'] > Literal[value<11]` を warn 化、再発防止。

### 9.9 P2 — Web focus-visible inject

```css
/* fix-html.mjs or global css */
:focus-visible {
  outline: 2px solid #7C6AF7;
  outline-offset: 2px;
}
```

---

## 10. test / lint 化

```ts
// tests/unit/a11yLock.test.ts
import { darkPalette, lightPalette } from '../../lib/theme/palettes';

function contrast(c1: string, c2: string): number { /* WCAG formula */ }

test('Dark text3/text4 が AA pass', () => {
  expect(contrast(darkPalette.text3, darkPalette.bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(darkPalette.text4, darkPalette.bg)).toBeGreaterThanOrEqual(3.0);
});

test('Light text3 が AA pass', () => {
  expect(contrast(lightPalette.text3, lightPalette.bg)).toBeGreaterThanOrEqual(4.5);
});
```

```ts
// ESLint a11y plugin
{
  "plugins": ["jsx-a11y", "react-native-a11y"],
  "rules": {
    "react-native-a11y/has-valid-accessibility-role": "warn",
    "react-native-a11y/no-nested-touchables": "warn",
    "react-native-a11y/has-accessibility-hint": "off"  // hint は任意
  }
}
```

---

## 11. 出典

- **App Store Connect VoiceOver Evaluation Criteria** — https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria/
- **Larger Text Evaluation Criteria** — https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria/
- **HIG Accessibility** — https://developer.apple.com/design/human-interface-guidelines/accessibility
- **Apple Design Tips** — https://developer.apple.com/design/tips/
- **App Store Review Guidelines** — https://developer.apple.com/app-store/review/guidelines/
- **WWDC25/224** "Catch up on accessibility in SwiftUI" — https://developer.apple.com/videos/play/wwdc2025/224/

---

## 関連ノート

- [[Apple Typography — SF Pro と Dynamic Type]] — Dynamic Type 対応
- [[Apple カラーシステム — System Colors と Vibrancy]] — WCAG コントラスト
- [[Apple モーション — Spring・曲線・Reanimated 実装]] — Reduce Motion 対応
- [[Apple Liquid Glass 設計言語]] — Reduce Transparency / Increased Contrast 連携
- [[モバイル UX 品質指標]] — 隣接する量的指標
- [[GEEK × Apple HIG 監査レポート 2026-06]] — a11y 監査結果
