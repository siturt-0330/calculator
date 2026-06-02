import { View, Text, KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { useState, useRef } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { R, SP } from '../../design/tokens';
import { useColors } from '../../hooks/useColors';
import { T, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PressableScale } from '../../components/ui/PressableScale';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { checkRate, rateLimitMessage } from '../../lib/rateLimit';
import { useT } from '../../hooks/useT';
import { Icon } from '../../constants/icons';

export default function LoginScreen() {
  const params = useLocalSearchParams();
  const presetEmail = typeof params.email === 'string' ? params.email : '';
  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [credErrorBanner, setCredErrorBanner] = useState(false);
  const [needsConfirmBanner, setNeedsConfirmBanner] = useState(false);
  const [resending, setResending] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  // selector 化: store 全体 subscribe → 必要な action のみ → 不要 re-render 削減
  const signIn = useAuthStore((s) => s.signIn);
  const show = useToastStore((s) => s.show);
  const t = useT();
  const { online } = useNetworkStatus();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const EyeIcon = showPass ? Icon.eyeOff : Icon.eye;
  const MailIcon = Icon.at;
  // テーマ購読 — ライト/ダーク両対応
  const C = useColors();

  // 厳しめのメール正規表現 — 1 文字ドメイン (a@b.c) を弾く
  // TLD は最低 2 文字必要、@ 前後は単純な英数記号許可
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const handleLogin = async () => {
    if (loading) return;  // 二重 submit 防止
    if (!online) {
      show('オフラインです。インターネット接続を確認してください。', 'error');
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      show('メールアドレスとパスワードを入力してください。', 'warn');
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      show('メールアドレスの形式が正しくありません。', 'warn');
      return;
    }
    if (password.length > 72) {
      // Supabase / bcrypt の上限を超えると cryptic エラーになるので事前 reject
      show('パスワードは 72 文字以内にしてください。', 'warn');
      return;
    }
    setLoading(true);
    setCredErrorBanner(false);
    setNeedsConfirmBanner(false);
    // 最終安全タイマー: 18秒経っても応答が無ければ loading 解除 (旧 15s だと
    // 低速回線で authStore の 10s と重なって誤発火)
    const safety = setTimeout(() => {
      setLoading(false);
      show('応答がありません。回線を確認して再度お試しください。', 'error');
    }, 18000);
    let result;
    try {
      result = await signIn(trimmedEmail, password);
    } finally {
      clearTimeout(safety);
      setLoading(false);
    }
    if (result.error) {
      // signIn 側で error.code により分類済 + 文言は日本語に一般化済 (PII 漏れ無し)。
      // ここでは code に応じてバナー/トーストを出し分けるだけ。
      if (result.code === 'invalid_credentials') {
        setCredErrorBanner(true);
        show(result.error, 'warn');
      } else if (result.code === 'email_not_confirmed') {
        setNeedsConfirmBanner(true);
        show(result.error, 'error');
      } else {
        // rate_limited / network / unknown / レート制限 — 既に日本語の安全な文言
        show(result.error, 'error');
      }
      return;
    }
    if (result.next === 'onboarding') {
      router.replace('/onboarding');
    } else {
      router.replace('/(tabs)/feed');
    }
  };

  // 確認メールを再送信
  const handleResendConfirmation = async () => {
    if (resending) return;
    const e = email.trim();
    if (!EMAIL_RE.test(e)) {
      show('メールアドレスを入力してください。', 'warn');
      return;
    }
    if (!online) {
      show('オフラインです。インターネット接続を確認してください。', 'error');
      return;
    }
    const rl = checkRate('password_reset');
    if (!rl.ok) {
      show(rateLimitMessage('password_reset', rl.retryAfterMs), 'warn');
      return;
    }
    setResending(true);
    let networkFailed = false;
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: e });
      if (error) console.warn('[login] resend confirmation failed:', error.message);
    } catch (err) {
      networkFailed = true;
      console.warn('[login] resend confirmation threw:', err);
    } finally {
      setResending(false);
      if (networkFailed) {
        // 通信失敗は端末側の問題でアカウント有無を漏らさない → ネットワークエラーを明示
        // (旧実装は finally で常に「再送しました」を出し、オフラインでも成功と誤表示していた)
        show('再送信に失敗しました。回線を確認してください。', 'error');
      } else {
        // enumeration 回避: アカウント有無に関わらず中立メッセージ
        show('登録済みで未確認の場合は、確認メールを再送しました。受信箱をご確認ください。', 'info');
      }
    }
  };

  const goToSignup = () => {
    // 入力内容を保持したまま signup へ
    router.push({ pathname: '/(auth)/signup', params: { email: email.trim() } } as never);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      {/* Auth screens get a soft top-down accent wash so they feel like a
          "branded" surface instead of a flat form. Very low opacity — the dark
          theme stays dominant. pointerEvents: 'none' で tap を吸わない。 */}
      <LinearGradient
        colors={['rgba(124,106,247,0.10)', 'rgba(10,10,10,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 320 }}
        pointerEvents="none"
      />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + SP['10'],
          paddingBottom: insets.bottom + SP['6'],
          paddingHorizontal: SP['6'],
          justifyContent: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ marginBottom: SP['6'] }}>
          <Text style={[T.display, { fontFamily: LOGO_FONT, fontWeight: LOGO_FONT_WEIGHT, color: C.text, marginBottom: SP['2'], letterSpacing: -0.6 }]}>Geek</Text>
          {/* ログイン画面は他のラベル (メールアドレス/パスワード/ログイン等) も
              全てハードコード日本語。auth.tagline だけ DICT 経由だと lang=en で
              「Love what you love — anonymously, safely.」が混ざる事故が出るため、
              ここも他に揃えて JP 固定。 */}
          <Text style={[T.body, { color: C.text2 }]}>好きを、匿名で、安心して続ける。</Text>
        </View>

        {/* ログイン失敗バナー */}
        {credErrorBanner && (
          <View style={{
            padding: SP['4'],
            backgroundColor: C.amberBg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.amber + '66',
            marginBottom: SP['4'],
            gap: SP['2'],
          }}>
            <Text style={[T.bodyMd, { color: C.amber, fontWeight: '700' }]}>
              ログインできませんでした
            </Text>
            <Text style={[T.small, { color: C.text2 }]}>
              メールアドレスとパスワードを確認してください。アカウントをまだお持ちでない場合は新規登録してください。
            </Text>
            <View style={{ flexDirection: 'row', gap: SP['2'], marginTop: SP['1'] }}>
              <PressableScale
                onPress={() => router.push('/(auth)/forgot-password' as never)}
                haptic="tap"
                style={{ flex: 1, padding: SP['2'], borderRadius: R.md, borderWidth: 1, borderColor: C.border, alignItems: 'center' }}
              >
                <Text style={[T.smallM, { color: C.text }]}>{t('auth.reset_password')}</Text>
              </PressableScale>
              <PressableScale
                onPress={goToSignup}
                haptic="confirm"
                style={{ flex: 1, padding: SP['2'], borderRadius: R.md, backgroundColor: C.accent, alignItems: 'center' }}
              >
                <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>{t('auth.signup')}</Text>
              </PressableScale>
            </View>
          </View>
        )}

        {/* 確認メール未送信バナー */}
        {needsConfirmBanner && (
          <View style={{
            padding: SP['4'],
            backgroundColor: C.amberBg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.amber + '66',
            marginBottom: SP['4'],
            gap: SP['2'],
          }}>
            <Text style={[T.bodyMd, { color: C.amber, fontWeight: '700' }]}>
              確認メール未確認
            </Text>
            <Text style={[T.small, { color: C.text2 }]}>
              受信箱の確認メールリンクをクリックしてください。届いていない場合は再送できます。
            </Text>
            <PressableScale
              onPress={handleResendConfirmation}
              haptic="tap"
              hitSlop={6}
              disabled={resending}
              style={{
                marginTop: SP['1'],
                padding: SP['2'],
                borderRadius: R.md,
                backgroundColor: C.amber,
                alignItems: 'center',
                opacity: resending ? 0.6 : 1,
              }}
            >
              <Text style={[T.smallM, { color: '#000', fontWeight: '700' }]}>
                {resending ? '送信中…' : '確認メールを再送する'}
              </Text>
            </PressableScale>
          </View>
        )}

        <View style={{ gap: SP['4'], marginBottom: SP['6'] }}>
          <Input
            label="メールアドレス"
            icon={MailIcon}
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              // 編集時にエラーバナー auto-dismiss
              if (credErrorBanner) setCredErrorBanner(false);
              if (needsConfirmBanner) setNeedsConfirmBanner(false);
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            keyboardAppearance="dark"
            selectionColor={C.accent}
            // RFC 5321 上限 (memory DoS 対策)
            maxLength={254}
          />
          <Input
            ref={passwordRef}
            label="パスワード"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (credErrorBanner) setCredErrorBanner(false);
            }}
            placeholder="パスワード"
            secureTextEntry={!showPass}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            keyboardAppearance="dark"
            selectionColor={C.accent}
            // bcrypt 上限 = 72 byte。事前 reject (>72) と入力上限を一致させる
            maxLength={72}
            right={
              <PressableScale
                onPress={() => setShowPass((v) => !v)}
                haptic="tap"
                hitSlop={14}
                accessibilityLabel={showPass ? 'パスワードを非表示にする' : 'パスワードを表示する'}
                accessibilityRole="button"
              >
                <EyeIcon size={20} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            }
          />
        </View>

        <View style={{ gap: SP['3'] }}>
          <Button label="ログイン" onPress={handleLogin} loading={loading} />
          <Button
            label="アカウントを作成"
            onPress={() => router.push('/(auth)/signup')}
            variant="ghost"
          />
        </View>

        <PressableScale
          onPress={() => router.push('/(auth)/forgot-password')}
          style={{ alignItems: 'center', marginTop: SP['6'] }}
          haptic="tap"
        >
          <Text style={[T.small, { color: C.text3 }]}>パスワードを忘れた方</Text>
        </PressableScale>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
