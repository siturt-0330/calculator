import { useEffect, useCallback } from 'react';
import { View } from 'react-native';
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
import { ToastHost } from '@/components/ui/ToastHost';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
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

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const { hydrate: hydrateAuth, hydrated: authHydrated, user } = useAuthStore();
  const { hydrate: hydrateSettings, hydrated: settingsHydrated } = useSettingsStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    hydrateAuth();
    hydrateSettings();
  }, [hydrateAuth, hydrateSettings]);

  const ready = fontsLoaded && authHydrated && settingsHydrated;

  const onLayoutRootView = useCallback(async () => {
    if (ready) await SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';

    if (!user && !inAuth) {
      router.replace('/(auth)/login');
    } else if (user && !user.onboarded && !inOnboarding) {
      router.replace('/onboarding');
    } else if (user && user.onboarded && (inAuth || inOnboarding)) {
      router.replace('/(tabs)/feed');
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
                </Stack>
                <ToastHost />
              </View>
            </BottomSheetModalProvider>
          </PersistQueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
