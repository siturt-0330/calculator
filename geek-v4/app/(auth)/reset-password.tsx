import { View, Text, KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PressableScale } from '@/components/ui/PressableScale';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { Icon } from '@/constants/icons';

// ============================================================
// パスワードリセット完了画面
// ============================================================
// メールから飛んでくるユーザーが着地する画面。
//
// Supabase は flow type ごとに違う形式で recovery トークンを送ってくる:
//   1) PKCE flow (推奨):
//        ?code=xxxxx  → supabase.auth.exchangeCodeForSession(code)
//   2) Implicit / legacy flow:
//        #access_token=...&refresh_token=...&type=recovery
//        → supabase.auth.setSession({ access_token, refresh_token })
//   3) 旧来の token / type=recovery query (古いダッシュボード設定):
//        ?token=...&type=recovery
//        → supabase.auth.verifyOtp({ token_hash, type: 'recovery' })
//
// 加えて lib/supabase.ts では detectSessionInUrl: false にしてあるので、
// ここで明示的に解決する必要がある。
//
// 成功すれば PASSWORD_RECOVERY イベントが auth state listener に飛び、
// 一時的に session が確立される。その状態で updateUser({ password }) を呼ぶ。
// ============================================================

type Phase =
  | 'loading'      // URL を解決中
  | 'ready'        // パスワード入力可能 (session 確立済み)
  | 'error'        // リンク無効 / 期限切れ / その他
  | 'updating'     // updateUser 実行中
  | 'done';        // 完了

function parseHash(hash: string): Record<string, string> {
  // "#access_token=...&refresh_token=...&type=recovery" → object
  const out: Record<string, string> = {};
  const clean = hash.replace(/^#/, '');
  if (!clean) return out;
  for (const part of clean.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = decodeURIComponent(part.slice(0, eq));
    const v = decodeURIComponent(part.slice(eq + 1));
    out[k] = v;
  }
  return out;
}

function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = search.replace(/^\?/, '');
  if (!clean) return out;
  for (const part of clean.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = decodeURIComponent(part.slice(0, eq));
    const v = decodeURIComponent(part.slice(eq + 1));
    out[k] = v;
  }
  return out;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();
  const setUser = useAuthStore((s) => s.setUser);

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const confirmRef = useRef<TextInput>(null);
  // _layout.tsx 側で reset-password ルートのみ auto-redirect を抑止しているので
  // この画面で session が立ってもタブ画面に攫われない。

  const EyeIcon = showPass ? Icon.eyeOff : Icon.eye;

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        // Native ではメールリンクで普通はブラウザ経由 → web 版に着地する想定。
        // ここで window が無い (= native 直起動) 場合は既存セッションの確認だけ。
        if (Platform.OS !== 'web' || typeof window === 'undefined') {
          const { data } = await supabase.auth.getSession();
          if (cancelled) return;
          if (data?.session) {
            setPhase('ready');
          } else {
            setPhase('error');
            setErrorMsg('リンクから開き直してください。');
          }
          return;
        }

        const { search, hash } = window.location;
        const query = parseQuery(search);
        const frag = parseHash(hash);

        // ----- (a) PKCE flow: ?code=... -----
        if (query.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(query.code);
          if (cancelled) return;
          if (error) {
            setPhase('error');
            setErrorMsg(mapAuthError(error.message));
            return;
          }
          // URL の query を綺麗にする (シェアされた時に code が漏れない)
          try {
            window.history.replaceState({}, '', window.location.pathname);
          } catch {}
          setPhase('ready');
          return;
        }

        // ----- (b) Implicit flow: #access_token + #refresh_token -----
        const access = frag.access_token;
        const refresh = frag.refresh_token;
        const fragType = frag.type;
        if (access && refresh) {
          const { error } = await supabase.auth.setSession({
            access_token: access,
            refresh_token: refresh,
          });
          if (cancelled) return;
          if (error) {
            setPhase('error');
            setErrorMsg(mapAuthError(error.message));
            return;
          }
          try {
            window.history.replaceState({}, '', window.location.pathname);
          } catch {}
          // type が recovery 以外 (例: signup confirm) でも、ここに来てるなら
          // とりあえずパスワード変更フローを通す
          void fragType;
          setPhase('ready');
          return;
        }

        // ----- (c) Legacy: ?token=...&type=recovery -----
        const tokenHash = query.token_hash ?? query.token;
        const queryType = query.type;
        if (tokenHash && (queryType === 'recovery' || !queryType)) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });
          if (cancelled) return;
          if (error) {
            setPhase('error');
            setErrorMsg(mapAuthError(error.message));
            return;
          }
          try {
            window.history.replaceState({}, '', window.location.pathname);
          } catch {}
          setPhase('ready');
          return;
        }

        // ----- (d) Supabase の error fragment が直接届くケース -----
        // 例: #error=access_denied&error_description=Email+link+is+invalid+or+has+expired
        if (frag.error || frag.error_description) {
          setPhase('error');
          setErrorMsg(mapAuthError(frag.error_description ?? frag.error ?? ''));
          return;
        }

        // ----- (e) URL に何も無い: 既存セッションが既にあるなら ready -----
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data?.session) {
          setPhase('ready');
        } else {
          setPhase('error');
          setErrorMsg('リセットリンクが無効です。もう一度メールから開いてください。');
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'リンクの確認中にエラーが発生しました。';
        setPhase('error');
        setErrorMsg(msg);
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async () => {
    if (phase !== 'ready' && phase !== 'updating') return;
    if (password.length < 8) {
      show('パスワードは 8 文字以上にしてください。', 'warn');
      return;
    }
    if (password.length > 72) {
      show('パスワードは 72 文字以内にしてください。', 'warn');
      return;
    }
    if (password !== confirm) {
      show('パスワードが一致しません。', 'warn');
      return;
    }
    setPhase('updating');
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPhase('ready');
      show(mapAuthError(error.message), 'error');
      return;
    }
    // 成功: session が一旦有効なまま残るが、ユーザーには明示的に再ログインさせる
    setPhase('done');
    show('パスワードを更新しました。再度ログインしてください。', 'success');
    // local の auth store もクリアして、_layout の auto-redirect に乗せる
    try {
      await supabase.auth.signOut();
    } catch {}
    setUser(null);
    // user email が分かれば prefill して login に飛ばす
    const email = data?.user?.email;
    setTimeout(() => {
      router.replace({ pathname: '/(auth)/login', params: email ? { email } : {} } as never);
    }, 600);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + SP['10'],
          paddingBottom: insets.bottom + SP['6'],
          paddingHorizontal: SP['6'],
          gap: SP['6'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>新しいパスワード</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            8〜72 文字の新しいパスワードを設定してください。
          </Text>
        </View>

        {phase === 'loading' && (
          <View
            style={{
              padding: SP['4'],
              backgroundColor: C.bg3,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
              リンクを確認しています…
            </Text>
          </View>
        )}

        {phase === 'error' && (
          <View
            style={{
              padding: SP['4'],
              backgroundColor: C.amberBg,
              borderRadius: R.lg,
              borderWidth: 1,
              borderColor: C.amber + '66',
              gap: SP['2'],
            }}
          >
            <Text style={[T.bodyMd, { color: C.amber, fontWeight: '700' }]}>
              リンクが無効です
            </Text>
            <Text style={[T.small, { color: C.text2 }]}>
              {errorMsg ||
                'メール内のリンクが期限切れか、既に使用されています。もう一度パスワードリセットをお試しください。'}
            </Text>
            <PressableScale
              onPress={() => router.replace('/(auth)/forgot-password' as never)}
              haptic="tap"
              style={{
                marginTop: SP['2'],
                padding: SP['2'],
                borderRadius: R.md,
                backgroundColor: C.amber,
                alignItems: 'center',
              }}
            >
              <Text style={[T.smallM, { color: '#000', fontWeight: '700' }]}>
                もう一度送信する
              </Text>
            </PressableScale>
          </View>
        )}

        {(phase === 'ready' || phase === 'updating' || phase === 'done') && (
          <View style={{ gap: SP['4'] }}>
            <Input
              label="新しいパスワード"
              value={password}
              onChangeText={setPassword}
              placeholder="8 文字以上"
              secureTextEntry={!showPass}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
              autoFocus
              keyboardAppearance="dark"
              selectionColor={C.accent}
              editable={phase === 'ready'}
              right={
                <PressableScale
                  onPress={() => setShowPass((v) => !v)}
                  haptic="tap"
                  hitSlop={14}
                  accessibilityLabel={
                    showPass ? 'パスワードを非表示にする' : 'パスワードを表示する'
                  }
                  accessibilityRole="button"
                >
                  <EyeIcon size={20} color={C.text3} strokeWidth={2.2} />
                </PressableScale>
              }
            />
            <Input
              ref={confirmRef}
              label="もう一度入力"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="同じパスワード"
              secureTextEntry={!showPass}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              keyboardAppearance="dark"
              selectionColor={C.accent}
              editable={phase === 'ready'}
            />
            <Button
              label={phase === 'done' ? '更新完了' : '新しいパスワードを設定'}
              onPress={handleSubmit}
              loading={phase === 'updating'}
              disabled={phase === 'done'}
            />
          </View>
        )}

        <PressableScale
          onPress={() => router.replace('/(auth)/login' as never)}
          style={{ alignItems: 'center', marginTop: SP['2'] }}
          haptic="tap"
        >
          <Text style={[T.small, { color: C.text3 }]}>ログイン画面に戻る</Text>
        </PressableScale>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Supabase のエラーメッセージを日本語に丸める
function mapAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('expired') || m.includes('invalid or has expired')) {
    return 'リンクの有効期限が切れています。もう一度メールを送信してください。';
  }
  if (m.includes('invalid') && m.includes('token')) {
    return 'リンクが無効です。もう一度メールを送信してください。';
  }
  if (m.includes('already been used') || m.includes('used')) {
    return 'このリンクは既に使用されています。新しいリンクをリクエストしてください。';
  }
  if (m.includes('access_denied') || m.includes('access denied')) {
    return 'リンクが無効化されています。新しいリンクをリクエストしてください。';
  }
  if (m.includes('password') && (m.includes('short') || m.includes('weak') || m.includes('at least'))) {
    return 'パスワードがセキュリティ要件を満たしていません。8 文字以上にしてください。';
  }
  if (m.includes('rate') || m.includes('too many')) {
    return '試行が多すぎます。少し時間を置いてからお試しください。';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'ネットワークエラー。接続を確認してください。';
  }
  return raw || 'エラーが発生しました。';
}
