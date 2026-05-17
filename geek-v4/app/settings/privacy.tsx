import { View, Text, ScrollView, Switch } from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { Divider } from '@/components/ui/Divider';
import { useSettingsStore } from '@/stores/settingsStore';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Icon } from '@/constants/icons';

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  const [hideProfile, setHideProfile] = useState(false);
  const [hidePresence, setHidePresence] = useState(true);
  const [analyticsOff, setAnalyticsOff] = useState(false);
  const concernsPrivate = useSettingsStore((s) => s.concernsPrivate);
  const updateSettings = useSettingsStore((s) => s.update);
  const Lock = Icon.lock;

  const items = [
    {
      label: '「気になる」をこっそり付ける',
      desc: 'ON: 投稿主に届かず、自分のフィルタ用にだけ機能。OFF: 公開され、評価に影響します',
      value: concernsPrivate,
      set: (v: boolean) => updateSettings('concernsPrivate', v),
    },
    { label: 'プロフィールを非公開', desc: '他のユーザーから見えなくする', value: hideProfile, set: setHideProfile },
    { label: 'オンライン状態を隠す', desc: '最終ログイン時刻を表示しない', value: hidePresence, set: setHidePresence },
    { label: '匿名統計の送信を無効化', desc: '改善目的のデータ送信を止める', value: analyticsOff, set: setAnalyticsOff },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="プライバシー" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
      >
        <View style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          flexDirection: 'row',
          gap: SP['3'],
          alignItems: 'center',
        }}>
          <Lock size={24} color={C.accent} strokeWidth={2} />
          <Text style={[T.small, { color: C.text2, flex: 1 }]}>
            投稿は常に匿名。ID・本名は誰にも表示されません。
          </Text>
        </View>

        <View style={{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}>
          {items.map((item, i) => (
            <View key={item.label}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: SP['4'],
                gap: SP['3'],
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={[T.body, { color: C.text }]}>{item.label}</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>{item.desc}</Text>
                </View>
                <Switch
                  value={item.value}
                  onValueChange={item.set}
                  trackColor={{ false: C.bg4, true: C.accent }}
                  thumbColor="#fff"
                />
              </View>
              {i < items.length - 1 && <Divider />}
            </View>
          ))}
        </View>

        <Text style={[T.caption, { color: C.text3, paddingHorizontal: SP['2'] }]}>
          プライバシーポリシーの詳細は「このアプリについて」をご覧ください。
        </Text>
      </ScrollView>
    </View>
  );
}
