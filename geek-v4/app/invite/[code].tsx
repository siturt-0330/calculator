// ============================================================
// app/invite/[code].tsx — Universal link 受け口
// ============================================================
// 招待リンク https://.../invite/<code> で開かれた時にここに来る。
// - 未ログインなら /(auth)/login へ redirect (code を pending state で保持)
// - ログイン済なら useAcceptInvite を即実行 (useEffect で 1 回だけ)
// - 成功: toast → router.replace('/mypage/friends')
// - 失敗: エラーメッセージ + 「友達一覧に戻る」 button
// - Loading 中は ActivityIndicator
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../constants/icons';
import { useAcceptInvite } from '../../hooks/useFriendInvites';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { isValidShortId } from '../../lib/validation';

// pending invite code を localStorage / MMKV に保存する key。
// 未ログイン → /auth/login → login 成功時にこの key を読んで /invite/<code> に戻す。
const PENDING_INVITE_KEY = 'geek-v4-pending-invite-code';

export default function InviteAcceptScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  // route param を short ID validation して cache 汚染 + 無駄な API 叩きを防ぐ
  // (詳細は lib/validation.ts). invite code は friends API 側で 64 文字以下の
  // ランダム英数字なので、それを超える / 記号混じり / 空 を弾けば十分。
  const rawCode = params.code;
  const code = isValidShortId(rawCode) ? rawCode : undefined;
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const show = useToastStore((s) => s.show);
  const accept = useAcceptInvite();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // useEffect が strict-mode で 2 回走る対策。code ごとに 1 回だけ accept を発火する。
  const acceptedRef = useRef<string | null>(null);

  // ============================================================
  // 1. hydrate 待ち → 未ログインなら login へ + code を localStorage に保存
  // ============================================================
  useEffect(() => {
    if (!hydrated) return;
    if (!code) {
      setErrorMsg('招待コードが無効です');
      return;
    }
    if (!user) {
      // pending code を保存して login flow に redirect。
      // login 成功時に再度この route に戻る (app 側の login 完了 navigation 経路で
      // 救えなければ user が自分で開き直す)。
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(PENDING_INVITE_KEY, code);
        }
      } catch {
        // localStorage 利用不可 (SSR / private mode) なら silently skip。
        // ユーザーは login 後に同じリンクを再度開けば OK。
      }
      router.replace('/(auth)/login' as never);
      return;
    }
  }, [hydrated, code, user, router]);

  // ============================================================
  // 2. ログイン済 → accept を 1 度だけ実行
  // ============================================================
  useEffect(() => {
    if (!user || !code) return;
    if (acceptedRef.current === code) return; // 同じ code で 2 回走るのを防止
    acceptedRef.current = code;

    accept.mutate(code, {
      onSuccess: (result) => {
        if (result.ok) {
          show('友達になりました', 'success');
          // 受諾済みの pending を消す
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.removeItem(PENDING_INVITE_KEY);
            }
          } catch {
            // 失敗しても致命的ではない
          }
          router.replace('/mypage/friends' as never);
          return;
        }
        // RPC が ok:false で返した場合 (エラーメッセージ付き)
        setErrorMsg(result.error ?? '招待の受諾に失敗しました');
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : '招待の受諾に失敗しました';
        setErrorMsg(msg);
      },
    });
    // 1 度だけ走らせたいので deps は user / code に限定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, code]);

  // ============================================================
  // 描画分岐
  // ============================================================
  // hydrate 前 / mutation 進行中: スピナー
  // エラー: メッセージ + CTA
  // (成功時は router.replace で抜けるのでここには来ない)

  if (errorMsg) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          paddingTop: insets.top + SP['10'],
          paddingBottom: insets.bottom + SP['10'],
          paddingHorizontal: SP['6'],
        }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            gap: SP['4'],
          }}
        >
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: C.redBg,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: C.red + '44',
            }}
          >
            <Icon.fail size={44} color={C.red} strokeWidth={1.8} />
          </View>
          <Text
            style={[
              T.h3,
              { color: C.text, textAlign: 'center' },
            ]}
          >
            招待を受諾できませんでした
          </Text>
          <Text
            style={[
              T.body,
              { color: C.text2, textAlign: 'center', maxWidth: 320 },
            ]}
          >
            {errorMsg}
          </Text>
          <View
            style={{
              marginTop: SP['4'],
              flexDirection: 'row',
              gap: SP['2'],
              alignItems: 'center',
            }}
          >
            <Button
              label="友達一覧に戻る"
              onPress={() => router.replace('/mypage/friends' as never)}
              variant="primary"
              size="md"
              haptic="tap"
            />
          </View>
          <View
            style={{
              flexDirection: 'row',
              gap: SP['2'],
              alignItems: 'center',
            }}
          >
            <Text
              style={[T.caption, { color: C.text3, textAlign: 'center' }]}
            >
              code: {code ?? '(無し)'}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Loading (= 未 hydrate or mutation 中)
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: SP['3'],
        paddingHorizontal: SP['6'],
      }}
    >
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: C.accentBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: C.accent + '44',
        }}
      >
        <Icon.friends size={36} color={C.accent} strokeWidth={2} />
      </View>
      <Text style={[T.h3, { color: C.text, textAlign: 'center' }]}>
        招待を確認中…
      </Text>
      <ActivityIndicator color={C.accent} />
      {code && (
        <View
          style={{
            paddingHorizontal: SP['3'],
            paddingVertical: SP['1'],
            backgroundColor: C.bg2,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.border,
            marginTop: SP['2'],
          }}
        >
          <Text style={[T.mono, { color: C.text3, fontSize: 12 }]}>{code}</Text>
        </View>
      )}
    </View>
  );
}
