// ============================================================
// ★ Reanimated 3 worklet runtime polyfill — must run BEFORE
//   anything else loads.
//   Reanimated 3.16 + Expo SDK 52 web build には以下の問題:
//   1. babel-plugin が `_WORKLET` global への参照を埋め込むが
//      Web build では定義されない → "_WORKLET is not defined"
//   2. useSharedValue / useAnimatedStyle が `_getAnimationTimestamp`
//      / `_chronoNow` 等の native bridge function を呼ぶが、Web の
//      worklet runtime ではこれらが未定義 → TypeError
//   3. logger (logger.js handleLog / runtimes.js) が `__reanimatedLoggerConfig`
//      を *bare global 識別子* として読む (logger.js:111 / runtimes.js:29) が、
//      reanimated 自身の registerLoggerConfig (worklet 内 `global` 代入) は
//      Web shim 上では globalThis に届かず未定義のまま。worklet を含む画面を
//      開くと "Can't find variable: __reanimatedLoggerConfig" で落ちる
//      (Layout.springify / FadeIn 等 logger 経路を踏む API で顕在化)。
//   いずれも起動時 or 画面遷移時に ErrorBoundary を発火して white screen を起こす。
//   JS-thread fallback として performance.now() を返す polyfill を
//   global に注入する (UI thread では実 native runtime が上書きする
//   ので native ビルドには影響しない)。
// ============================================================
/* eslint-disable no-var */
declare global {
  var _WORKLET: boolean | undefined;
  var _getAnimationTimestamp: (() => number) | undefined;
  var _chronoNow: (() => number) | undefined;
  var _scheduleHostFunctionOnJS: ((fn: (...a: unknown[]) => unknown, args?: unknown[]) => void) | undefined;
  // Reanimated 3.16 logger config (logger.js DEFAULT_LOGGER_CONFIG と同形)
  var __reanimatedLoggerConfig:
    | {
        logFunction: (data: { level: string; message: { content: string } }) => void;
        level: number;
        strict: boolean;
      }
    | undefined;
}
/* eslint-enable no-var */
if (typeof globalThis !== 'undefined') {
  if (typeof globalThis._WORKLET === 'undefined') {
    globalThis._WORKLET = false;
  }
  if (typeof globalThis._getAnimationTimestamp !== 'function') {
    globalThis._getAnimationTimestamp = () =>
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
  }
  if (typeof globalThis._chronoNow !== 'function') {
    globalThis._chronoNow = () =>
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
  }
  if (typeof globalThis._scheduleHostFunctionOnJS !== 'function') {
    globalThis._scheduleHostFunctionOnJS = (fn, args) => {
      try {
        fn(...(args ?? []));
      } catch {
        // swallow — worklet -> JS scheduling fallback
      }
    };
  }
  // logger.js handleLog() / runtimes.js が bare 識別子 `__reanimatedLoggerConfig`
  // を読む (logger.js:111 / runtimes.js:29)。Web の worklet shim では reanimated
  // 自身の registerLoggerConfig (worklet 内 global 代入) が globalThis に届かず
  // 未定義のままになり、worklet を含む画面で
  //   "Can't find variable: __reanimatedLoggerConfig"
  // を踏む。DEFAULT_LOGGER_CONFIG (logger.js:25) と同形の fallback を注入する。
  // native / 正常な web では import 'react-native-reanimated' が
  // registerLoggerConfig で上書きするので影響しない。
  if (typeof globalThis.__reanimatedLoggerConfig === 'undefined') {
    globalThis.__reanimatedLoggerConfig = {
      logFunction: (data) => {
        try {
          const content = data.message.content;
          if (data.level === 'warn') {
            console.warn(content);
          } else {
            console.error(content);
          }
        } catch {
          // swallow — logger fallback は決して throw させない
        }
      },
      level: 1, // LogLevel.warn (reanimated DEFAULT_LOGGER_CONFIG.level)
      strict: false,
    };
  }
}
import 'react-native-reanimated';

import { useEffect, useCallback, useRef, useState, lazy, Suspense } from 'react';
import { View, Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { useAppFonts } from '../hooks/useAppFonts';
import { useUserChannel } from '../hooks/useUserChannel';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLanguageStore } from '../stores/languageStore';
import { useTagFilterStore } from '../stores/tagFilterStore';
import { useFeedStore } from '../stores/feedStore';
import { feedQueryKey, fetchFeedFirstPage } from '../lib/feed/feedQuery';
import { useAdPreferencesStore } from '../stores/adPreferencesStore';
import { ToastHost } from '../components/ui/ToastHost';
import { VideoLightbox } from '../components/ui/VideoLightbox';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
// ★ パフォーマンス: IntroAnimation / FeedbackFAB は first paint 直後に必須ではない。
//   - IntroAnimation: 同セッション 2 回目以降は sessionStorage で skip
//   - FeedbackFAB:    feedback_fab feature flag + ログイン要 (初期描画時点で render しない)
//   起動チャンクから外して dynamic import に逃がす — 初回バンドル size を ~30-50KB 削減。
//   markIntroShown は元から no-op の旧 API 互換 stub のためここで inline 化し、
//   IntroAnimation モジュール本体を起動チャンクから完全に切り離す
//   (static import を残すと lazy しても module は initial bundle に乗ってしまう)。
const markIntroShown = () => {};
const IntroAnimation = lazy(() =>
  import('../components/ui/IntroAnimation').then((m) => ({ default: m.IntroAnimation })),
);
const FeedbackFAB = lazy(() =>
  import('../components/feedback/FeedbackFAB').then((m) => ({ default: m.FeedbackFAB })),
);
import { useIntroStore } from '../stores/introStore';
import { getBool, setBool } from '../lib/storage';
import { Image as ExpoImage } from 'expo-image';
import { thumbedUrl } from '../lib/utils/imageUrl';
import { OfflineBanner } from '../components/ui/OfflineBanner';
// useOfflineQueue は legacy useOfflineQueueProcessor を内部で wrap し、
// 新規 lib/offline/queue.ts の flush + networkMonitor 購読も一括で起動する。
// OfflineBanner が内部で useOfflineQueue を呼ぶので、root では別途 runner を
// 置く必要は無い。
import { initAnalytics } from '../lib/analytics';
import { initSentry, setSentryUser, clearSentryUser } from '../lib/sentry';
import { initWebVitals } from '../lib/webVitals';
import { useThemeStore, useResolvedTheme, syncStaticPaletteWithTheme } from '../lib/theme/themeStore';
import type { ResolvedTheme } from '../lib/theme/themeStore';
import { useColors } from '../hooks/useColors';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import {
  fetchMyCommunities,
  fetchMyCommunityPostsRich,
} from '../lib/api/communities';

SplashScreen.preventAutoHideAsync().catch(() => {});

// 旧版は module top-level で initSentry() / initAnalytics() を即時起動していた。
// この経路だと PostHog / Sentry 本体のロード + init が first paint の同期処理に
// 乗ってしまい、体感の "もたつき" の元になっていた。
// → 起動直後 idle に逃がす useEffect 経由に変更。bundle 自体も dynamic require
//   なので、不要なルートでは取り込まれない。

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 秒は同じデータを再 fetch しない (network roundtrip 大幅削減)
      staleTime: 30_000,
      // 監査改修: 24h → 2h に短縮。AsyncStorage 使用量 ~75% 削減 +
      // cold start で復元する JSON サイズ縮小で起動 10-15% 高速化。
      gcTime: 1_000 * 60 * 60 * 2,
      // tab 戻り時の再 fetch を抑制 (頻繁な focus で連打しない)
      refetchOnWindowFocus: false,
      // 接続復帰時は必ず最新を取りに行く
      refetchOnReconnect: 'always',
      // mount 時: stale (staleTime 超過) の query だけ裏で再 fetch する (RQ 既定値)。
      // 永続 cache から復元した dehydrated データは必ず stale 扱いになるため、
      // cold open 時に自動で最新を取り直し「起動すると古い画面が残る」を解消する。
      // fresh (30s 以内) な query は再 fetch しないので連打にはならない。
      refetchOnMount: true,
      // error 時の retry を 1 回まで (3 回はうるさい / サーバ負荷の元)
      retry: 1,
      retryDelay: (attemptIndex: number) =>
        Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 0,
    },
  },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

// ★ 起動時の re-render storm 対策:
//   syncStaticPaletteWithTheme は render body で毎 render 呼ばれる (commit-time
//   correctness のため)。だが起動中 RootLayout は fontsLoaded / authHydrated /
//   settingsHydrated / forceReady / lang / user が flip するたびに 5-6 回 re-render
//   され、その都度 palette を Object.assign + gradient 10 本書き換えるのは無駄。
//   module-level の last-applied ref で theme が「実際に変わった時」だけ実行する。
let _lastSyncedTheme: ResolvedTheme | null = null;
function syncStaticPaletteIfChanged(theme: ResolvedTheme): void {
  if (_lastSyncedTheme === theme) return; // theme 不変 → no-op
  _lastSyncedTheme = theme;
  syncStaticPaletteWithTheme(theme);
}

// 永続 React Query cache の buster。query の cache shape (返り値の形) を変えたら
// この文字列を必ず bump する → 古い dehydrated cache を 1 度だけ破棄させ、
// 「アプリ更新後も古い画面/データが残る」事故を防ぐ (起動時に clean slate)。
const PERSIST_BUSTER = 'geek-rqcache-v1';

// イントロ再生制御
//   - 初回ロード: 再生
//   - 同セッション内の再ロード (PWA タブ切り替え後の戻り等): スキップ
//   - SSR 時: 再生しない
// sessionStorage を使うので、ブラウザを閉じれば次回また再生される。
const INTRO_SEEN_KEY = 'geek:intro_seen_session';
// native は毎 cold start でイントロ全編 (~3s) を再生していた (sessionStorage は
// web 専用ガードのため、native では shouldShowIntro が常に true を返していた)。
// 起動を「すぐ操作可能」にするため、native では永続フラグ (MMKV 同期読み) で
// 「一度見たら以降の起動ではスキップ」にする。key を bump すると再表示できる。
const INTRO_SEEN_PERSIST_KEY = 'geek:intro_seen_v4';
function shouldShowIntro(): boolean {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return false;
    try {
      if (sessionStorage.getItem(INTRO_SEEN_KEY) === '1') return false;
    } catch { /* sessionStorage が使えない環境 (ITP / private mode) */ }
    return true;
  }
  // native: 一度見たら以降の cold start ではスキップ (= feed が即操作可能)
  try {
    return getBool(INTRO_SEEN_PERSIST_KEY) !== true;
  } catch {
    return true;
  }
}
function markIntroSeenForSession() {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try { sessionStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* ignore */ }
    return;
  }
  try { setBool(INTRO_SEEN_PERSIST_KEY, true); } catch { /* ignore */ }
}

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  // 全 store destructure はやめる — settings の 16 フィールド (notifyLike,
  // dataSaver, quietHour 等) が更新されるたび RootLayout 全体が再 render され、
  // navigation tree と全 screen を巻き込んで「かくかく」する。必要な field
  // (user / hydrated / hydrate action) だけを subscribe する。
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);
  const router = useRouter();
  const segments = useSegments();
  const [introDone, setIntroDone] = useState<boolean>(() => !shouldShowIntro());
  // 設定 → イントロを再生 から呼ばれる。replayKey が増えるたびに IntroAnimation を再マウント。
  const introReplayKey = useIntroStore((s) => s.replayKey);
  const introReplaying = useIntroStore((s) => s.playing);
  const finishIntroReplay = useIntroStore((s) => s.finish);
  const playIntro = useIntroStore((s) => s.play);

  // Web のみ: "I" キー押下でイントロ再生 (ログイン前でも何度でも見られるショートカット)
  //   ★ これは dev/power-user 向けの affordance で first-interactive には不要。
  //     初回 commit に window listener を足さないよう、idle (requestIdleCallback /
  //     fallback setTimeout) で first paint 後に登録する。
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let cleanup: (() => void) | undefined;
    const arm = () => {
      const onKey = (e: KeyboardEvent) => {
        // 入力中の textarea/input には反応させない
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
        if (e.key === 'i' || e.key === 'I') playIntro();
      };
      window.addEventListener('keydown', onKey);
      cleanup = () => window.removeEventListener('keydown', onKey);
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const handle = ric ? ric(arm) : setTimeout(arm, 200);
    return () => {
      cleanup?.();
      if (!ric) clearTimeout(handle as ReturnType<typeof setTimeout>);
    };
  }, [playIntro]);

  // ★ HIGH バグ修正: 初回イントロ (Slot A: !introDone && !introReplaying) の再生中に
  //   replay (設定→イントロ再生 / web 'I' キー) が起動すると introReplaying=true で Slot A が
  //   onComplete 前に unmount され、seen フラグが立たず「初回が二重再生 + リロードで再再生」になる。
  //   replay 開始時に初回がまだ未完了なら、ここで初回完了の副作用 (seen 永続化 + introDone) を
  //   確定させて Slot A を「完了扱い」で畳む。onComplete は IntroAnimation 内 completedRef で
  //   一回性が保たれるため、後から元の onComplete が走っても二重発火しない (全て idempotent)。
  useEffect(() => {
    if (introReplaying && !introDone) {
      markIntroSeenForSession();
      setIntroDone(true);
    }
  }, [introReplaying, introDone]);

  const hydrateLang = useLanguageStore((s) => s.hydrate);
  const lang = useLanguageStore((s) => s.lang);
  const hydrateTagFilter = useTagFilterStore((s) => s.hydrate);
  const hydrateAdPrefs = useAdPreferencesStore((s) => s.hydrate);
  // ★ テーマ — system / light / dark 切替に対応。
  //   hydrate は同期 (MMKV/localStorage)、UI は useColors() で各画面が購読。
  const hydrateTheme = useThemeStore((s) => s.hydrate);
  const C = useColors();
  const resolvedTheme = useResolvedTheme();

  // ★ ライトモード対応 (2026-05-31): 193+ ファイルが `import { C } from 'tokens'`
  //   で static C を直参照しているため、テーマ切替時に C / GRAD の中身を
  //   破壊的に書き換える。同時に下の <View key={resolvedTheme}> で navigation
  //   tree 全体を remount して、static C を closure に持つ全コンポーネントが
  //   新パレットで再描画されるようにする。
  //   theme 切替は頻繁ではなく、ナビ位置がリセットされても許容範囲。
  //
  //   commit 段階 (render の前) で同期実行することで、初回 paint から
  //   正しい色になる。useEffect だと一瞬古い色でフラッシュする。
  //   ★ ただし theme が変わっていない再 render では skip (起動 storm 対策)。
  syncStaticPaletteIfChanged(resolvedTheme);

  // ★ 言語切替反映 (Web):
  // `document.documentElement.lang` を更新することで:
  //   1. Chrome / Edge / Safari の "このページを翻訳" 機能が自動発火
  //   2. ARIA / screen reader が正しい言語で読み上げ
  //   3. CSS の `:lang()` セレクタが効く
  //
  // 旧実装は useT() フックを定義していたが、UI 内に実際の使用箇所が 0 だった
  // ため、languageStore を変えても文字列が一切翻訳されないバグだった。
  // ブラウザ翻訳機能を活用することで、全画面の日本語が一気に多言語化される。
  // Native (iOS / Android) では useT() 経由の翻訳 + 動的翻訳 (translateDynamic)
  // を順次拡充していく予定。
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    try {
      document.documentElement.lang = lang;
      // ★ 2026-05-31: ブラウザ翻訳ブロックの動的解除
      //   scripts/fix-html.mjs が dist/index.html に <html translate="no"> +
      //   <meta name="google" content="notranslate"> を注入して Chrome / Edge /
      //   Safari の翻訳機能をブロックしているため、ユーザーが言語を ja 以外に
      //   切替えても UI が一切翻訳されない状態だった。
      //   - lang === 'ja' → 翻訳ブロックを維持 (日本語ユーザーが Chrome の自動
      //     翻訳をオンにしていても勝手に変な訳が入らない既存挙動を維持)
      //   - lang !== 'ja' → translate='yes' に上書き + notranslate meta を除去
      //     して、Chrome の "このページを翻訳" プロンプトを発火させる
      const html = document.documentElement;
      const isJa = lang === 'ja';
      html.setAttribute('translate', isJa ? 'no' : 'yes');
      // <meta name="google" content="notranslate"> の除去 / 復活
      const head = document.head;
      let googleMeta = head.querySelector('meta[name="google"]') as HTMLMetaElement | null;
      if (isJa) {
        if (!googleMeta) {
          googleMeta = document.createElement('meta');
          googleMeta.setAttribute('name', 'google');
          head.appendChild(googleMeta);
        }
        googleMeta.setAttribute('content', 'notranslate');
      } else if (googleMeta) {
        googleMeta.parentElement?.removeChild(googleMeta);
      }
      // <meta name="robots"> から 'notranslate' を抜く (translate を許可する)
      const robotsMeta = head.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
      if (robotsMeta) {
        const cur = robotsMeta.getAttribute('content') ?? '';
        if (isJa) {
          if (!cur.includes('notranslate')) {
            robotsMeta.setAttribute('content', cur ? `notranslate, ${cur}` : 'notranslate');
          }
        } else {
          const cleaned = cur
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s && s !== 'notranslate')
            .join(', ');
          robotsMeta.setAttribute('content', cleaned || 'index, follow');
        }
      }
    } catch { /* ignore — DOM 操作失敗時はベスト effort で続行 */ }
  }, [lang]);
  useEffect(() => {
    // hydrate 改修 (MMKV 化):
    //   - settings / tagFilter / theme は MMKV 同期化されて 1ms 以下に
    //   - auth は supabase.auth.getSession() で 50-200ms 残る (network 込み)
    //   - lang / adPrefs は AsyncStorage のまま (cold start クリティカルパスに
    //     乗らないため改修対象外)
    // signature は Promise を返す互換のままで、allSettled で堅牢化を維持。
    // テーマは同期 MMKV / localStorage 読み出し → 即 set
    try { hydrateTheme(); } catch { /* 同期ストレージ読み失敗 → デフォルトテーマで続行 */ }
    void Promise.allSettled([
      hydrateAuth(),
      hydrateSettings(),
      hydrateLang(),
      hydrateTagFilter(),
      hydrateAdPrefs(),
    ]);
  }, [hydrateAuth, hydrateSettings, hydrateLang, hydrateTagFilter, hydrateAdPrefs, hydrateTheme]);

  // ★ Web: テーマに合わせて :root の background-color と meta theme-color を更新。
  // RN inline style は capture-time の値なので、未移行 component はテーマ切替で
  // 自動で色が変わらない。せめて body 背景だけ追従させて「角の黒帯/白帯」を抑制。
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    try {
      document.documentElement.style.backgroundColor = C.bg;
      document.body.style.backgroundColor = C.bg;
      document.documentElement.dataset.theme = resolvedTheme;
      // meta theme-color (Mobile Safari address bar / Android Chrome statusbar)
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', C.bg);
    } catch { /* ignore */ }
  }, [C.bg, resolvedTheme]);

  // ★ ホームフィード起動時 prefetch (landing 初速の最大改善):
  //   フィードの取得を「フィード画面 mount まで」待たず、auth 確定直後に裏で開始する。
  //   フィード画面 (useFeed) は同一 key (feedQueryKey) を使うので、mount 時には取得済/
  //   取得中 → React Query が dedupe して投稿カードが即表示される (spinner を挟まない)。
  //   ★ feedStore は AsyncStorage 由来で「非同期」hydrate。未 hydrate のまま getState() すると
  //     既定 for-you/open を読み、sort をカスタムした復帰ユーザーで feed.tsx の key と不一致
  //     → prefetch が消費されず無駄 (無駄 RPC も発生)。hydrate を await してから実 key で投げる。
  //     tagFilter は同期 hydrate 済なので getState() でそのまま正しい。community prewarm と違い
  //     遅延させない (landing なので最優先)。失敗は内部で握り潰される。
  useEffect(() => {
    if (!authHydrated || !user?.id) return;
    const uid = user.id;
    let cancelled = false;
    void useFeedStore
      .getState()
      .hydrate()
      .then(() => {
        if (cancelled) return;
        const { sort, scope } = useFeedStore.getState();
        const { likedTags, blockedTags } = useTagFilterStore.getState();
        // ★ データを prefetch して cache を温める (useFeed mount 時に dedupe で即表示)。
        //   prefetchInfiniteQuery ではなく fetchInfiniteQuery を使い、返ってきた先頭
        //   投稿のメディアサムネも expo-image へ先読みする。従来は landing の feed が
        //   「データだけ prefetch・画像は viewport prefetch 任せ」で、コミュ prewarm が
        //   画像まで温めるのと非対称だった (テキストは即出るが画像が一拍遅れる)。
        //   thumbWidth=480 は feed.tsx の viewport prefetch / ProgressiveImage と一致必須
        //   (URL が完全一致しないと cache hit しない)。失敗は握り潰す (mount 時に取り直す)。
        void qc
          .fetchInfiniteQuery({
            queryKey: feedQueryKey(sort, scope, likedTags, blockedTags),
            queryFn: () =>
              fetchFeedFirstPage({ sort, scope, likedTags, blockedTags, userId: uid, qc }),
            initialPageParam: undefined,
            staleTime: 0,
          })
          .then((data) => {
            if (cancelled) return;
            const urls = (data?.pages?.[0]?.posts ?? [])
              .flatMap((p) => p.media_urls ?? [])
              .filter(Boolean)
              .slice(0, 8);
            for (const url of urls) {
              try {
                void ExpoImage.prefetch(thumbedUrl(url, 480), 'memory-disk');
              } catch {
                /* ignore — feed 表示時に通常 prefetch される */
              }
            }
          })
          .catch(() => {
            /* prefetch 失敗は無視 (mount 時の useFeed が取り直す) */
          });
      });
    return () => {
      cancelled = true;
    };
  }, [authHydrated, user?.id]);

  // ★ コミュニティタブ pre-warm:
  //   ログイン済 & auth hydrate 完了で「コミュニティタブを開いたときに 1-2 秒
  //   の白画面が出る」現象を消すため、user 確定直後に裏で fetch を流して cache
  //   を温めておく (Tabs lazy=true の隣接 preload より早く確実)。
  //   prefetchQuery は staleTime 30s と整合し、二重 fetch にならない。
  useEffect(() => {
    if (!authHydrated || !user?.id) return;
    const uid = user.id;
    // ★ first paint と帯域/メインスレッドを奪い合わないよう、コミュ tab の
    //   pre-warm は初回描画が落ち着く ~300ms 後に回す (landing は feed なので
    //   コミュの 40 件 rich fetch を feed の初回 fetch とぶつけない)。
    const h = setTimeout(() => {
      void qc.prefetchQuery({
        queryKey: ['my-communities', uid],
        queryFn: fetchMyCommunities,
        staleTime: 30_000,
      });
      // コミュ feed: データを温めた上で、先頭投稿のメディアサムネを expo-image へ
      // 先読み → コミュタブを開いた瞬間に画像が出る (thumbWidth=480 は
      // ProgressiveImage と一致させて cache hit させる)。
      void qc
        .fetchQuery({
          queryKey: ['my-community-feed-rich', uid],
          queryFn: () => fetchMyCommunityPostsRich(40),
          staleTime: 30_000,
        })
        .then((data) => {
          const urls = (data?.posts ?? [])
            .flatMap((p) => p.media_urls ?? [])
            .filter(Boolean)
            .slice(0, 8);
          for (const url of urls) {
            try {
              void ExpoImage.prefetch(thumbedUrl(url, 480), 'memory-disk');
            } catch {
              /* ignore — タブ表示時に通常 fetch される */
            }
          }
        })
        .catch(() => {
          /* prewarm 失敗は無視 */
        });
    }, 300);
    return () => clearTimeout(h);
  }, [authHydrated, user?.id]);

  // Web Vitals 初期化 — cleanup 関数を握って unmount 時に observer + listener を解放
  useEffect(() => {
    const cleanup = initWebVitals();
    return cleanup;
  }, []);

  // ★ パフォーマンス監査: バックグラウンド時に Realtime WebSocket を切断。
  // フォアグラウンド復帰で再接続。バッテリー / モバイルデータ大幅削減 + iOS
  // で background での WebSocket keepalive ping を回避。
  // Web は visibilitychange、Native は AppState で対応。
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVis = () => {
        try {
          if (document.visibilityState === 'hidden') {
            supabase.realtime.disconnect();
          } else {
            supabase.realtime.connect();
          }
        } catch { /* ignore */ }
      };
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }
    const sub = AppState.addEventListener('change', (state) => {
      try {
        if (state === 'background' || state === 'inactive') {
          // native は OS が JS スレッドを凍結し auto-refresh の setInterval が止まるため、
          // 明示的に停止/再開する (library は native の visibility hook を持たない)。
          supabase.auth.stopAutoRefresh();
          supabase.realtime.disconnect();
        } else if (state === 'active') {
          // foreground 復帰: startAutoRefresh は即時 tick で期限間近 token を catch-up
          // refresh するので、realtime.connect より先に呼んで stale JWT での 401 を防ぐ。
          supabase.auth.startAutoRefresh();
          supabase.realtime.connect();
        }
      } catch { /* ignore */ }
    });
    return () => sub.remove();
  }, []);

  // ★ パフォーマンス監査: Web で主要 origin を preconnect で先 warmup
  // Supabase REST/Storage CDN への初回 RTT が約 100-200ms 短縮。
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const links: Array<{ rel: string; href: string }> = [
      { rel: 'preconnect', href: 'https://migpiwdlpwpvehzvdjyh.supabase.co' },
      { rel: 'dns-prefetch', href: 'https://fonts.gstatic.com' },
    ];
    const els: HTMLLinkElement[] = [];
    for (const { rel, href } of links) {
      if (document.head.querySelector(`link[rel="${rel}"][href="${href}"]`)) continue;
      const el = document.createElement('link');
      el.rel = rel;
      el.href = href;
      el.crossOrigin = 'anonymous';
      document.head.appendChild(el);
      els.push(el);
    }
    return () => {
      for (const el of els) { try { document.head.removeChild(el); } catch { /* ignore */ } }
    };
  }, []);

  // Sentry の user context を auth state に追従させる。
  // - 認証成立 → setSentryUser(id) で error / breadcrumb に user.id をタグ付け
  // - logout → clearSentryUser() で旧 id が次セッションに leak しないように clear
  // ! email / nickname など PII は絶対に渡さない (lib/sentry.ts の setUser は id 限定)
  useEffect(() => {
    if (!authHydrated) return;
    if (user?.id) setSentryUser(user.id);
    else clearSentryUser();
  }, [authHydrated, user?.id]);

  // Sentry / Analytics は first paint のクリティカルパスから外す。
  // requestIdleCallback (Web) / setTimeout (RN) で 1tick 後ろに倒す。
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      if (!__DEV__) {
        try { initSentry(); } catch { /* Sentry init 失敗はサイレント */ }
      }
      try { initAnalytics(); } catch { /* Analytics init 失敗はサイレント */ }
    };
    const ric: ((cb: () => void) => number) | undefined =
      typeof globalThis !== 'undefined'
        ? (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
        : undefined;
    const handle = ric ? ric(run) : setTimeout(run, 120);
    return () => {
      cancelled = true;
      const cic = typeof globalThis !== 'undefined'
        ? (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
        : undefined;
      if (ric && cic) cic(handle as number);
      else clearTimeout(handle as ReturnType<typeof setTimeout>);
    };
  }, []);

  // ★ Safety: hydration / font 読み込みが何らかの理由で詰まっても、
  //   一定時間で強制的にレンダー開始 (黒画面のまま止まるのを絶対に防ぐ)。
  const [forceReady, setForceReady] = useState(false);
  useEffect(() => {
    // パフォーマンス監査:
    //   旧 800ms → 500ms → 400ms と段階短縮。MMKV 化で settings / tagFilter の
    //   hydrate は ~1ms、残りクリティカルパスは font fallback (最大 100ms) + auth
    //   getSession (~150-300ms)。400ms で healthy 回線なら hydrate 完了に間に合う。
    //   ★ 400ms に下げても login flash は起きない: redirect する useEffect は
    //     `forceReady` ではなく `authHydrated` で gate している ([[project_geek_v4_auth_session]]
    //     F4 修正)。forceReady が先に立っても auth 未確定の間は redirect が抑止されるので
    //     「login が一瞬見える」事故にはならない。最悪でも背景色フレームが一瞬長く出るだけで、
    //     これは 500ms でも auth が遅れれば同様に起きる (旧コメントの「400ms は攻めすぎ /
    //     false render」は redirect が ready 基準だった F4 修正前の懸念で、現状は当たらない)。
    //   ※ さらに 300ms まで詰める余地はあるが、throttled 回線での cold start 実測
    //     (背景フレームが目立たないか) を確認してからにする。
    const t = setTimeout(() => setForceReady(true), 400);
    return () => clearTimeout(t);
  }, []);

  const ready = (fontsLoaded && authHydrated && settingsHydrated) || forceReady;

  const onLayoutRootView = useCallback(async () => {
    if (ready) await SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    // F4: redirect 判定は authHydrated を直接見る。ready は forceReady(500ms) を含むため、
    // hydrate 完了前(=有効 session 復元前で user=null)に !user 分岐で login へ誤バウンス
    // していた。描画ガード (下の `if (!ready) return null`) は ready のまま残し黒画面 safety
    // は維持する。
    if (!authHydrated || segments.length < 1) return;
    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    // パスワードリセット中は session が確立されていてもリセット画面に留まる必要がある。
    // (recovery トークンの exchangeCodeForSession → updateUser → signOut → login へ
    //  飛ぶフローを完走させるため、auto-redirect で feed に攫われないようガード。)
    // typedRoutes の string literal union に reset-password がまだ含まれない
    // (cache 生成タイミング) 場合があるので string cast で比較。
    const inResetPassword = ((segments as readonly string[])[1]) === 'reset-password';

    if (!user) {
      if (!inAuth) router.replace('/(auth)/login');
    } else if (inResetPassword) {
      // ログイン状態でも reset-password 画面はそのまま表示する
      return;
    } else {
      // オンボーディング廃止: onboarded フラグでの /onboarding 誘導を撤去 (migration 適用
      // タイミングと無関係に全員フィードへ)。認証画面 / 旧オンボ画面に居る既ログイン
      // ユーザーだけフィードへ送る。
      if (inAuth || inOnboarding) router.replace('/(tabs)/feed');
    }
  }, [user, authHydrated, segments, router]);

  // ★ セキュリティ (監査 S-7): signOut 時に React Query の in-memory + 永続キャッシュを破棄する。
  //   無いと共有端末で前ユーザーの個人データ (保存/いいね/通知/マイページ統計、特に userId
  //   非スコープの ['my-likes'] 等) が次ユーザーの refetch 完了まで表示され、disk にも最大 2h 残る。
  //   「非 null → null 遷移時のみ」発火させる (素朴な if(!user) は cold start のログイン前や
  //   401→refresh 中の一時 null でも誤発火してキャッシュを無駄に消すため ref でガード)。
  const wasAuthedRef = useRef(false);
  useEffect(() => {
    if (!authHydrated) return;
    if (user) {
      wasAuthedRef.current = true;
      return;
    }
    if (wasAuthedRef.current) {
      wasAuthedRef.current = false;
      qc.clear();
      // removeClient 必須 — 無いと次回 cold start で disk から前ユーザー分が復元され再発する
      void persister.removeClient?.();
    }
  }, [authHydrated, user]);

  if (!ready) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView
        style={{ flex: 1, backgroundColor: C.bg }}
        onLayout={onLayoutRootView}
      >
        <SafeAreaProvider>
          <PersistQueryClientProvider
            client={qc}
            persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 2, buster: PERSIST_BUSTER }}
          >
            <BottomSheetModalProvider>
              {/* ★ key={resolvedTheme} で theme 切替時に全 navigation tree を
                  remount し、static `import { C }` を持つ全コンポーネントを
                  新パレットで再描画させる。テーマ切替は頻度低いので許容。 */}
              <View key={resolvedTheme} style={{ flex: 1, backgroundColor: C.bg }}>
                <StatusBar style={resolvedTheme === 'light' ? 'dark' : 'light'} />
                {/* User-scoped realtime channel — notifications / feature_flags /
                    bookmark_collections / saved_searches / user_stamps を 1 channel に集約。
                    Audit E#3 + E#5 対策 (旧構成は 5 channel + parallel singleton 1 で計 6 個)。 */}
                <RealtimeRoot />
                <OfflineBanner />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: C.bg },
                    // ios_from_right: iOS はネイティブ既定 push (不変)、Android のみ iOS 風の
                    // 右→左 push + 視差で質感統一 (slide_from_right より自然)。
                    animation: 'ios_from_right',
                    // パフォーマンス監査: Platform 別に最適化。
                    //   iOS: 220ms (自然な感じ)
                    //   Android: 160ms (slow device で sluggish 感を緩和)
                    //   Web: 180ms (Safari 体感重さ削減)
                    animationDuration: Platform.select({ ios: 220, android: 160, web: 180, default: 200 }),
                    // 裏画面を react-freeze で凍結 (native のみ・Web は no-op)。Fabric では
                    // focused 直下 1 枚と iOS modal は凍結除外 (native-stack の shouldFreeze
                    // ガード) — 効くのは深さ 2 以上: 例 (tabs)→post/[id]→post/comment 中の
                    // (tabs)。modal 1 枚では背面は凍結されない (仕様・回帰ではない)。
                    freezeOnBlur: true,
                  }}
                >
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="onboarding" />
                  <Stack.Screen
                    name="post/create"
                    options={{
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                    }}
                  />
                  {/* 全画面コメント作成 (Instagram/Threads 風の遷移)。
                      静的セグメント "comment" は post/[id] (UUID) より優先される。 */}
                  <Stack.Screen
                    name="post/comment"
                    options={{
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                    }}
                  />
                  {/* post 詳細は iOS-native の modal slide-up で表示 (別ページ感を解消)。
                      タップした投稿カードが画面下から「上に来る」演出 + 戻ると feed そのまま。
                      gestureDirection: 'vertical' で下スワイプ close 有効。
                      ★ Reddit iOS 風 "ぬるぬる" 化:
                        - animationDuration: 380ms — 220ms より少し長くすることで slide が
                          柔らかく粘る (カードが画面下から上に上がるような体感)。
                        - animationTypeForReplace: 'push' — 戻り (router.back) 時のリプレース
                          挙動を push と揃え、不自然な「ピョコ」と消える挙動を抑制。
                        - 詳細画面ルート側で entering scale 0.94→1.0 + fade を当てており、
                          modal slide-up と組み合わさって "カードが lift up して展開する" 錯視。 */}
                  <Stack.Screen
                    name="post/[id]"
                    options={{
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                      animationDuration: 380,
                      animationTypeForReplace: 'push',
                      gestureDirection: 'vertical',
                    }}
                  />
                  <Stack.Screen name="tag/[name]" />
                  <Stack.Screen
                    name="filter/index"
                    options={{
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                    }}
                  />
                  <Stack.Screen name="notifications/index" />
                  <Stack.Screen name="settings/index" />
                  <Stack.Screen name="settings/profile-edit" />
                  <Stack.Screen name="settings/trust-score" />
                  <Stack.Screen name="settings/plan" />
                  <Stack.Screen name="settings/notifications" />
                  <Stack.Screen name="settings/language" />
                  <Stack.Screen name="settings/appearance" />
                  <Stack.Screen name="settings/blocked-users" />
                  <Stack.Screen name="settings/blocked-tags" />
                  <Stack.Screen name="settings/feedback-admin" />
                  <Stack.Screen name="settings/privacy" />
                  <Stack.Screen name="settings/about" />
                  <Stack.Screen name="corners/calendar" />
                  <Stack.Screen name="corners/map" />
                  <Stack.Screen name="corners/goods" />
                  <Stack.Screen name="corners/friends" />
                  {/* BBS スレ詳細も同じく modal slide-up (投稿詳細と挙動を統一) +
                      Reddit iOS 風 "ぬるぬる" 化 (post/[id] と同パラメータ) */}
                  <Stack.Screen
                    name="bbs/[id]"
                    options={{
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                      animationDuration: 380,
                      animationTypeForReplace: 'push',
                      gestureDirection: 'vertical',
                    }}
                  />
                  <Stack.Screen name="bbs/create" />
                  <Stack.Screen name="search" />
                  <Stack.Screen name="mypage/saved" />
                  <Stack.Screen name="mypage/liked" />
                  <Stack.Screen name="mypage/posts" />
                  <Stack.Screen name="mypage/friends/index" />
                  <Stack.Screen name="mypage/friends/invite" />
                  <Stack.Screen name="mypage/album/[id]" />
                  <Stack.Screen name="mypage/photo/[id]" />
                  <Stack.Screen name="mypage/photo/[id]/edit" />
                  <Stack.Screen name="mypage/photo/add" />
                  <Stack.Screen name="invite/[code]" />
                  {/* community/* routes live inside (tabs)/community/ so the
                      bottom tab bar stays visible on detail / sub-routes. */}
                  {/* 隠し開発者 admin panel — /admin URL 直打ちのみで到達。
                      app 内ナビゲーションには一切リンクを生やさない。 */}
                  <Stack.Screen name="admin" />
                  {/* 公式コミュ管理者向け developer-facing 管理画面 — /official URL のみ。
                      gating は app/official/_layout.tsx で client-side、書き込みは
                      RLS で official_admin_user_id チェックして守られる。 */}
                  <Stack.Screen name="official" />
                  <Stack.Screen
                    name="image-cropper"
                    options={{
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                    }}
                  />
                  <Stack.Screen
                    name="photo-editor"
                    options={{
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                    }}
                  />
                  <Stack.Screen name="settings/obsidian" />
                  <Stack.Screen name="settings/terms" />
                  <Stack.Screen name="settings/privacy-policy" />
                  <Stack.Screen name="settings/help" />
                  <Stack.Screen name="settings/license" />
                </Stack>
                <ToastHost />
                {/* 全画面動画ビューア (画像 ImageLightbox の動画版・アプリ全体で 1 つ常駐) */}
                <VideoLightbox />
                {/* FeedbackFAB は lazy で起動チャンクから外す — feature flag 経由でしか
                    rendered されない上、初期描画クリティカルパスに不要。Suspense fallback
                    は何も描画しない (FAB なので空でも UX 影響なし)。 */}
                <Suspense fallback={null}>
                  <FeedbackFAB />
                </Suspense>
                {/* 初回起動時のイントロ — lazy 経由でロード。
                    Suspense fallback は null (intro が表示されるまでの 1-2 フレームは
                    GestureHandlerRootView の C.bg がベースで黒画面なので違和感なし。) */}
                {!introDone && !introReplaying && (
                  <Suspense fallback={null}>
                    <IntroAnimation
                      onComplete={() => {
                        markIntroShown();
                        markIntroSeenForSession();  // 同セッション内の再表示を抑制
                        setIntroDone(true);
                      }}
                    />
                  </Suspense>
                )}
                {/* 設定からの「再生」リクエスト — key を変えて強制リマウント */}
                {introReplaying && (
                  <Suspense fallback={null}>
                    <IntroAnimation
                      key={introReplayKey}
                      onComplete={finishIntroReplay}
                    />
                  </Suspense>
                )}
              </View>
            </BottomSheetModalProvider>
          </PersistQueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

// ネットワーク復活時の保留中アクション再実行は、OfflineBanner 内部の
// useOfflineQueue() が legacy useOfflineQueueProcessor を wrap して起動するため、
// ここに専用 Runner を置く必要は無い。OfflineBanner は SafeAreaProvider /
// PersistQueryClientProvider の中に配置されているので useQueryClient() の
// 制約も満たしている。

// ============================================================
// RealtimeRoot — user-scoped realtime を 1 channel に集約する子コンポーネント
// ============================================================
// useQueryClient を呼ぶため PersistQueryClientProvider の中に置く必要がある。
// RootLayout に直接 useUserChannel() を書くと QueryClient が未公開な段階で
// hook が走るので、tiny child に分離する。
function RealtimeRoot(): null {
  useUserChannel();
  return null;
}
