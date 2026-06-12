# GEEK × Apple HIG 監査レポート 2026-06

> 14 領域での gap 分析 + 敵対的検証 (verify) による P0 指摘の事実関係チェック。**GEEK v4 は Apple HIG 8 合目相当**。verify で 5 件の真の P0 が残った。
> 監査日: 2026-06-12 / 監査エージェント数: 30 / 投下 token: 2.5M / 監査範囲: 14 領域 (color-system / typography / spacing-radius / shadow-material / motion-spring / tab-bar / nav-bar-header / list-feed / button-touch / modal-sheet / empty-error / haptics / a11y / icons)

---

## 1. 全体評価

GEEK v4 の現状は **「Apple HIG 8 合目」相当**。

- ✅ Liquid Glass TabBar、`systemUltraThinMaterial` TopBar、semantic tokens (`C.*` / `T.*` / `SP.*`)、44pt 鉄則の `PressableScale`、iOS native modal `presentation:'modal'` + `gestureDirection:'vertical'`、FlashList 60fps lock — **iOS 26 流の意匠を選択的に先取り** している部分は HIG 想定を超える水準。
- ⚠️ HIG の真の核心である **「semantic を一本化し、全画面が同じ語彙で動く」** という設計規律は未完成。14 領域中 **9 領域で「並列実装の二重・三重定義」** が共通の症状 (haptic API 3 系統 / sheet 実装 3 系統 / empty state 6 系統 / motion token 2 系統 / shadow token 2 系統 / icon-symbol dead MAPPING など)。

致命 (P0) 判定で残ったのは **5 件のみ** — verify ラウンドで多くの「P0」指摘が partial / refuted に降格 (toggle hitSlop / album tint / Alert.alert 全消し は既対応 or 誤計算)。

→ **ここから Apple 水準まで詰めるのは「新規実装」ではなく「並列実装の収束」の作業**。1〜2 ヶ月の token 整理 + lint enforcement で **9.5 合目** まで届く距離にある。

---

## 2. 強み (Already Apple-grade)

### 2.1 TabBar (Liquid Glass pill) — iOS 26 を先取り
- 浮かせ pill (`PILL_HEIGHT=60`, `PILL_RADIUS=30` = full capsule) + `useSafeAreaInsets().bottom + 12` で home indicator 確実回避
- `BlurView intensity=36` + dark/light tint 動的切替 + sheen (上端 white gradient) + rim light で iOS 26 Liquid Glass 系の質感を再現
- scroll-driven morph (ball ↔ pill) で reduceMotion 対応済
- `accessibilityElementsHidden` + `importantForAccessibility` で collapsed 時の VoiceOver 沈黙まで設計済
- 根拠: `components/nav/TabBar.tsx:65-180, 378-380, 498-499, 539-541`

参考: [[Apple Liquid Glass 設計言語]] §3 / [[リキッドタブインジケーター完全ガイド]]

### 2.2 PressableScale — 44pt 鉄則の構造的担保
- `hitSlop ?? 8` の既定値で **48×28 の Toggle ですら実効 64×44 に到達** する設計 (verify で発見)
- `accessibilityRole='button'` fallback + `accessibilityState.disabled` + `delayPressIn=0` + web `WebkitTapHighlightColor:'transparent'` で a11y/web の地雷を 1 ファイルで吸う
- 根拠: `components/ui/PressableScale.tsx:36-119` (特に L84 の `hitSlop ?? 8`)

参考: [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] §3.1

### 2.3 Route-level modal の gestureDirection + animationDuration
- `post/[id]` / `bbs/[id]` で `presentation:'modal'` + `animationDuration:380` + `gestureDirection:'vertical'` で iOS native 滑落 dismiss を獲得
- 根拠: `app/_layout.tsx:746-853`

参考: [[Apple ナビゲーション — TabBar・NavBar・Sheet・Modal]] §5

### 2.4 TopBar の scroll edge appearance
- iOS は `systemUltraThinMaterialDark/Light` + intensity 80、Web は `backdrop-filter: blur(30px) saturate(180%)` で iOS 純正 navigation bar の質感を片方ずつ最適パスで実装
- `aBackdrop` opacity 0→1 / `aHairline` 30→60 で「上端で透明 → スクロールで opaque」を再現
- 根拠: `components/nav/TopBar.tsx:96-122, 131-184`

### 2.5 Spacing トークン (`SP`) の規律
- 4pt grid 厳格遵守 (0/4/8/12/16/20/24/28/32/40/48/64/80/96)
- 509 件の padding 系のうち 264 件 (**52%**) は `SP[]` 経由
- フィードの主要動線 (`AnonPostCard.tsx:899-901` の H16/V12) では揃っている
- 根拠: `design/tokens.ts:142-157`

参考: [[Apple スペーシング・角丸 — 4pt Grid と Concentric Shapes]] §2

### 2.6 ReactionButton の hit-target 明示
- `minHeight: 44 / minWidth: 44 / hitSlop=10` を素の Pressable に直書きで **設計意図を明示**
- HIG の 44×44 鉄則を「コメントなしで読める」コード
- 根拠: `components/post/PostCardActions.tsx:73-80, 386-389, 506-580` (Like/Comment/Quote/Reaction/Share/Save 全てに動的 `accessibilityLabel`)

---

## 3. クリティカル Gap (P0)

verify ラウンドで **real** 判定が残ったもののみ。partial / refuted は P1/P2 に降格して §4–5 で扱う。

### P0-1. ErrorBoundary が `error.message` を生で表示

**領域**: empty-error
**現状値**: `components/ui/ErrorBoundary.tsx:72-74`
```tsx
<Text style={[T.caption, ...]}>{this.state.error.message}</Text>
```

本番 build で英文 stack / Supabase エラー / "Network request failed" がユーザーに直接露出。`__DEV__` gate なし。

**理想値** (HIG "Alerts"): 「明確な原因 + 解決策」を平易な日本語で。技術詳細は dev 限定。

**改善案**: caption Text を `{__DEV__ && (...)}` で囲み、本番は「もう一度お試しいただくか、解消しない場合はお問い合わせからご連絡ください」に固定文言化

**工数**: **S** (1 ファイル / 5 行)

参考: [[Apple オンボーディング・空状態・エラー・権限ダイアログ]] §4.4

### P0-2. Sheet 10 箇所で「grabber を見せて引っ張れない」

**領域**: modal-sheet
**現状値**: `TagPickerSheet` `VisibilitySheet` `CommunityPickerSheet` `PollEditorSheet` `ContentWarningSheet` `ReportSheet` `PostAuthorSheet` `ReactionListSheet` `MemeReactionPicker` `ActionSheetModal` で grabber 36×4 を描画しているが、`PanGestureHandler` / `Gesture.Pan` の grep 結果が **sheet 系で 0 件**。**閉じる手段は `<Pressable>` backdrop tap のみ**。

**理想値** (HIG "Sheets"): grabber を出している sheet は下スワイプで滑落可能・慣性 + rubber-band あり。`@gorhom/bottom-sheet` の `BottomSheetModalProvider` は `app/_layout.tsx:102, 713, 893` で既に root に配線済。

**改善案**: 自社ラッパ `components/ui/BottomSheet.tsx` (孤児) を主軸に統合し、手組み 10 箇所を順次 `Sheet` primitive に置換。`enablePanDownToClose` を default ON

**工数**: **L** (primitive 設計 + 10 ファイル移行)

**注**: 「孤児」は `BottomSheet.tsx` ラッパ単位の話 — `@gorhom/bottom-sheet` ライブラリ自体は Provider 配線済で活きている

参考: [[Apple ナビゲーション — TabBar・NavBar・Sheet・Modal]] §4.3

### P0-3. ReactionListSheet だけ grabber 不在 + scrim 直書き

**領域**: modal-sheet
**現状値**: `components/feed/ReactionListSheet.tsx:35` `backgroundColor: 'rgba(0,0,0,0.7)'` 直書き + L1-106 全行に grabber 描画 View 不在

**理想値**: 他 9 シートと同じ 36×5 grabber + `C.scrim` token 参照

**改善案**: paddingTop に grabber View 挿入 + scrim を `C.scrim` に置換

**工数**: **S** (1 ファイル / 5 行)

### P0-4. Dark theme の text4 が WCAG 大幅違反

**領域**: a11y / color-system
**現状値**: `lib/theme/palettes.ts:101` `text4:'#52525b'` on `bg:'#0a0a0a'` のコントラスト比 ≈ **2.64:1** (WCAG AA 4.5 / large text 3.0 すら未満)。text3 `#71717a` も dark で ≈ **4.13:1** (AA 4.5 未満)。33 ファイル / 82 件で `text3/text4` を caption 用途で使用。

**理想値** (WCAG AA): 本文 4.5:1 以上、large text 3:1 以上。Apple HIG は AAA 7:1 推奨。

**改善案**: `text3: '#71717a' → '#9CA3AF'` (4.93:1)、`text4: '#52525b' → '#7B7E8A'` (3.42:1、large/icon 用途に限定)。同時に `tokens.ts:32-33` の `_C` 同期と、`tests/unit/` に WCAG コントラスト assert を追加

**工数**: **S** (palette 2 行 + test 1 本)

**注**: light theme の text3 (#71717a on #fff) は ≈ 4.79:1 で AA 合格、修正不要

参考: [[Apple カラーシステム — System Colors と Vibrancy]] §8.2 / [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]] §9.2

### P0-5. OS Reduce Motion を購読していない

**領域**: a11y / motion-spring
**現状値**: `hooks/useReducedMotion.ts:1-5` は `useSettingsStore((s) => s.reduceMotion)` のみで、`UIAccessibility.isReduceMotionEnabled` / `prefers-reduced-motion` / Android transition scale を読まない。`TabBar` / `IntroAnimation` / `TabIcon` の 3 ファイルだけは reanimated `useReducedMotion()` を併用しているが、それ以外のアニメ箇所は OS 設定を無視

**理想値** (Apple HIG Accessibility): OS の Reduce Motion は常時購読し、アプリ内トグルとは OR で評価

**改善案**: `hooks/useReducedMotion.ts` を以下に差し替え:
```tsx
import { useReducedMotion as useRNReducedMotion } from 'react-native-reanimated';
import { useSettingsStore } from '../stores/settingsStore';

export function useReducedMotion(): boolean {
  return useSettingsStore((s) => s.reduceMotion) || useRNReducedMotion();
}
```
既存 import 38 ファイルは変更不要。

**工数**: **S** (1 ファイル)

参考: [[Apple モーション — Spring・曲線・Reanimated 実装]] §8.5 / [[Apple Liquid Glass 設計言語]] §4

---

## 4. 段階的ロードマップ

### Phase 1 — 今すぐ (P0 解消、1〜2 週、工数合計 S+S+S+S+M ≈ 1 人 2 週)

| # | タスク | 領域 | 工数 |
|---|---|---|---|
| 1 | ErrorBoundary の raw error を `__DEV__` gate | empty-error | S |
| 2 | ReactionListSheet に grabber 追加 + scrim を `C.scrim` token に | modal-sheet | S |
| 3 | dark `text3/text4` を `#9CA3AF` / `#7B7E8A` に格上げ + WCAG test 追加 | a11y/color | S |
| 4 | `useReducedMotion` を OS 値と OR 結合 | a11y/motion | S |
| 5 | `Sheet` primitive (`@gorhom/bottom-sheet` ラッパ) を新設 + 最も触られる `TagPickerSheet` / `VisibilitySheet` の 2 ファイルだけ先行移行 | modal-sheet | M |

**Phase 1 完了で「Apple HIG 致命違反ゼロ」ライン到達。**

### Phase 2 — 中期 (P1、1〜2 ヶ月)

#### 2-1. Token 整理 (並列実装の収束)

- **Haptic API 統一**: `lib/haptics.ts` を SoT にし `design/haptics.ts` / `hooks/useHaptic.ts` / `PolishedButton` 内製 `triggerHaptic` を re-export か削除。`pop` の Heavy vs Medium 食い違いをここで解消 (**Heavy 固定推奨** — DoubleTapHeart の IG 風 double-tap 体験を維持)
- **Shadow token 二重定義の解消**: `tokens.ts` の `SHADOW` を `shadows.ts` の re-export に変換。Toast/ConfirmDialog/ReasonPickerDialog の 3 ファイルだけ `shadows.ts` 経由なのを `tokens.ts` 経由に揃える
- **Motion API 統一**: `lib/animations.ts` の `SPRING_PRESETS` を `design/motion.ts` の re-export に。同名 `snappy` で別物理が返る split-brain を解消
- **Inline spring 11 箇所を token 参照に**: Avatar / admin / post[id] / FeedbackFAB / SortTabs / ScopeToggle / VisibilityPicker / PostComposerSheet / ToastHost / HomeDrawer / TabBar
- **Empty state 6 系統 → 2 系統 (汎用 + Editorial)**: `PolishedEmpty` (BBS) / `CommunityPolishedEmpty` を `EmptyState` に統合、`tone` prop dead 化を解消 (案 A: tone→gradient mapping を生かす / 案 B: prop を削除)

#### 2-2. Modal-Sheet 完成

- 残り 8 シートを `Sheet` primitive に移行 (Phase 1 で 2 ファイル済み)
- Route-level modal を formSheet detent 化: `image-cropper` / `photo-editor` / `filter/index` に `sheetAllowedDetents:['medium','large']` + `sheetGrabberVisible:true` + `sheetCornerRadius:20` を追加
- Backdrop dim 値を detent 連動の token (`C.scrimMedium` 0.2 / `C.scrimLarge` 0.4) に整理し、4 種の rgba 直書きを置換

#### 2-3. iOS Symbol 統合 (icons P1)

- `constants/icons.ts` を拡張し各 alias に `{ sf, sfFill, lucide }` の 3 値持たせる
- `components/ui/UIIcon.tsx` で `Platform.OS === 'ios' ? <SymbolView> : <LucideIcon>` 出し分け
- TabIcon の active 状態を SF Symbol filled variant (`house.fill`) に切替 — HIG 標準の selected 表現を獲得
- 並行して `STROKE = { regular:2, medium:2.4, bold:2.8 }` token 化 + codemod で `2.2/2.6/3.0` を 3 段に丸め

#### 2-4. a11y 強化

- `tests/unit/` に WCAG コントラスト lock test を追加 (P0-4 と同時)
- VoiceOver header navigation 用に `<HeadingText level={1|2|3}>` helper を作り `T.h1/h2/h3` 使用箇所 ~30 を段階移行
- `Toggle` 呼出元から `accessibilityLabel`/`Hint` を必須化 (PressableScale 既定 hitSlop で 44pt は既に確保済 — verify で確認)
- Permission 拒否後の `Linking.openSettings()` deep link を `settings/notifications.tsx` + `PushNotificationToggle.tsx` に追加 (HIG "Requesting Permission")

#### 2-5. ConfirmDialog を iOS 横並び化

- ボタン配置を `flexDirection:'row'`、cancel **左** / confirm **右** に。destructive 時のみ confirm を bold
- 横並びは iOS 標準の 2 ボタン配置、3 つ以上は縦並びフォールバック

### Phase 3 — 長期 (P2、機を見て)

#### 3-1. Material 4 段スケール導入

- `design/materials.ts` に `ultraThin/thin/regular/thick` を定義し、現状散在する intensity 4 値 (20/30/36/40/80) を意味で揃える
- `ActionSheet` / `ConfirmDialog` を `regularMaterial` 化、現在の `C.bg2` フラットから脱却
- `useReduceTransparency` hook を作り、Material wrapper 内で OS 設定に応じて不透明 fallback

#### 3-2. Dynamic Type 部分対応

- `AppText` wrapper を新設し本文系 (`body/bodyM/bodyB/h1-h4`) に `maxFontSizeMultiplier={1.6}` を default 適用
- numeric counter 等の broken layout 候補は `allowFontScaling={false}` で固定
- `FlashList` の `estimatedItemSize` 連動再計測必須 (smoothness lock test と整合させる)

#### 3-3. 9pt 撲滅 + lint

- `AdCard.tsx:105` / `CommentThreadItem.tsx:453,494,522` / `DiscoverPhotoGrid.tsx:200-223` / `TagRelations.tsx:88,92` 等の `fontSize:9` を 11pt (`T.caption`) に底上げ
- ESLint `no-restricted-syntax` で `Property[key.name='fontSize'] > Literal[value<11]` を warn 化、再発防止

#### 3-4. HIG-compliant Text style 追加 (typography P1)

- `T` に `largeTitle 34 / title1 28 / title2 22 / title3 20 / headline 17S / bodyHig 17 / callout 16 / subhead 15 / footnote 13 / caption1 12 / caption2 11` を alias として並列追加
- 既存 alias は残しつつ、新規 component は HIG 名を使う規律

#### 3-5. R token 4 倍数化 + Button radius 統一

- `R = { sm:8, md:12, lg:16, xl:20, 2xl:24, 3xl:32 }` に再設計、旧 6/10/14 は alias 残置
- `Button.tsx:58 RADIUS=12` と `PolishedButton.tsx:118 R.lg=14` を新 `R.md=12` に一本化
- 313 件のハードコード radius (13/17/19/22/23/30) を codemod で R token に丸める

#### 3-6. Web focus-visible + Accent dark/light identity

- グローバル CSS に `:focus-visible { outline: 2px solid #7C6AF7; outline-offset: 2px; }` を inject
- light palette の accent `#3E6DA3` (青) を `#5D4FD1` (紫の light variant) に振り、起動スプラッシュとブランド断絶を解消

---

## 5. 領域別マトリクス

| 領域 | 現状 | Apple HIG 理想 | 主な Gap | 優先度 |
|---|---|---|---|---|
| **color-system** | semantic token `C.*` 整備済、`palettes.ts` で dark/light 二分。BlurCard tint="dark" ハードコード (dead component) | PlatformColor / DynamicColorIOS + alpha-based labels (`secondaryLabel` 0.60α 等) | dark text4 WCAG 違反、systemMaterial 採用 3 箇所のみ | **P0** (text4) / P1 (Vibrancy hierarchy) |
| **typography** | `T` に 17 種、本文 `body=15/22`、Headline 17S 欠落、9pt 散発 | iOS Text Styles 11 種、Body 17pt、Dynamic Type、11pt 下限 | Dynamic Type 0 対応、9pt 30+ 箇所、トークン使用率 30/130 file | P1 (Dynamic Type) / P2 (9pt lint) |
| **spacing-radius** | SP は 4pt grid 厳格 (52% 利用)、R は 6/10/14/20/28/36 の奇数寄りスケール | 4pt grid + iOS standard radius (8/12/16/20) | R が奇数値、Button radius 12 vs PolishedButton 14 の split、313 件 hardcode radius | P1 (R 再設計) / P2 (codemod) |
| **shadow-material** | SHADOW 5 段、BlurView intensity 4 値混在、ActionSheet/Dialog はフラット | 4 段 Material (ultraThin/thin/regular/thick) + Vibrancy + Reduce Transparency 対応 | Material token 欠落、tokens.ts/shadows.ts 二重定義、intensity 規約なし | P1 (整理) / P2 (Material 化) |
| **motion-spring** | physics 系 (damping/stiffness/mass) 5 token + perceptual `SPRING_LIQUID` の混在、inline spring 11 箇所、lib/animations.ts と design/motion.ts で `snappy` 別物 | perceptual API (`response`/`dampingFraction`) 統一、Apple bounce 区分 (Smooth/Flowy/Snappy/Bouncy) | physics 値そのものは under-damped で問題なし (verify で誤計算判明)、構造的に並立 | P1 (token 統合・inline 廃止) |
| **tab-bar** | Liquid Glass pill 60pt + scroll morph、a11y role=tab + state.selected | iOS 26 floating tab bar + accessibilityLabel + 25pt SF Symbols | 個別 tab の `accessibilityLabel` 欠落、design/tabbar.ts と TabBar.tsx の二重定義 (height 64 dead) | **P0 該当なし** / P1 (a11y label + token 統一) |
| **nav-bar-header** | `large` プロパティ実渡し 0 件 (dead)、inline title 左寄せ、reduceMotion で常時 opaque | Large Title + scroll collapse、inline title center、Material vibrancy、戻る + 前画面名 | reduceMotion で透明維持失敗、large 機能 dead、`SIZE.topBarLarge=96` dead | P0 (reduceMotion 透明) / P1 (large title 配線) |
| **list-feed** | FlashList 1 column、フラット行 + hairline divider、X/Threads 風 | Inset Grouped + leading-inset separator + Large Title + swipe actions + `UIActivityViewController` | swipe actions 0、Large Title 未配線、separator inset 0、`GeekRefreshControl` 既実装だが feed 未配線 | P1 (Large Title + swipe + separator inset) |
| **button-touch** | PressableScale (0.96) / Button (0.97) / PolishedButton (scale なし) の 3 系統、a11y label/role/state 完備、PressableScale `hitSlop ?? 8` で 44pt 構造的担保 | 0.95-0.97 scale + 44pt min + selection/impact/notification の使い分け + onPress haptic | haptic API 3 並立、`pop`=Heavy vs Medium 食い違い (実害は dead route)、PolishedButton scale なし | P1 (haptic 統一・PolishedButton scale) |
| **modal-sheet** | RN `Modal + Reanimated SlideInDown` 手組み 10 箇所、`@gorhom/bottom-sheet` Provider は配線済だがラッパ孤児 | medium/large detent + grabber 36×5 + 下スワイプ滑落 + detent 連動 dim | **grabber を見せて引っ張れない** 10 箇所、ReactionListSheet だけ grabber 不在、scrim 4 種 hardcode | **P0** (grabber + 統合) |
| **empty-error** | EmptyState (96×96 gradient halo) / ErrorState / ErrorBoundary / PolishedEmpty (BBS) / CommunityPolishedEmpty / EditorialEmpty の 6 系統、ConfirmDialog 縦並び、ErrorBoundary が raw error.message 露出 | 中立な装飾 + 1 CTA、平易な日本語、Settings deep link、横並び 2 ボタン | **raw error.message 本番露出**、EmptyState の `tone` prop dead、permission denial 後の救済 UI なし、4 系統並立 | **P0** (ErrorBoundary) / P1 (tone 整理・deep link) |
| **haptics** | `lib/haptics.ts` (semantic) / `design/haptics.ts` (hap) / `hooks/useHaptic.ts` の 3 系統、`pop` が Heavy vs Medium で食い違い | Selection/Impact/Notification の HIG 区分、System Haptics OFF 尊重、reduce-haptics 設定 | 3 並立、`pop` の split-brain (ただし片方 dead route で実害ゼロ)、reduceHaptics 設定なし、直叩き 3 箇所 (PolishedButton/AnonPostCard/AlbumPhotoGrid) | P1 (統合 + reduceHaptics) |
| **a11y** | a11y label/role/state 普及 ~135 ファイル、PressableScale 既定 hitSlop で 44pt 担保、reduceMotion は設定 store のみ | OS Reduce Motion 購読、Dynamic Type、WCAG AA、VoiceOver header nav | **OS Reduce Motion 未連携**、**dark text4 WCAG 違反**、Dynamic Type 0、`accessibilityLanguage` 0 | **P0** (text4 + ReduceMotion) / P1 (Dynamic Type + Settings deep link) |
| **icons** | lucide-react-native 単独、`SIZE.icon*` 4 段定義あるが Icon prop 利用 2 件、size 30 種・strokeWidth 13 種混在 | SF Symbols 優先 + scale 3 段 + weight 6 段 + filled variant selected state | SF Symbols dead MAPPING (4 個)、size/stroke 散乱、TabIcon の active は accent 色 crossfade のみ (filled なし) | P1 (UIIcon Facade + SF) / P2 (size/stroke 正規化) |

凡例: **P0** = verify で real 判定された致命 / P1 = HIG 準拠の質 / P2 = polish

---

## 6. 次の行動

### 6-1. 監査の継続運用

- **lock test 化**: Phase 1 で text4 コントラスト、Phase 2 で sheet grabber 寸法 / scrim token / detent 設定 / haptic 強度 を `tests/unit/*Lock.test.ts` で固定 (smoothnessLock.test.ts と同方針)
- **lint 化**: ESLint custom rule で「`fontSize` 数値リテラル禁止 (`T.*` 経由のみ)」「`color="#fff"` 禁止 (`C.onAccent` 経由)」「`Icon size={数値}` 禁止 (`SIZE.icon*` 経由)」を warn 化
- **再監査タイミング**: Phase 1 完了直後 / Phase 2 中盤 (token 整理後) / iOS 27 リリース時 (Liquid Glass の仕様変更追従)

### 6-2. 「触らないことを決める」リスト

監査で「HIG と違うが GEEK では正しい」と判断したものを **温存** する明示リスト:

- **TabBar の floating Liquid Glass pill**: HIG の常時表示原則とは違うが iOS 26 流先取りとして容認
- **Geek wordmark の skew/glow/gradient**: HIG 純正 navigation bar にはない「ブランドの遊び」 — 起動 splash の紫グラデと連続するブランド identity として温存
- **TabBar 隣の投稿 FAB**: HIG 想定外 (FAB は Material) だが pill と独立した「投稿」の動線価値が大きいので保持
- **scroll hide ball morph**: HIG 標準は常時表示だが、reduceMotion 対応済 + ball tap が scroll-to-top + 展開を同時発火するため semantics は HIG と揃っている — デザイン選択として継続
- **EditorialEmpty (検索結果ゼロ)**: HIG 装飾控えめ原則と Editorial の主張的タイポグラフィの中間 — 検索という限定コンテキストでの選択として温存

---

## 7. 付録: 監査で「P0 と思ったが verify で降格した」候補一覧

verify ラウンドで partial / refuted に降格した「過大評価された P0」を記録 — 同じ過ちを次回しないため。

| 候補 | 当初 P0 主張 | verify 判定 | 真の原因 |
|---|---|---|---|
| BlurCard `tint="dark"` | light で「中だけ黒いカード」 | partial | BlurCard 自体が dead component (import 0)、album/[id]:549 は L535 で web/light フォールバック済 |
| Light text3 が WCAG 違反 | 「4.0:1 で AA 不適合」 | partial | 実測 4.79:1 で **light は AA 合格**、dark text4 だけが真の P0 |
| expo-blur tint 統一 | dark/light 直書き | partial | TabBar は `isDark ? 'dark' : 'light'` 動的分岐済、album:373 はそもそも自前 CoverChip の prop で BlurView ではない |
| SPRING_* が over-damped | ζ=1.34/1.74/1.20 | **refuted** | 物理計算誤り (`c/(2√km)` の √内を `k/m` で計算)、正しくは ζ≈0.67/0.87/0.60 で **under-damped** |
| Shadow tokens の Android elevation drop | tokens.ts は Platform 非対応 | partial | tokens.ts L204+ で `elevation: 6` 等を直書きしており Android で確実に効く |
| Alert.alert 全消し未完 | 残存を grep して数 file 置換 | **refuted** | 実呼び出し 0 件、grep hit は全て「旧→新」置換済みコメント |
| Toggle が 44pt 未満 | 48×28 で HIG 違反 | **refuted** | PressableScale の `hitSlop ?? 8` 既定で実効 64×44 で合格 |
| AnonPostCard の VO label 欠落 | 主要 4 箇所のみ | largely refuted | Like/Comment/Save/Share/Quote/Reaction/メニュー/コミュ名 すべて動的 label 完備 |
| `pop` Heavy vs Medium 体験破綻 | 経路で振動量が割れる | partial | `haptic('pop')` 経路は dead route、実コードは `hap.pop` だけ使用で体験上の食い違いゼロ |
| haptic-tab.tsx と nav/HapticTab.tsx 二重 | 機能重複 | partial | lowercase 版は import 0 の完全孤立 dead file、削除 only |
| TabBar P0 致命 | (なし) | (なし) | レポート自身が「P0 — 無し」と明記 → 正しかった |

**学び**: 次回監査では (1) 物理パラメータは手計算で再検証、(2) Platform.OS フォールバック分岐を必ず追跡、(3) grep 0 件の「孤児」と「dead route」を区別、(4) `hitSlop ?? 8` 等の既定値を見落とさない — を徹底する。

---

## 8. 関連ノート

- [[MOC — Apple HIG 完全ガイド]]
- [[Apple HIG 総論 — 二層原則 (WWDC17・WWDC26)]]
- [[Apple Liquid Glass 設計言語]]
- [[Apple Typography — SF Pro と Dynamic Type]]
- [[Apple カラーシステム — System Colors と Vibrancy]]
- [[Apple スペーシング・角丸 — 4pt Grid と Concentric Shapes]]
- [[Apple モーション — Spring・曲線・Reanimated 実装]]
- [[Apple ハプティクス — Impact・Notification・Selection 使い分け]]
- [[Apple タッチターゲット・アクセシビリティ — App Review 合否ライン]]
- [[Apple ナビゲーション — TabBar・NavBar・Sheet・Modal]]
- [[Apple SF Symbols とアイコン設計]]
- [[Apple オンボーディング・空状態・エラー・権限ダイアログ]]
- [[Apple 「気持ちいい」微差 — 細部の interaction]]

---

## 9. 改訂

- **2026-06-12 初版** — workflow `geek-ui-audit-for-apple` (30 agents / 2.5M tokens / 14 領域 / verify by adversarial 3-vote) の synthesize 結果をノート化
