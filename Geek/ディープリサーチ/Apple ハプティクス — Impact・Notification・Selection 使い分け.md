# Apple ハプティクス — Impact・Notification・Selection 使い分け

> Apple の触覚フィードバックは **3 つの Feedback Generator** に区分される。Impact (物理衝突)、Notification (semantic イベント)、Selection (連続値変更)。React Native では `expo-haptics` または `react-native-haptic-feedback` で同等 mapping が可能。**System Haptics OFF 設定の尊重**と **Reduce Motion 連動** が App Review の評価軸。
> 出典: HIG Feedback、HIG Selection and Input、UIKit Haptics、expo-haptics 公式

---

## 1. 一文要約

> 触覚は **「何が起きたかを音声以外で伝える第二の言語」**。Selection = 連続変更、Impact = 物理衝突、Notification = semantic イベント、の 3 系統を意味で分けて使う。

---

## 2. Apple の 3 系統 Feedback Generator

### 2.1 UIImpactFeedbackGenerator — 物理衝突

「物が当たった」感を伝える。**5 段階**:

| Style | 強度 | 用途 |
|---|---|---|
| **soft** | 柔らかい | 浮遊する要素の着地 |
| **light** | 軽い | tap on small target、toggle ON |
| **medium** | 中程度 | tap on standard target、button press |
| **heavy** | 強い | 重要な action (送信、削除) |
| **rigid** | 硬い | 物理的な接触 (ロック解除、スナップ) |

```swift
let gen = UIImpactFeedbackGenerator(style: .light)
gen.prepare()       // 30ms 前 prep で latency 最小化
gen.impactOccurred()
```

### 2.2 UINotificationFeedbackGenerator — semantic イベント

action の**結果**を伝える。**3 種**:

| Type | 意味 |
|---|---|
| **success** | 完了 (送信、保存、購入) |
| **warning** | 注意 (制限、確認) |
| **error** | 失敗 (送信失敗、validation NG) |

```swift
let gen = UINotificationFeedbackGenerator()
gen.notificationOccurred(.success)
```

### 2.3 UISelectionFeedbackGenerator — 連続値変更

picker / slider / segmented control で**値が次の段に進んだ**ことを伝える。**強度なし、単一 method**:

```swift
let gen = UISelectionFeedbackGenerator()
gen.selectionChanged()
```

picker wheel をスクロールすると 1 段ごとに `selectionChanged` が発火する (Apple 公式 HIG 例)。

---

## 3. 使い分けの原則

### 3.1 Apple の HIG 鉄則

| 状況 | 使う | 使わない |
|---|---|---|
| toggle のスイッチ ON | Impact .light | Notification |
| picker の値変更 | Selection | Impact |
| 送信成功 | Notification .success | Impact .heavy |
| 「いいね」 tap | Impact .light or .medium | Notification |
| 「いいね」 double-tap (heart pop) | Impact .heavy | Notification |
| swipe to delete (commit) | Impact .heavy | Notification .warning |
| validation エラー | Notification .error | Impact |
| modal 開閉 | Impact .medium | Selection |
| tab 切替 | Impact .light | Selection |
| scroll の端 (bounce) | Impact .light | — |

### 3.2 一文で覚える

- **物が動いた・当たった = Impact**
- **次の段に進んだ = Selection**
- **完了/失敗/警告という結果 = Notification**

### 3.3 過剰の罠

ハプティクスは **「言いたいことがある時だけ」**。連発するとユーザーは無感覚になり、最終的に切る。
- スクロール 1 行ごとは NG (Selection 濫用)
- list の単純 tap は NG (それは visual feedback で十分)
- アニメーション中の連続発火は NG

---

## 4. React Native での実装

### 4.1 expo-haptics (推奨)

```tsx
import * as Haptics from 'expo-haptics';

// Impact 5 段
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);

// Notification 3 種
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

// Selection 1 種
Haptics.selectionAsync();
```

### 4.2 semantic ラッパ (GEEK スタイル)

```tsx
// lib/haptics.ts (semantic SoT)
import * as Haptics from 'expo-haptics';

export const haptic = {
  // tap 系
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  press: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),

  // 完了系
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),

  // 連続値
  select: () => Haptics.selectionAsync(),

  // 大action
  pop: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),

  // ソフト
  soft: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
};
```

→ semantic 名で呼び出せば実装変更に強い。

### 4.3 prepare() は使えない

iOS Native は `prepare()` で 30ms 前準備するが、JS bridge 経由で API 化されていない。React Native では発火と同時実行。

実用上 30ms の遅延差はほぼ感じないが、シビアな場合は Native module 自作 or react-native-haptic-feedback。

---

## 5. App Review との関係

### 5.1 System Haptics OFF を尊重

ユーザーが Settings > Sounds & Haptics > **System Haptics OFF** にしている時、勝手に発火しない。

iOS は API 側で自動的に sink するので **特別な購読は不要**。Apple 公式の動作。

### 5.2 アプリ内 Reduce Haptics 設定

ただし App Store 連動の "Reduce Haptics" 設定はない (2026 時点)。
→ **アプリ内に独自トグルを置く** のが Apple HIG 推奨パターン (`settings/notifications.tsx` の `useHaptics` 等)。

---

## 6. 数値ルールまとめ

| 項目 | 値 |
|---|---|
| Impact 段階 | 5 (soft / light / medium / heavy / rigid) |
| Notification 種別 | 3 (success / warning / error) |
| Selection 段階 | 1 (segmented で離散) |
| prepare の効果 | 30ms 前から ready (Native のみ) |
| 連続発火の臨界 | 50ms 以内は感知できない |

---

## 7. GEEK にどう活かすか

### 7.1 現状 (audit より)

**3 系統が並列実装で散在**:
- `lib/haptics.ts` (semantic ラッパ、SoT 候補)
- `design/haptics.ts` (`hap` 名前空間)
- `hooks/useHaptic.ts` (hook 形式)
- `PolishedButton` 内製 `triggerHaptic` (3 つの上に独自)

**問題**: `pop` の strength が **Heavy vs Medium で食い違い** (経路で振動量が割れる、ただし dead route で実害ゼロ)

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §5 haptics 行)

### 7.2 P1 — Haptic API を `lib/haptics.ts` に統一

```tsx
// lib/haptics.ts を SoT に
// design/haptics.ts → re-export only
export { haptic } from '../lib/haptics';

// hooks/useHaptic.ts → re-export or 削除
// PolishedButton 内製 triggerHaptic → haptic.press に置換
```

`pop` は **Heavy 固定** を推奨 (DoubleTapHeart の IG 風 double-tap 体験を維持)。

### 7.3 P1 — Reduce Haptics 設定

`settings/notifications.tsx` に `reduceHaptics` toggle を追加。
`lib/haptics.ts` の各関数で:
```tsx
import { useSettingsStore } from '../stores/settingsStore';

export const haptic = {
  tap: () => {
    if (useSettingsStore.getState().reduceHaptics) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  // ...
};
```

### 7.4 GEEK 操作 ↔ Haptic mapping (推奨表)

| GEEK 操作 | Haptic |
|---|---|
| TabBar 切替 | `haptic.tap` (Light) |
| 投稿 FAB tap | `haptic.press` (Medium) |
| いいね tap | `haptic.tap` (Light) |
| いいね double-tap | `haptic.pop` (Heavy) — heart pop と同期 |
| コメント送信 success | `haptic.success` |
| ブロック確定 | `haptic.warning` |
| 送信失敗 | `haptic.error` |
| 通知開封 (read) | なし (visual のみで十分) |
| スタンプ picker scroll | `haptic.select` (1 段ごと) |
| Sheet 開閉 | `haptic.tap` (Light) |
| Pull-to-refresh trigger | `haptic.tap` (Light) |
| swipe-to-delete commit | `haptic.pop` (Heavy) |
| QA mode toggle | `haptic.tap` (Light) |
| ナッジ (Push 設定 ON) | `haptic.success` |

### 7.5 触らないことを決める (温存)

- **DoubleTapHeart の Heavy**: IG 流の heart pop 体感、温存
- **スタンプ picker の Selection**: HIG 想定通り、温存

---

## 8. lint / test 化

```ts
// tests/unit/hapticConsistency.test.ts
import { haptic } from '../../lib/haptics';

test('haptic API は 7 種類すべて存在', () => {
  expect(typeof haptic.tap).toBe('function');
  expect(typeof haptic.press).toBe('function');
  expect(typeof haptic.success).toBe('function');
  expect(typeof haptic.warning).toBe('function');
  expect(typeof haptic.error).toBe('function');
  expect(typeof haptic.select).toBe('function');
  expect(typeof haptic.pop).toBe('function');
});
```

```ts
// ESLint
{
  "no-restricted-imports": [
    "error",
    {
      "paths": [
        { "name": "expo-haptics", "message": "lib/haptics の semantic ラッパを使ってください" }
      ]
    }
  ]
}
```

---

## 9. 出典

- **HIG Feedback** — https://developer.apple.com/design/human-interface-guidelines/feedback
- **HIG Selection and Input** — https://developer.apple.com/design/human-interface-guidelines/selection-and-input
- **UIImpactFeedbackGenerator** — https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator
- **UINotificationFeedbackGenerator** — https://developer.apple.com/documentation/uikit/uinotificationfeedbackgenerator
- **UISelectionFeedbackGenerator** — https://developer.apple.com/documentation/uikit/uiselectionfeedbackgenerator
- **expo-haptics** — https://docs.expo.dev/versions/latest/sdk/haptics/
- **react-native-haptic-feedback** — https://github.com/mkuczera/react-native-haptic-feedback

---

## 関連ノート

- [[Apple モーション — Spring・曲線・Reanimated 実装]] — Motion と Haptic は一対で設計
- [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] — Reduce Motion / System Haptics OFF 連携
- [[Apple 「気持ちいい」微差 — 細部の interaction]] — Haptic の極めて細かい使い分け
- [[GEEK × Apple HIG 監査レポート 2026-06]] — haptics 監査結果
