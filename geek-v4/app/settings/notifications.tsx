import { View, Text, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { Divider } from '@/components/ui/Divider';
import { useSettingsStore } from '@/stores/settingsStore';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Icon } from '@/constants/icons';

type Row = { key: 'notifyLike' | 'notifyComment' | 'notifyFollow' | 'notifyEvent'; label: string; desc: string; icon: keyof typeof Icon };

const ROWS: Row[] = [
  { key: 'notifyLike', label: 'いいね', desc: '投稿にいいねされたとき', icon: 'heart' },
  { key: 'notifyComment', label: 'コメント', desc: '投稿にコメントが付いたとき', icon: 'comment' },
  { key: 'notifyFollow', label: 'フォロー', desc: '誰かにフォローされたとき', icon: 'friends' },
  { key: 'notifyEvent', label: 'イベント', desc: '推しイベントの開催情報', icon: 'calendar' },
];

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const settings = useSettingsStore();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="通知設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
        }}
      >
        <View style={{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}>
          {ROWS.map((r, i) => {
            const I = Icon[r.icon];
            const value = settings[r.key];
            return (
              <View key={r.key}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: SP['4'],
                  gap: SP['3'],
                }}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: C.accentSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <I size={18} color={C.accent} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[T.body, { color: C.text }]}>{r.label}</Text>
                    <Text style={[T.caption, { color: C.text3 }]}>{r.desc}</Text>
                  </View>
                  <Switch
                    value={value}
                    onValueChange={(v) => settings.update(r.key, v)}
                    trackColor={{ false: C.bg4, true: C.accent }}
                    thumbColor="#fff"
                  />
                </View>
                {i < ROWS.length - 1 && <Divider />}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
