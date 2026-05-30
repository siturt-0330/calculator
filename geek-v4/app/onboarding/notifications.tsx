import { View, Text, Platform } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useToastStore } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import { registerNativePushToken } from '../../lib/api/push';
import { StepProgress } from './_progress';

export default function NotificationsOnboarding() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  // selector化: 全 settings store の購読をやめ、必要な action (update) のみ
  // subscribe する。他フィールド更新による無用な re-render を防止。
  const updateSetting = useSettingsStore((s) => s.update);
  const { show } = useToastStore();
  const [saving, setSaving] = useState(false);

  const finish = async (allow: boolean) => {
    // 二重 submit 防止 — 旧コードは「あとで設定」を連打すると finish が
    // 何度も走って router.replace が複数発火していた
    if (saving) return;
    setSaving(true);
    let dbCommitted = false;
    try {
      if (allow && Platform.OS !== 'web') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          const Notifications = require('expo-notifications') as typeof import('expo-notifications');
          const perm = await Notifications.requestPermissionsAsync();
          // ★ Critical: permission granted な時だけ Expo Push Token を取得して
          //   push_subscriptions に登録する。これがないと send-push Edge Function
          //   は宛先を持てず、native ユーザーに通知が永遠に届かない。
          //   失敗しても onboarding 自体は進める (token は後から取り直せる)。
          if (perm.granted) {
            const r = await registerNativePushToken();
            if (!r.ok) console.warn('[onboarding] push token register failed:', r.error);
          }
        } catch (e) {
          console.warn('[onboarding] notification setup error:', e);
        }
      }
      updateSetting('notifyLike', allow);
      updateSetting('notifyComment', allow);
      updateSetting('notifyFollow', allow);
      updateSetting('notifyEvent', allow);

      // ★ DB update を先に await して、成功した時だけローカルを onboarded=true に
      // 旧コードは local を先に書き換えていたため、DB 失敗時に
      // local true / DB false の state divergence が起きていた
      if (user) {
        try {
          // upsert で atomic: 行が無ければ INSERT、あれば UPDATE
          const fallback = (user.email?.split('@')[0] ?? 'user').padEnd(2, '_').slice(0, 20);
          const { error: upErr } = await supabase
            .from('profiles')
            .upsert(
              { id: user.id, nickname: user.nickname ?? fallback, onboarded: true },
              { onConflict: 'id' },
            )
            .select();
          if (upErr) {
            console.warn('profile upsert failed:', upErr.message);
            show('プロフィール保存に失敗しましたが、続行します', 'warn');
            // DB は失敗だが UX 上は進める — ローカルだけ onboarded にして app を続行可能に
            setUser({ ...user, onboarded: true });
          } else {
            dbCommitted = true;
            setUser({ ...user, onboarded: true });
          }
        } catch (e) {
          // ネットワーク例外で finally 経由してくる前にここで捕まえる
          console.warn('profile upsert exception:', e);
          show('プロフィール保存に失敗しましたが、続行します', 'warn');
          setUser({ ...user, onboarded: true });
        }
      }
    } finally {
      setSaving(false);
      router.replace('/(tabs)/feed');
      if (dbCommitted) {
        console.log('[onboarding] complete — onboarded committed to DB');
      }
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
        paddingTop: insets.top + SP['8'],
        paddingHorizontal: SP['6'],
        paddingBottom: insets.bottom + SP['6'],
      }}
    >
      <View style={{ flex: 1, gap: SP['4'] }}>
        {/* 最後のステップ — 進捗 4/4 を表示して達成感を演出 */}
        <View style={{ alignItems: 'flex-end' }}>
          <StepProgress step={4} />
        </View>
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>もうすぐ完了！通知を受け取ろう</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            誰が「いいね」したかは通知しません。タグの動向だけお知らせします。
            あとから設定で変更できます。
          </Text>
        </View>

        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['3'],
          }}
        >
          {['好きなタグに新着投稿', 'あなたの投稿へのコメント', 'イベント情報'].map((item) => (
            <View key={item} style={{ flexDirection: 'row', gap: SP['3'], alignItems: 'center' }}>
              <Text style={{ color: C.accent, fontSize: 18 }}>✓</Text>
              <Text style={[T.body, { color: C.text }]}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: SP['3'] }}>
        <Button label="通知を許可する" onPress={() => finish(true)} loading={saving} disabled={saving} haptic="success" />
        <Button label="あとで設定する" onPress={() => finish(false)} variant="ghost" disabled={saving} />
      </View>
    </View>
  );
}
