import { View, Text, Platform } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { supabase } from '@/lib/supabase';

export default function NotificationsOnboarding() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const settings = useSettingsStore();
  const { show } = useToastStore();
  const [saving, setSaving] = useState(false);

  const finish = async (allow: boolean) => {
    setSaving(true);
    try {
      if (allow && Platform.OS !== 'web') {
        try {
          const Notifications = await import('expo-notifications');
          await Notifications.requestPermissionsAsync();
        } catch {}
      }
      settings.update('notifyLike', allow);
      settings.update('notifyComment', allow);
      settings.update('notifyFollow', allow);
      settings.update('notifyEvent', allow);

      // 1) ローカル状態を即時更新（ガード条件を即座に満たす）
      if (user) setUser({ ...user, onboarded: true });

      // 2) DB更新（失敗してもナビゲーションは進める）
      if (user) {
        const { data: updated, error: updErr } = await supabase
          .from('profiles')
          .update({ onboarded: true })
          .eq('id', user.id)
          .select();
        if (updErr) {
          console.warn('profile update failed:', updErr.message);
        }
        if ((!updated || updated.length === 0) && !updErr) {
          // 行が無い → INSERT
          const fallback = (user.email?.split('@')[0] ?? 'user').padEnd(2, '_').slice(0, 20);
          const { error: insErr } = await supabase
            .from('profiles')
            .insert({ id: user.id, nickname: fallback, onboarded: true });
          if (insErr) {
            console.warn('profile insert failed:', insErr.message);
            show('プロフィール保存に失敗しましたが、続行します', 'warn');
          }
        }
      }
    } finally {
      setSaving(false);
      router.replace('/(tabs)/feed');
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
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.h1, { color: C.text }]}>通知を受け取ろう</Text>
          <Text style={[T.body, { color: C.text2 }]}>
            誰が「いいね」したかは通知しません。タグの動向だけお知らせします。
            一度設定すれば次回から聞きません。
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
        <Button label="通知を許可する" onPress={() => finish(true)} loading={saving} haptic="success" />
        <Button label="あとで設定する" onPress={() => finish(false)} variant="ghost" />
      </View>
    </View>
  );
}
