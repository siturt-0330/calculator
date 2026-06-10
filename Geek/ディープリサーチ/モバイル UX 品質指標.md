---
tags: [research, モバイルUX, パフォーマンス, アクセシビリティ, 品質指標]
---

# モバイル UX 品質指標

「速い／滑らか／落ちない／使える」を **計測可能な数値** に落とし込むためのノート。体感品質は主観だが、しきい値を決めて p75/p95 で監視すれば回帰を検知できる。Web 由来の Core Web Vitals、ネイティブ (Android/iOS) の vitals、React Native 固有のスレッドモデルを統合し、最後に Geek (geek-v4) の実装に紐付ける。

関連: [[パフォーマンス最適化]] / [[React Native・Expo パフォーマンス最適化]] / [[モバイル UX 品質指標]](本ノート) / [[i18n・テーマ・デザインシステム]] / [[画像・メディアパイプライン]] / [[地雷・落とし穴 総覧]] / [[運用 — デプロイ・プレビュー・本番反映確認]]

---

## 定義・原則

### 大原則: 「平均 FPS」ではなく「悪いフレーム」を見る

ユーザは平均 60fps を感じない。**たまに来る一発のジャンク**を感じる。120fps で回っていても 1 スクロールごとに 200ms スタッターする画面は、安定した 60fps より体感が悪い。だから指標は「平均」より **percentile (p75 / p95 / p99)** と「悪いフレームの割合 (jank %)」で持つ。

人間の知覚しきい値 (定番の Nielsen の閾値 + 現代の補足):
- **~100ms** … 「即時」と感じる上限。タップ→最初の視覚変化はこれ以内に。
- **~300ms** … 画面遷移アニメの上限。これを超えると「もたつき」。
- **~1s** … 思考が途切れない上限。これ以内なら待たされた感が薄い。
- **>1s** … 進捗表示 (skeleton / spinner) が必要。

### フレーム予算 (frame budget)

| リフレッシュレート | 1 フレームの予算 | 超えると |
|---|---|---|
| 60Hz | **16.67ms** | dropped frame = ジャンク |
| 90Hz | 11.1ms | 同上 |
| 120Hz (ProMotion 等) | 8.33ms | 60fps の倍シビア |

現代の iPhone / Android は 90/120Hz が普通。**120Hz 端末で 60fps しか出ないフィードは「明らかにおかしい」と感じられる**ので、ハイリフレッシュ対応は品質指標の一部になりつつある。

### Core Web Vitals (Web / RN Web に効く) — 2024 確定値

`web.dev` の公式しきい値。判定は必ず **75 パーセンタイル**で、モバイル/デスクトップを分けて測る。3 指標すべてが p75 で "good" を満たして初めて総合 "good"。

| 指標 | 何を測る | good | needs-improvement | poor (>) |
|---|---|---|---|---|
| **LCP** (Largest Contentful Paint) | 主要コンテンツの表示=読込体感 | ≤ 2.5s | 2.5–4.0s | 4.0s |
| **INP** (Interaction to Next Paint) | 応答性 (全インタラクション) | ≤ 200ms | 200–500ms | 500ms |
| **CLS** (Cumulative Layout Shift) | レイアウトずれ=視覚安定 | ≤ 0.1 | 0.1–0.25 | 0.25 |

補助指標 (LCP/INP の診断に使う):
- **FCP** (First Contentful Paint) good ≤ 1.8s
- **TTFB** (Time to First Byte) good ≤ 0.8s
- **TBT** (Total Blocking Time) … lab 環境での INP の代理指標

> ⚠️ **2024-03 に FID → INP へ置き換わった。** First Input Delay (初回入力遅延) は廃止。INP は「最初の」ではなく**ページ滞在中の全インタラクションの応答**を見る（worst に近い高 percentile）ので、FID では緑だったページが INP で落ちる例が多い。新規実装で FID を測っているコードは陳腐化している (→ Geek 適用の節参照)。

### ネイティブ vitals (Android / iOS)

Android `developer.android.com/quality/technical` + 業界実測ベンチ (uxcam 等) を統合した実務目標値:

| 指標 | 定義 | 目標 |
|---|---|---|
| **フレームレート (スクロール中)** | フィード/リスト/グリッドを実際に scroll している間の平均 FPS | 60Hz 端末で 58fps+ / 120Hz で 90fps+ |
| **Slow frames (jank %)** | 描画が **16.67ms 超**のフレーム割合 (Google Play 定義) | **< 10%** |
| **Frozen frames** | 描画が **700ms 超**のフレーム割合 | **< 0.05%** |
| **Cold start** | プロセス終了状態からタップ→最初のインタラクティブ frame | p50 < 1.2s / p95 < 2s。**> 5s は "excessive"** とフラグされ初回継続率に直撃 |
| **Warm start** | プロセスが memory に残った状態でタップ→操作可能 | p95 < 800ms (> 1.5s は体感) |
| **TTI** (Time to Interactive) | 画面遷移→ジャンク無く tap/scroll できる点 | 主要画面 p95 < 2s / 高トラフィック画面 < 1s |
| **ANR rate** (Android) | main thread が UI イベントで 5s+ ブロック | Play の天井 **0.47%**、実用は更に下 |
| **Hang rate** (iOS) | main thread が 250ms+ (micro) / 2s+ (full) 不応答 | < 0.1% session |
| **Crash-free users** | 期間内クラッシュ 0 のユーザ率 | **> 99%/日** (初回 session でクラッシュ→離脱率 ~3 倍) |
| **Crash-free sessions** | クラッシュ無し session 率 | **> 99.5%** |
| **API latency** | リクエスト発火→使える応答 (client 計測) | p95 < 500ms / p99 < 1.5s |
| **Memory peak** | 1 session の最大 RAM | < 200MB (consumer) / mid-Android 220MB / low-end 120MB |
| **App size (初回 DL)** | first launch でのバイト数 | cellular で < 15MB |

行動シグナル (フラストレーション検知):
- **Rage-tap rate** … 同一要素に 4+ tap/秒 を含む session 割合。応答が遅い/効いてないサイン。
- **UI-freeze rate** … 2s 超の freeze を含む session が **< 1%**。
- **TTI と "time to first action" をペアで見る** … TTI は速いのに最初の操作が遅い = パフォーマンスではなく **UI が分かりにくい**(情報設計の問題)。

### アクセシビリティ (a11y) — WCAG 2.1/2.2 + プラットフォーム

| 項目 | 基準 |
|---|---|
| **タッチターゲット** | WCAG 2.5.5 (AAA): **44×44 CSS px**。iOS HIG: **44×44pt**、Android Material: **48×48dp**。WCAG 2.2 の 2.5.8 (AA) は 24px 最小 + 近接時の十分な間隔 |
| **コントラスト比** | 通常テキスト **4.5:1** (AA) / 大テキスト (18pt or 14pt bold) **3:1** / UI コンポーネント・グラフィック **3:1** (2.5.7) |
| **スクリーンリーダー** | iOS VoiceOver / Android TalkBack。全 interactive 要素に **role + label**、状態 (disabled/selected) を読み上げ |
| **動きの抑制** | OS の "Reduce Motion" を尊重。fade/scale/parallax を停止 or 即遷移に |
| **フォント拡大** | Dynamic Type / fontScale に追従 (固定 px でレイアウト崩壊させない) |

> 小さいターゲットは「duplicate がある」「テキスト中のリンク」「OS 標準コントロール」「サイズが本質的」のいずれかでのみ許容 (2.5.5 例外)。

### 体感速度 (perceived performance) のテクニック

実時間を縮めなくても**体感**は上げられる:
1. **Skeleton screen** … spinner より「もうすぐ来る」感が強い。ただし **速いロード (<200ms) では出さない**(チラつき=逆効果)。
2. **Optimistic UI** … サーバ応答を待たずに先に反映 → 失敗時 revert。タップ→反応の 100ms 壁を突破。
3. **Progressive image** … blurhash/LQIP → 本画像へ crossfade。CLS 0 を保ちつつ「何か出てる」状態を即作る。
4. **即時の press feedback** … 押下と同時に scale/haptic/highlight。OS の押下遅延 (~130ms) を消す。
5. **アンカー付きスプラッシュ** … JS 到着前から素 HTML/CSS で起動演出を出す → 白画面を消す。

---

## 具体例 (コードブロック)

### 1. ジャンクを percentile で測る (PerformanceObserver / RN)

```ts
// Web: 1 フレームでも 16.67ms を超えたら jank としてカウント
let janks = 0, total = 0, last = performance.now();
function tick(now: number) {
  const dt = now - last; last = now; total++;
  if (dt > 17) janks++;            // 60fps の予算超過
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
// jankRate = janks / total  →  目標 < 0.10 (slow frames < 10%)
```

```ts
// React Native: useNativeDriver でアニメを UI スレッドへ逃がす (JS thread が
// 詰まってもアニメは 60fps を維持)。Reanimated の worklet も同じ思想。
Animated.timing(opacity, {
  toValue: 1, duration: 240,
  useNativeDriver: true,   // ★ これが無いと JS thread のブロックで dropped frame
}).start();
```

### 2. Skeleton のチラつきを防ぐ「遅延ロード判定」

```ts
// 速いロードで skeleton を一瞬だけ見せる = 逆にうるさい。
// 200ms 以上「継続して」loading の時だけ true を返す。
export function useDelayedLoading(loading: boolean, delayMs = 200): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!loading) { setDelayed(false); return; }
    const t = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(t);
  }, [loading, delayMs]);
  return delayed;
}
```

### 3. タッチターゲットを視覚サイズと独立に拡張 (hitSlop)

```tsx
// 見た目は 32px のアイコンでも、tap 領域を 44px 相当に広げる。
// hitSlop は描画を変えずに当たり判定だけ拡張する → WCAG 2.5.5 を満たしつつ
// 密なツールバーでもレイアウトを崩さない。
<Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel="保存">
  <Icon.save size={28} />     {/* 28 + 8*2 = 44 の当たり判定 */}
</Pressable>
```

### 4. Reduce Motion を尊重する分岐

```tsx
const reduceMotion = useReducedMotion();      // OS 設定 (or アプリ設定) を購読
if (reduceMotion) {
  opacity.value = 1;                          // fade/scale を skip して即 swap
} else {
  opacity.value = withTiming(1, { duration: 480, easing: EASE_OUT_QUART });
}
```

---

## よくあるアンチパターン

- **平均 FPS だけ報告する** … スパイク (p99) を隠す。「平均 59fps だから OK」は嘘。slow/frozen frame % と p95 で見る。
- **dev ビルドで性能を測る** … React Native は dev で重い。**release ビルドで profile** が鉄則。`console.log` は JS thread を詰まらせるので production で strip。
- **重い処理を JS thread / main thread で同期実行** … setState で 200ms 再描画 = 約 12 フレーム落ちる。`InteractionManager`/`requestAnimationFrame`/worklet で逃がす。
- **FID をまだ指標にしている** … 2024 で INP に置換済み。FID 緑でも INP 赤はよくある。
- **画像/広告/フォントで CLS を起こす** … 寸法を先に確保せずに後から差し込むとレイアウトがガクッと動く。width/height か aspect-ratio を予約しておく。
- **skeleton を即出す** … 速いロードでチラつく。**遅延 (200ms) 後**にだけ出す。
- **spinner 万能主義** … 構造が分かる skeleton の方が体感が良い場面が多い。
- **タップに即フィードバックしない** … OS の押下遅延 (~130ms) を放置すると「効いてない?」と感じ rage-tap を誘発。press-in で即 haptic/scale。
- **タッチターゲットが 44px 未満で密集** … 誤タップ。特にツールバー/タブ。
- **a11y label を付け忘れる** … VoiceOver/TalkBack で「ボタン」としか読まれず操作不能。
- **Reduce Motion を無視** … 前庭障害ユーザに苦痛。さらに RN では system RM 下で `withTiming` の duration が 0 に潰れ「1 フレーム点滅して消える」事故 ([[地雷・落とし穴 総覧]] のスプラッシュ事例)。
- **大量リストを `.map()` で素描画** … virtualization (FlatList/FlashList) を使わないとメモリと初期描画が爆発。

---

## ★Geek への適用

geek-v4 は React Native (Expo) で iOS/Android/Web に同一コード配信。UX 品質指標は実装に深く織り込まれている。詳細パフォーマンス論は [[パフォーマンス最適化]] / [[React Native・Expo パフォーマンス最適化]]、画像は [[画像・メディアパイプライン]] 参照。

### 60FPS / ジャンク対策 (実装済み)

- **List**: `@shopify/flash-list` (recycler 方式) で大量投稿でも軽い。`key={i}` 禁止・一意 id 必須 (重複 key 警告 → 描画破綻)。
- **アニメ**: Reanimated 3 + Moti を worklet で **UI スレッド実行**。`design/motion.ts` に easing/spring トークンを集約 (`EASE_OUT_QUART = bezier(0.165,0.84,0.44,1)`, `SPRING_SNAPPY damping18/stiffness300/mass0.6`)。
- **`PressableScale`** (`components/ui/PressableScale.tsx`): `transform:[{scale}]` のみで layout を動かさず spring フィードバック。`delayPressIn=0` で OS の ~130ms 遅延を排除し、**haptic を `onPressIn` で即発火**(onPress より速い体感)。
- **Zustand は selector 購読必須**: 全 destructure (`const {user,...}=useStore()`) は store の 1 フィールド変更で全 component 再描画 → 「かくかく」。`_layout.tsx` で settings 16 フィールド全 destructure → onboarding 中ガク付きの実害があった ([[State管理 (Zustand・React Query)]])。
- **production で `console.log` strip**: `babel.config.js` の `transform-remove-console` (ただし realtime の `console.warn` は除外設定で残す)。
- **PressableScale の過去地雷**: `delayPressIn=130ms` + haptic を onPress 紐付けで「タップ感が遅い」→ `delayPressIn=0` / `onPressIn` haptic / `hitSlop:8` に修正済 ([[地雷・落とし穴 総覧]])。

### TTI / 起動・体感速度

- **アンカー付き起動スプラッシュ** (`scripts/web-postbuild.mjs` が `dist/index.html` に注入する素 HTML/CSS の `#geek-splash`): JS 到着前から「Geek」ワードマーク + 進捗バーを表示 → **白画面ゼロ**。React mount 後に `MutationObserver` (+ 12s safety) で fade-out 除去。
- **イントロ** (`components/ui/IntroAnimation.tsx`): mount 後の演出。スプラッシュと**完全に同寸・同演出**で seam なく繋ぐ【確定版・変更禁止】。退場は `SWEEPS_BEFORE_EXIT(2) × SWEEP_MS(1150) = 2300ms` に**アンカー**(バー右端到達と同時に退場)。`FADE_IN+HOLD` のような sweep 非依存値に戻すと途中ブツ切り (短すぎ違和感) が再発 → 過去「起動 5 秒黒画面」(splash+intro 合算 8s) を 3.0s + skip タップ + sessionStorage で 2 回目以降 skip + 500ms forceReady safety に短縮した経緯あり。
- **フィード起動の体感**: above-the-fold の最初のカード画像は `priority='high'` で fetch slot を先取り → 初回 paint が速い。
- **古い画面が出る問題**: RQ persist に buster 無 + `refetchOnMount:false` が真因だった (修正済)。Web 起動時の鮮度は [[地雷・落とし穴 総覧]] / MEMORY 参照。

### 体感速度 — ProgressiveImage / Skeleton

- **`ProgressiveImage`** (`components/ui/ProgressiveImage.tsx`) = Apple News 風 二層 crossfade:
  - 下層 blurhash placeholder を**最初から**表示 → 本画像 `onLoadEnd` で 480ms `easeOutQuart` fade-in (`SHARP_FADE_MS`)、blurhash は 0.8 で 200ms hold → 240ms で 0 へ溶かす (`BLUR_HOLD_MS`/`BLUR_FADE_MS`)。**sharp が完全に乗ってから blur を抜く = pop-in と flicker を同時回避**。
  - ken-burns: cover 時のみ scale 1.04→1.0 を 600ms。**contain 時は `useKenBurns=false`** で scale 固定(scale>1 + overflow:hidden が contain の左右をクリップする事故を回避 ← 実際に「横が映らない」回帰があった)。
  - エラー時は透明にせず blurhash を残し中央に淡い image icon。
  - **reduceMotion 時は fade/scale/hold を全 skip して即 swap** (worklet-safe)。
  - Web のみ `IntersectionObserver` (rootMargin 200px) で lazy load、native は FlashList virtualization で代替。
  - **CLS 対策**: 親 View が width/height を確定保持 (`overflow:hidden`) → 画像差し込みでレイアウトが動かない。
- **Skeleton** (`components/ui/Skeleton.tsx` → `SkeletonBox` primitive = LinearGradient + Reanimated translateX の shimmer): `ThreadCardSkeleton` / `MypageSkeleton` / `NotificationSkeleton` / `PostCardSkeleton` 等の用途別テンプレ。
- **`useDelayedLoading(loading, 200)`** (`hooks/useDelayedLoading.ts`): **200ms 未満の速いロードでは skeleton を出さない**(チラつき防止)。上の「具体例 2」がまさにこの実装。
- **Optimistic UI**: like/concern/save は snapshot→apply→settled invalidate→error revert が標準 ([[State管理 (Zustand・React Query)]])。タップ→即反映で 100ms 壁を突破。

### アクセシビリティ

- **タッチターゲット**: `PressableScale` の `hitSlop ?? 8` で当たり判定を拡張 (誤タップ削減・WCAG 2.5.5 方向)。✅
- **role/label/state**: `PressableScale` は `accessibilityRole ?? 'button'` と `accessibilityState={{disabled}}` を自動補完 → VoiceOver/TalkBack で「ボタン」「使用不可」と読まれる。`IntroAnimation` は `accessibilityRole="image" accessibilityLabel="Geek"`。✅
- **Reduce Motion**: `hooks/useReducedMotion.ts` を ProgressiveImage / IntroAnimation 等が購読。スプラッシュ側も `prefers-reduced-motion` で pulse/sweep を停止しバーを静止 (`translateX(85%)`)。**RM 下の duration 0 潰れ事故**対策として fade は `ReduceMotion.Never`、HOLD は `withDelay` でなく `setTimeout` を使う(CLAUDE.md §0 の確定仕様)。✅
- **i18n / コントラスト / テーマ**: `design/tokens.ts` の C トークンで配色を中央管理 (light/dark) → コントラスト比はトークン側で担保する設計 ([[i18n・テーマ・デザインシステム]])。

### 🔴 改善余地: webVitals が **FID を測っていて INP 未対応**

`lib/webVitals.ts` は依存ゼロの `PerformanceObserver` で 5 指標を PostHog (`track('web_vitals')`) へ送るが、**計測対象が `LCP / FID / CLS / FCP / TTFB`** で、`THRESHOLDS` も `FID:[100,300]` を持つ。

```ts
// lib/webVitals.ts (抜粋) — FID は 2024 で廃止された旧指標
type Metric = { name: 'LCP'|'FID'|'CLS'|'FCP'|'TTFB'; ... };
const THRESHOLDS = { LCP:[2500,4000], FID:[100,300], CLS:[0.1,0.25], FCP:[1800,3000], TTFB:[800,1800] };
// コメント: 「INP はブラウザ依存があるため省略」
```

- **問題**: Core Web Vitals は 2024-03 に **FID→INP** へ置換済み。FID は「初回入力遅延」のみで、ページ滞在中の重いインタラクション (フィードの like 連打・モーダル開閉) の応答性を捉えない。Geek のような操作密度の高い SNS では **FID 緑 / INP 赤** が起こりうる。
- **方向性**: `PerformanceObserver({type:'event', durationThreshold:40, buffered:true})` で INP を近似集計 (worst インタラクションの応答) し、しきい値 `INP:[200,500]` で rating。FID は補助 or 削除。実装が重いなら `web-vitals` v4 の `onINP` 採用も検討 (現状は依存ゼロ方針)。

> ⚠️ Web 限定。INP は native には無い概念。native 側の応答性は hang/ANR と「tap→first paint <100ms」で別途見る。

---

## 出典 (URL 一覧)

- web.dev — Web Vitals (LCP/INP/CLS 定義としきい値, p75): https://web.dev/articles/vitals
- web.dev — Defining Core Web Vitals thresholds: https://web.dev/articles/defining-core-web-vitals-thresholds
- Android Developers — What great technical quality looks like (frame rate/jank/ANR/crash/TTFD): https://developer.android.com/quality/technical
- React Native — Performance (0.77, 16.67ms 予算 / JS vs UI thread / useNativeDriver / FlatList): https://reactnative.dev/docs/0.77/performance
- UXCam — How to Measure Mobile App Performance: Top Metrics (cold start/TTI/jank%/ANR/crash-free/latency 実測ベンチ): https://uxcam.com/blog/how-to-measure-mobile-app-performance/
- Bugsee — Mobile App Performance Metrics: https://bugsee.com/blog/mobile-app-performance-metrics/
- W3C WAI — Understanding 2.5.5 Target Size (Enhanced): https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- LogRocket — All accessible touch target sizes (44pt/48dp): https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/
- Google Search Central — Core Web Vitals & Search: https://developers.google.com/search/docs/appearance/core-web-vitals
