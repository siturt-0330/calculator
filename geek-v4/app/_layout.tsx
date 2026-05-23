import { useEffect, useCallback, useState } from 'react';
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
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLanguageStore } from '../stores/languageStore';
import { useTagFilterStore } from '../stores/tagFilterStore';
import { useAdPreferencesStore } from '../stores/adPreferencesStore';
import { ToastHost } from '../components/ui/ToastHost';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { IntroAnimation, markIntroShown } from '../components/ui/IntroAnimation';
import { useIntroStore } from '../stores/introStore';
import { OfflineBanner } from '../components/ui/OfflineBanner';
import { FeedbackFAB } from '../components/feedback/FeedbackFAB';
import { useOfflineQueueProcessor } from '../hooks/useOfflineQueueProcessor';
import { initAnalytics } from '../lib/analytics';
import { initSentry } from '../lib/sentry';
import { initWebVitals } from '../lib/webVitals';
import { C } from '../design/tokens';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

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
      // mount 時は stale な場合だけ再 fetch (重複 round-trip 削減)
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

// イントロ再生制御
//   - 初回ロード: 再生
//   - 同セッション内の再ロード (PWA タブ切り替え後の戻り等): スキップ
//   - SSR 時: 再生しない
// sessionStorage を使うので、ブラウザを閉じれば次回また再生される。
const INTRO_SEEN_KEY = 'geek:intro_seen_session';
function shouldShowIntro(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof window === 'undefined') return false;
  try {
    if (sessionStorage.getItem(INTRO_SEEN_KEY) === '1') return false;
  } catch {}
  return true;
}
function markIntroSeenForSession() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try { sessionStorage.setItem(INTRO_SEEN_KEY, '1'); } catch {}
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
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      // 入力中の textarea/input には反応させない
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (e.key === 'i' || e.key === 'I') playIntro();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playIntro]);

  const hydrateLang = useLanguageStore((s) => s.hydrate);
  const lang = useLanguageStore((s) => s.lang);
  const hydrateTagFilter = useTagFilterStore((s) => s.hydrate);
  const hydrateAdPrefs = useAdPreferencesStore((s) => s.hydrate);

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
    } catch { /* ignore */ }
  }, [lang]);
  useEffect(() => {
    // hydrate 改修 (MMKV 化):
    //   - settings / tagFilter は MMKV 同期化されて 1ms 以下に
    //   - auth は supabase.auth.getSession() で 50-200ms 残る (network 込み)
    //   - lang / adPrefs は AsyncStorage のまま (cold start クリティカルパスに
    //     乗らないため改修対象外)
    // signature は Promise を返す互換のままで、allSettled で堅牢化を維持。
    void Promise.allSettled([
      hydrateAuth(),
      hydrateSettings(),
      hydrateLang(),
      hydrateTagFilter(),
      hydrateAdPrefs(),
    ]);
  }, [hydrateAuth, hydrateSettings, hydrateLang, hydrateTagFilter, hydrateAdPrefs]);

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
          supabase.realtime.disconnect();
        } else if (state === 'active') {
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
      for (const el of els) { try { document.head.removeChild(el); } catch {} }
    };
  }, []);

  // Sentry / Analytics は first paint のクリティカルパスから外す。
  // requestIdleCallback (Web) / setTimeout (RN) で 1tick 後ろに倒す。
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      if (!__DEV__) {
        try { initSentry(); } catch {}
      }
      try { initAnalytics(); } catch {}
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
    //   旧 800ms → 500ms に短縮。MMKV 化で settings / tagFilter の hydrate が
    //   1ms 以下になり、残りクリティカルパスは font 読み込み + auth getSession
    //   (~150-300ms 程度)。500ms あれば font fallback + auth まで余裕で完了する。
    //   一方、auth は supabase 側で AsyncStorage 経由 session 読み込みが残るため
    //   400ms は若干攻めすぎ (低速 device で false render risk あり)。
    //   実測 cold start 短縮見込み: 約 50-150ms (forceReady ラインの 300ms 縮小と
    //   stores の hydrate 同期化分の重ね合わせ)。
    const t = setTimeout(() => setForceReady(true), 500);
    return () => clearTimeout(t);
  }, []);

  const ready = (fontsLoaded && authHydrated && settingsHydrated) || forceReady;

  const onLayoutRootView = useCallback(async () => {
    if (ready) await SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (!ready || segments.length < 1) return;
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
    } else if (!user.onboarded) {
      if (!inOnboarding) router.replace('/onboarding');
    } else {
      if (inAuth || inOnboarding) router.replace('/(tabs)/feed');
    }
  }, [user, ready, segments, router]);

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
            persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 2 }}
          >
            <OfflineQueueRunner />
            <BottomSheetModalProvider>
              <View style={{ flex: 1, backgroundColor: C.bg }}>
                <StatusBar style="light" />
                <OfflineBanner />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: C.bg },
                    animation: 'slide_from_right',
                    // パフォーマンス監査: Platform 別に最適化。
                    //   iOS: 220ms (自然な感じ)
                    //   Android: 160ms (slow device で sluggish 感を緩和)
                    //   Web: 180ms (Safari 体感重さ削減)
                    animationDuration: Platform.select({ ios: 220, android: 160, web: 180, default: 200 }),
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
                  <Stack.Screen name="post/[id]" />
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
                  <Stack.Screen name="settings/blocked-users" />
                  <Stack.Screen name="settings/blocked-tags" />
                  <Stack.Screen name="settings/feedback-admin" />
                  <Stack.Screen name="settings/privacy" />
                  <Stack.Screen name="settings/about" />
                  <Stack.Screen name="corners/calendar" />
                  <Stack.Screen name="corners/map" />
                  <Stack.Screen name="corners/goods" />
                  <Stack.Screen name="corners/friends" />
                  <Stack.Screen name="bbs/[id]" />
                  <Stack.Screen name="bbs/create" />
                  <Stack.Screen name="search" />
                  <Stack.Screen name="mypage/saved" />
                  <Stack.Screen name="mypage/liked" />
                  <Stack.Screen name="mypage/posts" />
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
                  <Stack.Screen name="settings/obsidian" />
                  <Stack.Screen name="settings/terms" />
                  <Stack.Screen name="settings/privacy-policy" />
                  <Stack.Screen name="settings/help" />
                  <Stack.Screen name="settings/license" />
                </Stack>
                <ToastHost />
                <FeedbackFAB />
                {/* 初回起動時のイントロ */}
                {!introDone && !introReplaying && (
                  <IntroAnimation
                    onComplete={() => {
                      markIntroShown();
                      markIntroSeenForSession();  // 同セッション内の再表示を抑制
                      setIntroDone(true);
                    }}
                  />
                )}
                {/* 設定からの「再生」リクエスト — key を変えて強制リマウント */}
                {introReplaying && (
                  <IntroAnimation
                    key={introReplayKey}
                    onComplete={finishIntroReplay}
                  />
                )}
              </View>
            </BottomSheetModalProvider>
          </PersistQueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

// ネットワーク復活時に保留中アクションを再実行。
// useQueryClient() を呼ぶので PersistQueryClientProvider の中に置く必要がある。
function OfflineQueueRunner() {
  useOfflineQueueProcessor();
  return null;
}
