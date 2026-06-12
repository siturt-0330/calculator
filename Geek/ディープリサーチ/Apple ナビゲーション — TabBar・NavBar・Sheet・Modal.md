# Apple ナビゲーション — TabBar・NavBar・Sheet・Modal

> Apple のナビゲーションは **Wayfinding** 原則の実装。Tab Bar = 同階層の主要動線、Navigation Bar = 階層内移動、Sheet = 一時 task (medium/large detent + grabber)、Modal = 中断可能 task (dim + dismiss gesture)。**何をどこに置くか**が決まれば 80% 揃う。
> 出典: HIG Tab Bars、HIG Navigation Bars、HIG Sheets、WWDC25/356、WWDC25/219

---

## 1. 一文要約

> 同階層は **Tab**、階層移動は **NavBar**、一時 task は **Sheet** (引っ張れる)、中断可能な task は **Modal** (dimming + 全画面)。これに従えば iOS ユーザーが**学ばずに使える**。

---

## 2. Tab Bar — 同階層の主要動線

### 2.1 役割

- アプリの **メイン動線 3–5 個** を画面下端で常時可視化
- 全 tab は同階層 (兄弟関係)
- tab 内の階層移動は NavBar に任せる

### 2.2 数値ルール

| 項目 | 値 |
|---|---|
| 推奨 tab 数 | **3–5** (6 以上は More menu 化) |
| Tab Bar 高さ (iOS classic) | 49pt |
| Tab Bar 高さ (iPad classic) | 50pt |
| Tab icon サイズ | 25pt (SF Symbol Medium scale) |
| label 文字 size | 10pt (Caption) |
| 選択状態の表現 | tint color + filled SF Symbol |

### 2.3 iOS 26 — Floating Tab Bar (Liquid Glass)

iOS 26 で Apple は Mail / Music / Settings の Tab Bar を **floating + Liquid Glass** に変更。
- 浮かせ pill 配置 (画面下端に貼り付かない)
- Material 透過
- scroll で minimal にシュリンク (Apple 自身が採用するパターン)

→ GEEK の TabBar v5.1 はこれを**先取り**している ([[リキッドタブインジケーター完全ガイド]])。

### 2.4 React Native 実装 (基本)

```tsx
// expo-router (tabs)
<Tabs
  screenOptions={{
    headerShown: false,
    tabBarStyle: { backgroundColor: 'transparent', height: 64 },
  }}
  tabBar={(props) => <CustomTabBar {...props} />}
>
  <Tabs.Screen name="feed" options={{ title: 'Home' }} />
  <Tabs.Screen name="search" options={{ title: '検索' }} />
  <Tabs.Screen name="community" options={{ title: 'コミュ' }} />
  <Tabs.Screen name="mypage" options={{ title: 'マイ' }} />
</Tabs>
```

---

## 3. Navigation Bar — 階層内移動

### 3.1 役割

- 画面 title の表示
- back button (前画面名 or chevron)
- 右上 action (1–2 個まで)

### 3.2 Large Title ↔ Inline title

iOS 11 から **Large Title** が標準化。

- 画面 top: title が大きい (34pt Bold)
- scroll で縮小・上に移動して inline (17pt Semibold) に切替
- scroll edge appearance: 上端 transparent → scroll で Material 出現

### 3.3 React Native での再現

```tsx
// expo-router Stack
<Stack.Screen
  options={{
    title: '通知',
    headerLargeTitle: true,              // iOS only
    headerLargeTitleStyle: { fontSize: 34, fontWeight: '700' },
    headerTransparent: true,
    headerBackTitle: 'マイページ',         // back button の前画面名
  }}
/>
```

`headerLargeTitle: true` は iOS native (UINavigationBar) を経由する場合のみ機能。expo-router の JS Stack では手動実装が必要。

---

## 4. Sheet — 一時 task

### 4.1 役割

- **task を一時的に行う** UI (フォーム入力、選択、確認)
- task 完了で閉じる
- 背景 (元の画面) は残り続ける

### 4.2 数値ルール

| 項目 | 値 |
|---|---|
| Sheet 角丸 | **20pt** (corner radius) |
| Grabber | **36 × 5 pt** (上端 center) |
| Detent | **medium** (画面 50%) と **large** (画面 90%) の 2 段 |
| 背景 dim | medium 時 0.2、large 時 0.4 (推奨) |
| 開閉 spring | duration 0.4 / dampingRatio 0.8 |

### 4.3 Grabber は引っ張れる契約

**重要**: Grabber を見せたら、**下スワイプで滑落できる**ことが iOS の暗黙契約。

Grabber + Pan gesture をセットで実装しないと、ユーザーは「引っ張ろうとして反応がない」UX 違反に遭遇する。

### 4.4 React Native での再現

```tsx
// @gorhom/bottom-sheet (推奨)
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

<BottomSheet
  snapPoints={['50%', '90%']}             // medium / large detent
  enablePanDownToClose={true}              // 下スワイプで dismiss
  handleIndicatorStyle={{
    width: 36, height: 5,
    backgroundColor: C.text3,
  }}
  backgroundStyle={{ borderRadius: 20 }}   // 角丸 20pt
  backdropComponent={CustomBackdrop}       // dimming
>
  <BottomSheetView style={{ padding: 16 }}>
    {/* content */}
  </BottomSheetView>
</BottomSheet>
```

### 4.5 expo-router の native Modal sheet (iOS 26+)

iOS 26 で expo-router は `presentation: 'formSheet'` + sheet props をサポート:

```tsx
// app/_layout.tsx
<Stack.Screen
  name="post/create"
  options={{
    presentation: 'formSheet',
    sheetAllowedDetents: ['medium', 'large'],
    sheetGrabberVisible: true,
    sheetCornerRadius: 20,
    sheetExpandsWhenScrolledToEdge: true,
  }}
/>
```

→ iOS native の Sheet 挙動が完全に得られる。最高の選択肢。

---

## 5. Modal — 中断可能 task

### 5.1 役割

- **画面全体を占める** 一時 task
- 元のコンテキストから明確に切り離す
- 例: 投稿 composer、写真編集、設定 (full)

### 5.2 Sheet との違い

| | Sheet | Modal |
|---|---|---|
| 占有 | 部分 (medium / large) | 全画面 |
| 元画面 | 上に重ねる | dim or 隠す |
| 用途 | 短い task | 長い task |
| dismiss | grabber swipe | close button + swipe |
| 背景 | 透ける | dim |

### 5.3 iOS 13+ — Page Sheet (modal の中間形態)

iOS 13 から **modal は default で Page Sheet** (上端に少し前画面が見える)。Full screen を望むなら `modalPresentationStyle = .fullScreen` 明示。

### 5.4 React Native での再現

```tsx
// expo-router (iOS native presentation)
<Stack.Screen
  name="post/[id]"
  options={{
    presentation: 'modal',              // iOS Page Sheet
    gestureDirection: 'vertical',       // 下スワイプで dismiss
    animationDuration: 380,              // 滑落 spring 相当
  }}
/>

// Full screen (写真編集等)
<Stack.Screen
  name="photo-editor"
  options={{
    presentation: 'fullScreenModal',
    gestureEnabled: false,
  }}
/>
```

---

## 6. Toolbar — 補助 action 帯

### 6.1 役割

- 画面の補助 action (3–5 個)
- 画面下端 or NavBar 下に配置
- Sheet 内でも使用

### 6.2 iOS 26 — Material Toolbar

iOS 26 で Toolbar は Liquid Glass で再設計:
- 浮かせ Material 帯
- icon 中心 (SF Symbol Medium)
- label optional (long-press で tooltip)

---

## 7. 配置の原則 — 何をどこに置くか

### 7.1 黄金パターン

| 動線 | 配置 |
|---|---|
| アプリのメイン 3–5 機能 | **Tab Bar** (画面下端) |
| 現在画面の title | **NavBar 中央** |
| 戻る | **NavBar 左 (chevron + 前画面名)** |
| 主要 action (1–2 個) | **NavBar 右** |
| 投稿/作成等の primary action | **FAB** (右下) or NavBar 右 |
| 一時 task (フォーム) | **Sheet** |
| 中断可能 task (composer) | **Modal** (Page Sheet) |
| 補助 action (3–5 個) | **Toolbar** (画面下端 or NavBar 下) |
| 1 つの action の代替 | **Menu** (long-press or 「…」) |

### 7.2 反パターン

- ❌ Tab に 6 個以上 → More menu に
- ❌ NavBar 右に 3 個以上 → 「…」menu に
- ❌ Sheet の中に Sheet → glass-on-glass 禁止、modal に
- ❌ Modal を tap-outside で閉じる → ユーザーが入力を失う、Cancel ボタン必須

---

## 8. GEEK にどう活かすか

### 8.1 強み (audit より)

✅ **Tab Bar (Liquid Glass v3)**: iOS 26 floating pill を先取り、3 + FAB 構成、`useSafeAreaInsets().bottom + 12` で home indicator 回避
✅ **Route-level modal**: `post/[id]` / `bbs/[id]` で `presentation:'modal'` + `gestureDirection:'vertical'` + `animationDuration:380` で iOS native 滑落 dismiss
✅ **TopBar (NavBar)**: iOS `systemUltraThinMaterialDark/Light` + Web `backdrop-filter` の scroll edge appearance

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §2.1, §2.3, §2.4)

### 8.2 P0 — Sheet 10 箇所で grabber を見せて引っ張れない

**現状**: `TagPickerSheet` `VisibilitySheet` `CommunityPickerSheet` `PollEditorSheet` `ContentWarningSheet` `ReportSheet` `PostAuthorSheet` `ReactionListSheet` `MemeReactionPicker` `ActionSheetModal` で grabber 36×4 を描画しているが、`PanGestureHandler` / `Gesture.Pan` が **sheet 系で 0 件**。**閉じる手段は backdrop tap のみ**。

iOS の暗黙契約違反 → ユーザーは「引っ張ろうとして反応がない」フラストレーション。

**改善案**:
- `components/ui/BottomSheet.tsx` (孤児) を再活性化、`@gorhom/bottom-sheet` の薄いラッパに
- 手組み 10 箇所を順次 `Sheet` primitive に置換
- `enablePanDownToClose: true` を default ON

**Phase 1**: 最頻 2 箇所 (`TagPickerSheet`, `VisibilitySheet`) を先行移行
**Phase 2**: 残り 8 箇所

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §3 P0-2)

### 8.3 P0 — ReactionListSheet だけ grabber 不在 + scrim 直書き

`components/feed/ReactionListSheet.tsx:35` で `backgroundColor: 'rgba(0,0,0,0.7)'` 直書き、L1-106 全行に grabber 描画 View 不在。

**修正**: paddingTop に grabber View 挿入 + scrim を `C.scrim` token に置換。

(→ [[GEEK × Apple HIG 監査レポート 2026-06]] §3 P0-3)

### 8.4 P1 — Route-level modal を formSheet detent 化

`image-cropper` / `photo-editor` / `filter/index` に:
```tsx
options={{
  presentation: 'formSheet',
  sheetAllowedDetents: ['medium', 'large'],
  sheetGrabberVisible: true,
  sheetCornerRadius: 20,
}}
```

iOS 26+ で native sheet detent 挙動を獲得。

### 8.5 P1 — Backdrop dim 値を detent 連動 token に

scrim 4 種 hardcode を `C.scrimMedium` (0.2) / `C.scrimLarge` (0.4) に整理。

### 8.6 P1 — TopBar の reduceMotion 透明維持失敗

現状 `large` プロパティ実渡し 0 件 (dead)、reduceMotion で常時 opaque。
修正: reduceMotion 時も上端 transparent を維持し、scroll で Material 出現する挙動を保持。

### 8.7 P1 — List/Feed に Large Title + swipe actions

- Large Title 配線 (`headerLargeTitle: true` 検証 / scroll edge appearance)
- swipe actions 0 → 削除/ブロックを swipe 操作で
- separator inset (現状 0 を 16pt に)

### 8.8 P2 — ConfirmDialog を iOS 横並び化

ボタン配置を `flexDirection:'row'`、cancel **左** / confirm **右**。
destructive 時は confirm を bold。

### 8.9 触らないことを決める (温存)

- **TabBar 隣の投稿 FAB**: HIG 想定外だが「投稿」の独立動線価値が大きい → 温存
- **TabBar scroll hide ball morph**: HIG 標準は常時表示だが、ball tap が scroll-to-top + 展開を同時発火するため semantics は HIG と揃う → 温存

---

## 9. 数値ルールまとめ

| 項目 | 値 |
|---|---|
| Tab 数 | 3–5 |
| Tab icon サイズ | 25pt |
| NavBar back chevron | 17pt SF Symbol |
| Large Title | 34pt Bold |
| Inline Title | 17pt Semibold |
| Sheet 角丸 | 20pt |
| Sheet detent | medium 50% / large 90% |
| Grabber | 36 × 5 pt |
| Modal animation | 380ms / spring duration 0.4 dampingRatio 0.8 |
| Tab Bar 高さ (classic) | 49pt |
| Tab Bar 高さ (Liquid Glass pill) | 60pt + safeArea bottom + 12 |

---

## 10. 出典

- **HIG Tab Bars** — https://developer.apple.com/design/human-interface-guidelines/tab-bars
- **HIG Navigation and Search** — https://developer.apple.com/design/human-interface-guidelines/navigation-and-search
- **HIG Sheets** — https://developer.apple.com/design/human-interface-guidelines/sheets
- **HIG Modality** — https://developer.apple.com/design/human-interface-guidelines/modality
- **HIG Toolbars** — https://developer.apple.com/design/human-interface-guidelines/toolbars
- **WWDC25/356** — https://developer.apple.com/videos/play/wwdc2025/356/
- **WWDC25/219** — https://developer.apple.com/videos/play/wwdc2025/219/

---

## 関連ノート

- [[Apple Liquid Glass 設計言語]] — Material が動く層を形成
- [[Apple モーション — Spring・曲線・Reanimated 実装]] — modal/sheet の spring
- [[リキッドタブインジケーター完全ガイド]] — TabBar v5.1 実装
- [[GEEK × Apple HIG 監査レポート 2026-06]] — nav 全領域監査結果
