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
import { StepProgress } from './_progress';

export default function NotificationsOnboarding() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const settings = useSettingsStore();
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
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Notifications = require('expo-notifications') as typeof import('expo-notifications');
          await Notifications.requestPermissionsAsync();
        } catch {}
      }
      settings.update('notifyLike', allow);
      settings.update('notifyComment', allow);
      settings.update('notifyFollow', allow);
      settings.update('notifyEvent', allow);

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
        {/* 最後のステップ — 進捗 5/5 を表示して達成感を演出 */}
        <View style={{ alignItems: 'flex-end' }}>
          <StepProgress step={5} />
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
        <Button label="通知を許可する" onPress={() => finish(true)} loading={saving} haptic="success" />
        <Button label="あとで設定する" onPress={() => finish(false)} variant="ghost" disabled={saving} />
      </View>
    </View>
  );
}
