import { useEffect, useCallback, useState } from 'react';
import { View, Text, Pressable, Platform, TextInput, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { useAppFonts } from '../../geek-v4/hooks/useAppFonts';
import { useAuthStore } from '../../geek-v4/stores/authStore';
import { useSettingsStore } from '../../geek-v4/stores/settingsStore';
import { ToastHost } from '../../geek-v4/components/ui/ToastHost';
import { ErrorBoundary } from '../../geek-v4/components/ui/ErrorBoundary';
import { C } from '../../geek-v4/design/tokens';
import { T as T_, FONT as FONT_ } from '../../geek-v4/design/typography';

// T / FONT は geek-v4 側で型付けされているが、geek-admin の node_modules と
// react-native の型が別実体になっているので、ここでは any で受け直して
// 型の二重定義によるエラーを抑える。
const T: Record<string, any> = T_;
const FONT: Record<string, any> = FONT_;

SplashScreen.preventAutoHideAsync().catch(() => {});

const ADMIN_EMAIL = 'siturt0330@gmail.com';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1_000 * 60 * 60 * 24,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      refetchOnMount: true,
      retry: 1,
      retryDelay: (attemptIndex: number) =>
        Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: { retry: 0 },
  },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);

  useEffect(() => {
    void hydrateAuth();
    void hydrateSettings();
  }, [hydrateAuth, hydrateSettings]);

  // Safety: force-render after 1.2 s even if hydration stalls.
  const [forceReady, setForceReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setForceReady(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const ready = (fontsLoaded && authHydrated && settingsHydrated) || forceReady;

  const onLayoutRootView = useCallback(async () => {
    if (ready) await SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const isAdmin = !!user && user.email === ADMIN_EMAIL;

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
                {isAdmin ? (
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: C.bg },
                      animation: 'slide_from_right',
                      animationDuration: 220,
                    }}
                  >
                    <Stack.Screen name="index" />
                    <Stack.Screen name="user/[id]" />
                    <Stack.Screen name="post/[id]" />
                    <Stack.Screen name="message/[userId]" />
                  </Stack>
                ) : (
                  <AdminLogin loggedInEmail={user?.email ?? null} />
                )}
                <ToastHost />
              </View>
            </BottomSheetModalProvider>
          </PersistQueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

// ============================================================
// AdminLogin
//   geek-admin は本体アプリと別 origin なので、Supabase の AsyncStorage
//   session は共有されない。よって自前で最小限のログイン UI を持つ。
//   許可するのは ADMIN_EMAIL ただ 1 人 — それ以外の認証成功は即サインアウトして弾く。
//   サーバー側でも is_admin() RLS でガードされているので、UI を抜けても
//   実データは取れない (= 二重防衛)。
// ============================================================
function AdminLogin({ loggedInEmail }: { loggedInEmail: string | null }) {
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async () => {
    if (pending) return;
    setPending(true);
    setErrorMsg(null);
    try {
      if (email.trim() !== ADMIN_EMAIL) {
        setErrorMsg('このメールアドレスではこの管理画面にアクセスできません');
        setPending(false);
        return;
      }
      const result = await signIn(email.trim(), password);
      if (result.error) {
        setErrorMsg(result.error);
      }
    } finally {
      setPending(false);
    }
  };

  const wrongUserSignOut = async () => {
    setPending(true);
    try {
      await signOut();
    } finally {
      setPending(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: C.bg,
      }}
    >
      <View style={{ maxWidth: 380, width: '100%' }}>
        <Text
          style={[T.h1, { color: C.text, fontFamily: FONT.display, marginBottom: 6, letterSpacing: -0.5 }]}
        >
          Geek Admin
        </Text>
        <Text style={[T.body, { color: C.text2, marginBottom: 28 }]}>
          開発者専用 — 顧客管理ツール
        </Text>

        {loggedInEmail && loggedInEmail !== ADMIN_EMAIL ? (
          // 既に別アカでログイン済み → サインアウトを促す
          <View
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: C.bg2,
              borderWidth: 1,
              borderColor: C.border,
              gap: 12,
            }}
          >
            <Text style={[T.body, { color: C.text }]}>
              現在 <Text style={{ color: C.accent, fontWeight: '700' }}>{loggedInEmail}</Text> でログイン中。
            </Text>
            <Text style={[T.caption, { color: C.text2 }]}>
              このアカウントには管理画面の権限がありません。サインアウトして {ADMIN_EMAIL} で再ログインしてください。
            </Text>
            <Pressable
              onPress={wrongUserSignOut}
              disabled={pending}
              style={{
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor: C.accent,
                alignItems: 'center',
                opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[T.body, { color: '#fff', fontWeight: '700' }]}>サインアウト</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <View>
              <Text style={[T.caption, { color: C.text3, marginBottom: 6 }]}>メール</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="admin@example.com"
                placeholderTextColor={C.text3}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor: C.bg2,
                  borderWidth: 1,
                  borderColor: C.border,
                  color: C.text,
                  fontSize: 15,
                }}
              />
            </View>
            <View>
              <Text style={[T.caption, { color: C.text3, marginBottom: 6 }]}>パスワード</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                placeholder="••••••••"
                placeholderTextColor={C.text3}
                onSubmitEditing={onSubmit}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor: C.bg2,
                  borderWidth: 1,
                  borderColor: C.border,
                  color: C.text,
                  fontSize: 15,
                }}
              />
            </View>
            {errorMsg && (
              <Text style={[T.caption, { color: '#ff6b6b' }]}>{errorMsg}</Text>
            )}
            <Pressable
              onPress={onSubmit}
              disabled={pending || !password}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 10,
                backgroundColor: C.accent,
                alignItems: 'center',
                opacity: pending || !password ? 0.6 : 1,
              }}
            >
              {pending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[T.body, { color: '#fff', fontWeight: '700' }]}>ログイン</Text>
              )}
            </Pressable>
            <Text style={{ ...T.caption, color: C.text3, marginTop: 12, textAlign: 'center' }}>
              {ADMIN_EMAIL} 以外はアクセス拒否されます
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
