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

SplashScreen.preventAutoHideAsync().catch(() => {});

if (!__DEV__) initSentry();
initAnalytics();
// initWebVitals は useEffect 内で cleanup 込みで呼ぶ — listener が leak しないように

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 秒は同じデータを再 fetch しない (network roundtrip 大幅削減)
      staleTime: 30_000,
      // 24h までキャッシュ保持 — persister と整合する長さ
      gcTime: 1_000 * 60 * 60 * 24,
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
  const { hydrate: hydrateAuth, hydrated: authHydrated, user } = useAuthStore();
  const { hydrate: hydrateSettings, hydrated: settingsHydrated } = useSettingsStore();
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
  const hydrateTagFilter = useTagFilterStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateAuth();
    void hydrateSettings();
    void hydrateLang();
    void hydrateTagFilter();
  }, [hydrateAuth, hydrateSettings, hydrateLang, hydrateTagFilter]);

  // Web Vitals 初期化 — cleanup 関数を握って unmount 時に observer + listener を解放
  useEffect(() => {
    const cleanup = initWebVitals();
    return cleanup;
  }, []);

  // ★ Safety: hydration / font 読み込みが何らかの理由で詰まっても、
  //   1.2 秒で強制的にレンダー開始 (黒画面のまま止まるのを絶対に防ぐ)。
  //   旧 2.5 秒は安全マージンが大きすぎて、ネットワーク遅延時に体感ラグの原因に。
  const [forceReady, setForceReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setForceReady(true), 1200);
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
            persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}
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
                    // 280ms → 220ms: 画面遷移を一段速く (体感 sluggish 感を削減)
                    animationDuration: 220,
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
