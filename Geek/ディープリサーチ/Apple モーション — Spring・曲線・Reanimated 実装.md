# Apple モーション — Spring・曲線・Reanimated 実装

> Apple のモーションは「物理パラメータ (mass / stiffness / damping)」から「**知覚パラメータ (response / dampingFraction)**」へ移行した。SwiftUI の `.smooth / .snappy / .bouncy` preset と Reanimated v3 の `withSpring({duration, dampingRatio})` API は同形式。React Native では withTiming / withSpring / withDecay の 3 関数で Apple 風モーションが完結する。
> 出典: WWDC23/10158「Animate with springs」、Reanimated v3 公式、SwiftUI Animation 公式

---

## 1. 一文要約

> Apple モーションの再現は **「物理を語らず、知覚を語る」** Spring API に乗ること。Reanimated v3 の `withSpring(value, { duration: 0.3, dampingRatio: 0.7 })` が SwiftUI の `.smooth(duration: 0.3, extraBounce: 0.3)` と同じ意味で動く。

---

## 2. Apple モーションの設計思想

### 2.1 知覚パラメータへの移行

旧来 (iOS 13–16): Spring は **物理 3 値** で書く
- `mass`: 物体の質量
- `stiffness`: バネ定数
- `damping`: 減衰係数

→ **デザイナが計算できない**。挙動の予測が難しい。

WWDC23 から: **知覚 2 値** で書く
- **`response`** (= `duration`): バネが収束するまでの時間 (秒)
- **`dampingFraction`** (= `dampingRatio`): 0–1 で振動具合 (1 = 振動なし、0 = 振動最大)

→ **デザイナが意図を直接書ける**。「300ms で 0.7 の弾性」と発想できる。

### 2.2 SwiftUI の 3 preset

```swift
.animation(.smooth, value: state)   // 弾性なし、振動なし
.animation(.snappy, value: state)   // 軽い弾性、素早く止まる
.animation(.bouncy, value: state)   // 明確な弾性、跳ねる
```

数値化:

| Preset | response | dampingFraction | 用途 |
|---|---|---|---|
| **.smooth** | 0.5 | 1.0 | 計算機ボタン、settings toggle |
| **.snappy** | 0.3 | 0.85 | tab 切替、modal 開閉 |
| **.bouncy** | 0.5 | 0.7 | drag-drop、enthusiasm な fb |

### 2.3 動きの 3 区分

Apple は WWDC23 で動きを 3 区分に整理:

| 区分 | 使う API | 用途 |
|---|---|---|
| **Static-to-static** | withTiming | tab 切替、modal 開閉、page transition |
| **State change** | withSpring | drag-release、scale on press、object move |
| **Velocity-driven** | withDecay | scroll 慣性、swipe momentum |

---

## 3. withTiming — 加速減速曲線

### 3.1 デフォルト

```ts
withTiming(value)  // = withTiming(value, { duration: 300, easing: Easing.inOut(Easing.quad) })
```

**300ms / `Easing.inOut(Easing.quad)`** がデフォルト。これは Apple の **Standard ease** (`cubic-bezier(0.4, 0, 0.2, 1)`) にほぼ等価。

### 3.2 Apple の標準 cubic-bezier

| Curve 名 | bezier | 用途 |
|---|---|---|
| **Standard** | (0.4, 0, 0.2, 1) | 通常遷移 |
| **Deceleration** | (0, 0, 0.2, 1) | 画面に**入る**要素 (fade in / slide in) |
| **Acceleration** | (0.4, 0, 1, 1) | 画面から**出る**要素 (fade out / slide out) |

### 3.3 Reanimated での書き方

```tsx
import { withTiming, Easing } from 'react-native-reanimated';

// 入場
opacity.value = withTiming(1, {
  duration: 250,
  easing: Easing.bezier(0, 0, 0.2, 1),    // deceleration
});

// 退場
opacity.value = withTiming(0, {
  duration: 200,
  easing: Easing.bezier(0.4, 0, 1, 1),    // acceleration
});

// 通常
opacity.value = withTiming(1, {
  duration: 300,
  easing: Easing.bezier(0.4, 0, 0.2, 1),  // standard (= default に近い)
});
```

### 3.4 退場は入場より速く

Apple の伝統: **退場 < 入場 < 通常** で時間を変える
- 入場 250ms
- 退場 200ms
- 通常 300ms

→ ユーザーは「閉じる時にもたつき」を最も強く嫌う。

---

## 4. withSpring — 知覚パラメータ Spring

### 4.1 Reanimated v3 API (新)

```ts
withSpring(value, {
  duration: 0.3,        // 秒 (SwiftUI response 相当)
  dampingRatio: 0.7,    // 0–1 (SwiftUI dampingFraction 相当)
})
```

**SwiftUI の Spring API と同形式**。Apple ⇄ React Native で同じ値が同じ動きになる。

### 4.2 旧 physics API (互換用)

```ts
withSpring(value, {
  mass: 1,
  stiffness: 100,
  damping: 10,
})
```

→ **旧 API は使わない**。`duration` / `dampingRatio` 一本化が今の正解。

### 4.3 SwiftUI ↔ Reanimated 対応表

| SwiftUI | Reanimated v3 |
|---|---|
| `.smooth` | `withSpring(v, { duration: 0.5, dampingRatio: 1.0 })` |
| `.snappy` | `withSpring(v, { duration: 0.3, dampingRatio: 0.85 })` |
| `.bouncy` | `withSpring(v, { duration: 0.5, dampingRatio: 0.7 })` |
| `.spring(response:0.3, dampingFraction:0.85)` | `withSpring(v, { duration: 0.3, dampingRatio: 0.85 })` |

→ GEEK では `design/motion.ts` に **Apple 命名で preset を統一**するのが正解。

### 4.4 GEEK の SPRING_LIQUID

GEEK は既に Apple 知覚 API で TabBar を実装している (`design/motion.ts`):

```ts
SPRING_LIQUID = { duration: 0.3, dampingRatio: 0.8 }      // TabBar morph
SPRING_LIQUID_FAST = { duration: 0.18, dampingRatio: 0.85 } // TabBar expand
```

→ これは Apple の `.snappy` に近い。Liquid Glass TabBar の morph 体感が iOS 26 想定と揃う理由。

---

## 5. withDecay — Velocity-driven

scroll や swipe の慣性。

```ts
import { withDecay } from 'react-native-reanimated';

scrollX.value = withDecay({
  velocity: gestureVelocity,
  deceleration: 0.998,    // 0.99–0.998 が iOS 体感
  clamp: [0, maxScroll],  // boundary
});
```

`deceleration: 0.998` が iOS の自然な scroll 慣性。Android (0.985–0.99) より少しゆったり。

---

## 6. Spatial Continuity — 「同じ場所から続く」

Apple のモーションの**最重要原則**: 要素が**画面間で連続性を持つ**こと。

例:
- Photos の grid → 詳細画面: 写真がそのまま拡大する (shared element transition)
- Music の Now Playing 浮上: mini player から full screen へ「同じ AlbumArt」が大きくなる
- App icon タップ: icon がそのまま window になる (iOS app launch)

### 6.1 React Native での再現

- `react-native-reanimated` の `SharedElement` (実験的)
- `react-native-shared-element` ライブラリ
- 自前: 開く前に要素の座標を `measureInWindow` で取得し、modal の入場で position 補間

### 6.2 GEEK では未配線

GEEK は Image lightbox / Video lightbox を持つが、shared element transition は未実装。
→ P2 として「写真詳細を tap で開く時に position 連続する」配線を検討。

---

## 7. 数値ルールまとめ

| 項目 | 値 |
|---|---|
| Standard easing | cubic-bezier(0.4, 0, 0.2, 1) |
| Deceleration (入場) | cubic-bezier(0, 0, 0.2, 1) |
| Acceleration (退場) | cubic-bezier(0.4, 0, 1, 1) |
| withTiming デフォルト | 300ms / Easing.inOut(Easing.quad) |
| iOS scroll deceleration | 0.998 |
| Apple .smooth | duration 0.5 / dampingRatio 1.0 |
| Apple .snappy | duration 0.3 / dampingRatio 0.85 |
| Apple .bouncy | duration 0.5 / dampingRatio 0.7 |
| 入場 / 退場 / 通常 | 250 / 200 / 300 ms (rule of thumb) |

---

## 8. GEEK にどう活かすか

### 8.1 現状 (audit より)

`design/motion.ts`:
- physics 系 5 token (`SPRING_SNAPPY`, `SPRING_SOFT`, `SPRING_BOUNCY`, `SPRING_TIGHT`, `SPRING_GENTLE`) **mass/stiffness/damping 表記**
- 知覚系 2 token (`SPRING_LIQUID`, `SPRING_LIQUID_FAST`) **duration/dampingRatio 表記**
- easing 4 種 (`EASE_OUT`, `EASE_IN_OUT`, `EASE_OUT_BACK`, `EASE_OUT_QUART`)
- timing 3 種 (`TIMING_FAST 120ms`, `TIMING_NORM 220ms`, `TIMING_SLOW 380ms`)
- inline spring 11 箇所散在 (Avatar / admin / post[id] / FeedbackFAB / SortTabs / ScopeToggle / VisibilityPicker / PostComposerSheet / ToastHost / HomeDrawer / TabBar)
- `lib/animations.ts` の `SPRING_PRESETS` も別途あり、同名 `snappy` で別物理が返る split-brain

### 8.2 P1 — 知覚 API への統一

**目標**: 全 spring を `{ duration, dampingRatio }` で統一。physics 5 token は alias として残置しつつ、新規実装は知覚 token のみ。

```ts
// design/motion.ts (再設計案)
export const SPRING = {
  // Apple Preset 互換 (推奨)
  smooth:   { duration: 0.5, dampingRatio: 1.0 },
  snappy:   { duration: 0.3, dampingRatio: 0.85 },
  bouncy:   { duration: 0.5, dampingRatio: 0.7 },

  // GEEK 既存 (温存)
  liquid:     { duration: 0.3, dampingRatio: 0.8 },   // TabBar morph
  liquidFast: { duration: 0.18, dampingRatio: 0.85 }, // TabBar expand

  // 旧 physics 5 (alias、新規禁止)
  /** @deprecated use SPRING.snappy instead */
  snappyLegacy: { damping: 18, stiffness: 300, mass: 0.6 },
  // ...
};
```

### 8.3 P1 — inline spring 11 箇所を token 参照に

```tsx
// Avatar (現状)
opacity.value = withSpring(1, { damping: 14, stiffness: 280 });

// 変更後
opacity.value = withSpring(1, SPRING.snappy);
```

### 8.4 P1 — lib/animations.ts と design/motion.ts の split-brain 解消

`lib/animations.ts` の `SPRING_PRESETS` を `design/motion.ts` の **re-export** にする。同名 `snappy` で別物理が返る現状を解消。

### 8.5 P0 — OS Reduce Motion 購読

**現状**: `hooks/useReducedMotion.ts:1-5` は `useSettingsStore((s) => s.reduceMotion)` のみで OS 設定無視。

**修正**:
```tsx
// hooks/useReducedMotion.ts
import { useReducedMotion as useRNReducedMotion } from 'react-native-reanimated';
import { useSettingsStore } from '../stores/settingsStore';

export function useReducedMotion(): boolean {
  const appSetting = useSettingsStore((s) => s.reduceMotion);
  const osSetting = useRNReducedMotion();  // ← 追加
  return appSetting || osSetting;
}
```

→ 既存 import 38 ファイルは変更不要。1 ファイル 1 行で全画面が OS 設定に追従。

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §3 P0-5)

### 8.6 P2 — Spatial Continuity

写真 lightbox に shared element transition 配線:
- フィードの ImageGrid → ImageLightbox の遷移で位置補間
- react-native-shared-element or expo-image の遷移 hook

---

## 9. Reduce Motion 連携の正しい書き方

```tsx
import { useReducedMotion } from '../../hooks/useReducedMotion';

function Card({ visible }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = visible ? 1 : 0;  // 即時切替
    } else {
      opacity.value = withTiming(visible ? 1 : 0, { duration: 250 });
    }
  }, [visible, reduceMotion]);
}
```

**ルール**: Reduce Motion 時は
- 弾性アニメ無効化
- duration を 0 または短縮 (50ms 以下)
- opacity の切替自体は維持 (fade in/out は OK、transform は NG)

---

## 10. 出典

- **WWDC23/10158** "Animate with springs" — https://developer.apple.com/videos/play/wwdc2023/10158/
- **Reanimated v3 withTiming** — https://docs.swmansion.com/react-native-reanimated/docs/animations/withTiming/
- **Reanimated v3 withSpring** — https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring/
- **SwiftUI Animation** — https://developer.apple.com/documentation/swiftui/animation
- **HIG Motion** — https://developer.apple.com/design/human-interface-guidelines/motion

---

## 関連ノート

- [[Apple ハプティクス — Impact・Notification・Selection 使い分け]] — モーションと触感はセットで設計
- [[Apple Liquid Glass 設計言語]] — Material の動きは spring で
- [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] — Reduce Motion 対応
- [[UI の滑らかさ — スクロール追従と画面遷移]] — 同じテーマの実装編
- [[リキッドタブインジケーター完全ガイド]] — Spring 実例 (SPRING_LIQUID)
- [[GEEK × Apple HIG 監査レポート 2026-06]] — motion-spring 監査結果
