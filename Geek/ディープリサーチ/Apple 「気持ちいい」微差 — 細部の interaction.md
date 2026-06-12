# Apple 「気持ちいい」微差 — 細部の interaction

> ユーザーが「気持ちいい」と感じる Apple の手触りは、**明文化されていないが Apple がやっている小さな選択** の積み重ね。**button press の影の方向、scroll の慣性係数、keyboard avoidance のアニメ曲線、modal を閉じる速度** の 4 大領域で、Apple 標準値を知り、知覚 spring + haptic + visual の三層をレイヤリングする。
> 出典: WWDC23/10158、WWDC26/250「Craft / Delight」、HIG Motion、観察ベース (Apple 純正アプリ実機分析)

---

## 1. 一文要約

> 「気持ちいい」は **「200ms 以下の操作で 3 つ以上のフィードバックレイヤーが揃う」** ことで生まれる。Apple は **scale + opacity + shadow + haptic + sound** を 1 frame 単位で同期させる。

---

## 2. Button Press — 影とスケールの三位一体

### 2.1 Apple 純正の Press 体感

iPhone Settings / Mail / Music の button press を実機観察すると:

1. **0ms**: tap 開始
2. **0–10ms**: haptic 発火 (Light Impact)
3. **0–80ms**: scale 0.97 (slow attack)
4. **80–150ms**: opacity 0.85 (subtle dim)
5. **150ms+**: shadow が「縮む」(影の reach が elevation を下げる)
6. **release**: scale 1.0 へ 200ms spring (snappy 0.85)、影は通常へ復帰

### 2.2 React Native での再現

```tsx
import { PressableScale } from './PressableScale';
import * as Haptics from 'expo-haptics';

<PressableScale
  pressedScale={0.97}            // Apple 標準 (0.95 はやや強すぎる)
  pressedOpacity={0.85}
  onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
  springConfig={{ duration: 0.2, dampingRatio: 0.85 }}
>
  ...
</PressableScale>
```

### 2.3 影の縮みも同期

```tsx
const shadowOpacity = useSharedValue(0.15);
const shadowOffset = useSharedValue(4);

const animatedStyle = useAnimatedStyle(() => ({
  shadowOpacity: shadowOpacity.value,
  shadowOffset: { width: 0, height: shadowOffset.value },
}));

onPressIn={() => {
  shadowOpacity.value = withTiming(0.08, { duration: 80 });
  shadowOffset.value = withTiming(1, { duration: 80 });
}}
onPressOut={() => {
  shadowOpacity.value = withSpring(0.15, SPRING.snappy);
  shadowOffset.value = withSpring(4, SPRING.snappy);
}}
```

→ 影の同期は「縮むことで物理的に押されている感」を生む。

---

## 3. Scroll の慣性 — `deceleration: 0.998`

### 3.1 iOS の自然な scroll 体感

- スクロール終わりの**ゆるい着地**
- 端での **rubber band bounce**
- 速度に応じた減衰

数値:

| 項目 | iOS | Android |
|---|---|---|
| Deceleration rate | **0.998** (normal) / 0.99 (fast) | 0.985 |
| Bounce | あり (rubber band) | なし (overshoot fade) |
| Spring at edge | duration 0.3 / dampingRatio 0.6 | — |

### 3.2 FlashList での設定

```tsx
<FlashList
  decelerationRate="normal"            // = 0.998 on iOS
  // または明示
  decelerationRate={0.998}
  bounces={true}                       // iOS rubber band
  overScrollMode="never"               // Android overshoot fade off
/>
```

### 3.3 nested ScrollView の罠

ScrollView の中に horizontal ScrollView がある時、両方が同じ deceleration だと体感が重い。**親 0.998 / 子 0.99** くらいで子が速く止まる方が自然。

---

## 4. Keyboard Avoidance — animationDuration を曲線で読む

### 4.1 iOS Keyboard event の数値

iOS の keyboard 表示イベントは `keyboardWillShow` / `keyboardWillHide` で:
- `duration`: **0.25s** (デフォルト)
- `easingCurve`: `cubic-bezier(0.17, 0.59, 0.4, 0.77)` (iOS 専用)

### 4.2 KeyboardAvoidingView の正しい設定

```tsx
import { KeyboardAvoidingView, Platform, Keyboard } from 'react-native';

<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
  style={{ flex: 1 }}
>
  {children}
</KeyboardAvoidingView>
```

### 4.3 自前で同期 (Reanimated)

```tsx
import { useKeyboardHandler } from 'react-native-keyboard-controller';

const height = useSharedValue(0);

useKeyboardHandler({
  onMove: (e) => {
    'worklet';
    height.value = e.height;  // 自動で iOS の easing curve に追従
  },
});

const padding = useAnimatedStyle(() => ({ paddingBottom: height.value }));
```

`react-native-keyboard-controller` を使うと iOS の正確な curve を再現できる。

---

## 5. Modal を閉じる速度 — 200ms 鉄則

### 5.1 開閉の非対称

Apple は **「閉じる時はやや速く」** を一貫:
- 開く: 350–400ms (期待を高める)
- 閉じる: 200–250ms (引きずらない)

### 5.2 expo-router での指定

```tsx
<Stack.Screen
  options={{
    presentation: 'modal',
    animation: 'slide_from_bottom',
    animationDuration: 380,           // 開く
    // 閉じる側の duration は OS 任せ (約 220ms)
  }}
/>
```

### 5.3 Gesture dismiss の慣性

下方向 swipe で modal を閉じる時、velocity が一定以上なら **そのまま下に投げる** (= scroll の decay と同じ慣性):

```tsx
const dismissThreshold = 0.5;  // 画面半分以上 = 閉じる
const velocityThreshold = 800; // 速度 800+/s = 閉じる

if (translateY > screenHeight * dismissThreshold || velocityY > velocityThreshold) {
  translateY.value = withDecay({ velocity: velocityY, deceleration: 0.998 });
  setTimeout(close, 200);
}
```

---

## 6. List 項目の Press

### 6.1 iOS Settings の List 体感

iOS Settings の list item を tap すると:
1. **0ms**: tap
2. **0ms**: 背景色が `tertiarySystemBackground` に切替 (即時)
3. **release**: 100ms で元の背景色へ fade
4. **遷移開始**: 150ms で **chevron が縮む** (物理的に押し込まれる感)

### 6.2 React Native での再現

```tsx
const bg = useSharedValue('transparent');
const chevronScale = useSharedValue(1);

<Pressable
  onPressIn={() => {
    bg.value = C.bg2;                  // 即時切替
    chevronScale.value = withTiming(0.92, { duration: 120 });
  }}
  onPressOut={() => {
    bg.value = withTiming('transparent', { duration: 100 });
    chevronScale.value = withSpring(1, SPRING.snappy);
  }}
>
  <Row>
    <Text>...</Text>
    <Animated.View style={{ transform: [{ scale: chevronScale.value }] }}>
      <Icon name="chevron.right" />
    </Animated.View>
  </Row>
</Pressable>
```

---

## 7. Heart の Double-Tap (Like)

### 7.1 IG / Apple 系の体感

Photo に double-tap で like する時:
1. **0ms**: 2 回目 tap
2. **0ms**: heart が**画面中央に出現** (scale 0 → 1.3)
3. **150ms**: 1.3 → 1.0 (bounce settle)
4. **0ms**: Heavy Impact haptic
5. **500–800ms**: heart が**フェードアウト + 上に少しドリフト**

### 7.2 数値

```ts
const HEART_SCALE_KEYFRAMES = [0, 1.3, 1.0, 1.15, 1.0, 0.9, 0];
const HEART_DURATION = 800;
const HEART_HAPTIC = Heavy;
```

### 7.3 GEEK の DoubleTapHeart

GEEK は既に keyframes 5 段で実装済 (`design/motion.ts`):
```ts
HEART_SCALE_KEYFRAMES: [0, 1.3, 1.0, 1.15, 1.0, 0.9, 0]
```
→ IG / Apple 体感と一致。

---

## 8. ToggleSwitch のアニメ

### 8.1 iOS Toggle の体感

1. **0ms**: tap on knob
2. **0ms**: knob slide (200ms spring)
3. **50ms**: track 色が変化 (knob 中央で切替)
4. **0ms**: Selection haptic (`UISelectionFeedbackGenerator`)

### 8.2 数値

```ts
const TOGGLE_SPRING = { duration: 0.2, dampingRatio: 0.85 };
const TRACK_COLOR_TRANSITION_DELAY = 50;  // knob 中央で切替
const TOGGLE_HAPTIC = Selection;
```

---

## 9. Pull-to-Refresh の体感

### 9.1 iOS Mail の体感

1. **0–60pt**: 通常 scroll (refresh の予感のみ)
2. **60–100pt**: refresh indicator が**徐々に展開** (回転 + opacity)
3. **100pt 達成**: Light Impact haptic、indicator 固定
4. **release**: scroll 元位置に戻る (250ms spring)、indicator は固定
5. **API**: 同期実行、終わったら indicator fade out

### 9.2 GEEK の GeekRefreshControl

GEEK は `GeekRefreshControl.tsx` 既実装。
audit 指摘: **feed で未配線** → P1 で配線する。

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §5 list-feed 行)

---

## 10. Type & Submit の体感

### 10.1 iOS Messages の送信時

1. **0ms**: send button tap
2. **0ms**: Medium Impact haptic
3. **0–80ms**: input field が**ふくらむ** (scale 1.05)
4. **80–150ms**: bubble が**右下から滑り出る** (Spring snappy)
5. **150ms**: send button が disabled (送信中) に変化
6. **API 完了**: bubble が定位置で settled、Light Impact haptic、success 表示

### 10.2 数値

```ts
const SUBMIT_INPUT_BLOOM = 1.05;        // input field の一時的拡大
const BUBBLE_SLIDE_SPRING = { duration: 0.25, dampingRatio: 0.85 };
const SUBMIT_HAPTIC = Medium;
const SUCCESS_HAPTIC = Light;
```

---

## 11. 「触らない方が良い」もの

Apple が意図的に**動かさない** ものを知ることも気持ちよさの一部:

- ❌ static text の hover でカラー変化 (web 慣習だが iOS では NG)
- ❌ scroll 中の連続 haptic (Selection 濫用)
- ❌ icon の永続的 wiggle (notification にだけ使う)
- ❌ tab 切替の elaborate transition (即時で良い)
- ❌ List item の border による分離 (separator は inset 16pt の hairline で十分)

→ **「動かさない美学」**。1 つ動かす毎に意味を背負わせる。

---

## 12. GEEK にどう活かすか

### 12.1 既に Apple 水準 (audit より)

✅ **PressableScale**: pressedScale 0.96、hitSlop 8、accessibility role 完備
✅ **DoubleTapHeart**: keyframes 5 段で IG 体感
✅ **TabBar morph**: SPRING_LIQUID で Liquid Glass 体感
✅ **Modal**: presentation 'modal' + gestureDirection 'vertical' + animationDuration 380 で iOS native 滑落

### 12.2 P1 — 「触感のレイヤリング」を強化

各 interaction に **scale + opacity + haptic + shadow + sound** の 3+ レイヤを確保:

| Interaction | 現状 layer | 追加すべき layer |
|---|---|---|
| Button tap | scale + haptic | + opacity 0.85 (現状 0.95–1.0) + shadow 縮み |
| List item tap | bg 切替 + 遷移 | + chevron scale 0.92 |
| Toggle | knob slide | + track color delay 50ms |
| Modal dismiss | swipe + spring | + opacity decay (250ms) |

### 12.3 P1 — Pull-to-Refresh を feed に配線

`GeekRefreshControl` (実装済) を `app/(tabs)/feed.tsx` の FlashList に:
```tsx
<FlashList
  refreshControl={<GeekRefreshControl onRefresh={refetch} />}
/>
```

### 12.4 P2 — Spatial Continuity (写真 lightbox)

ImageGrid → ImageLightbox の遷移を shared element transition で配線。
`react-native-shared-element` or `expo-image` の遷移 hook。

(→ [[Apple モーション — Spring・曲線・Reanimated 実装]] §8.6)

### 12.5 P2 — Settings 風 list item の chevron scale

settings 系 画面の list item を tap した時 chevron が 0.92 に縮む animation。

```tsx
// components/ui/SettingsRow.tsx (新規 or 改修)
const chevronScale = useSharedValue(1);
const onPressIn = () => { chevronScale.value = withTiming(0.92, { duration: 120 }); };
const onPressOut = () => { chevronScale.value = withSpring(1, SPRING.snappy); };
```

---

## 13. レイヤリングのチェックリスト

新規 interaction を入れる時に問う:

```
[ ] scale (transform: scale) があるか
[ ] opacity 変化があるか
[ ] haptic があるか
[ ] shadow / elevation の変化があるか
[ ] 色変化があるか
[ ] 200ms 以下で完結するか
[ ] release で spring が効くか (timing でなく)
[ ] dampingRatio 0.85+ で振動なしか (押し感は振動より静か)
[ ] reduceMotion 時は無効化されるか
```

3 つ以上 ✅ で「気持ちいい」基礎達成。5 つ以上で Apple 水準。

---

## 14. 数値ルールまとめ

| 項目 | 値 |
|---|---|
| Button press scale | 0.96–0.97 |
| Button press opacity | 0.85 |
| Press response | 80–150ms (attack) |
| Release spring | duration 0.2 / dampingRatio 0.85 |
| Scroll deceleration | 0.998 |
| Keyboard duration | 0.25s |
| Modal open | 380ms |
| Modal close | 220ms |
| Heart pop keyframes | [0, 1.3, 1.0, 1.15, 1.0, 0.9, 0] / 800ms |
| Pull-to-refresh threshold | 100pt |
| Toggle haptic | Selection |
| Like haptic | Light Impact (single) / Heavy Impact (double-tap) |

---

## 15. 出典

- **WWDC23/10158** "Animate with springs" — https://developer.apple.com/videos/play/wwdc2023/10158/
- **WWDC26/250** "Principles of Great Design" — https://developer.apple.com/videos/play/wwdc2026/250/
- **HIG Motion** — https://developer.apple.com/design/human-interface-guidelines/motion
- **HIG Feedback** — https://developer.apple.com/design/human-interface-guidelines/feedback
- (観察ベース) iOS Settings / Mail / Messages / Photos の実機体感分析

---

## 関連ノート

- [[Apple モーション — Spring・曲線・Reanimated 実装]] — Spring パラメータ
- [[Apple ハプティクス — Impact・Notification・Selection 使い分け]] — Haptic レイヤ
- [[Apple HIG 総論 — 二層原則 (WWDC17・WWDC26)]] — Delight 原則
- [[UI の滑らかさ — スクロール追従と画面遷移]] — Scroll 実装
- [[GEEK × Apple HIG 監査レポート 2026-06]] — 強み / Gap
