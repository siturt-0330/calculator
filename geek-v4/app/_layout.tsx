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
import { useAppFonts } from '@/hooks/useAppFonts';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLanguageStore } from '@/stores/languageStore';
import { ToastHost } from '@/components/ui/ToastHost';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { IntroAnimation, markIntroShown } from '@/components/ui/IntroAnimation';
import { initAnalytics } from '@/lib/analytics';
import { initSentry } from '@/lib/sentry';
import { C } from '@/design/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

if (!__DEV__) initSentry();
initAnalytics();

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1_000 * 60 * 60 * 24,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

function shouldShowIntro(): boolean {
  // 毎回ページがロードされる時に必ずイントロを再生
  // ただし SSR 時は再生しない
  if (Platform.OS !== 'web') return true;
  if (typeof window === 'undefined') return false;
  return true;
}

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const { hydrate: hydrateAuth, hydrated: authHydrated, user } = useAuthStore();
  const { hydrate: hydrateSettings, hydrated: settingsHydrated } = useSettingsStore();
  const router = useRouter();
  const segments = useSegments();
  const [introDone, setIntroDone] = useState<boolean>(() => !shouldShowIntro());

  const hydrateLang = useLanguageStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateAuth();
    void hydrateSettings();
    void hydrateLang();
  }, [hydrateAuth, hydrateSettings, hydrateLang]);

  // ★ Safety: hydration / font 読み込みが何らかの理由で詰まっても、
  //   2.5 秒で強制的にレンダー開始 (黒画面のまま止まるのを絶対に防ぐ)
  const [forceReady, setForceReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setForceReady(true), 2500);
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

    if (!user) {
      if (!inAuth) router.replace('/(auth)/login');
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
            <BottomSheetModalProvider>
              <View style={{ flex: 1, backgroundColor: C.bg }}>
                <StatusBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: C.bg },
                    animation: 'slide_from_right',
                    animationDuration: 280,
                  }}
                >
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="onboarding" />
                  <Stack.Screen name="onboarding/language" />
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
                  <Stack.Screen name="oshi/tag-graph" />
                  <Stack.Screen name="settings/terms" />
                  <Stack.Screen name="settings/privacy-policy" />
                  <Stack.Screen name="settings/help" />
                  <Stack.Screen name="settings/license" />
                </Stack>
                <ToastHost />
                {!introDone && (
                  <IntroAnimation onComplete={() => { markIntroShown(); setIntroDone(true); }} />
                )}
              </View>
            </BottomSheetModalProvider>
          </PersistQueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
