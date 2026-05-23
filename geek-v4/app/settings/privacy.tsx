import { View, Text, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Divider } from '../../components/ui/Divider';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAdPreferencesStore } from '../../stores/adPreferencesStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  const concernsPrivate = useSettingsStore((s) => s.concernsPrivate);
  const updateSettings = useSettingsStore((s) => s.update);
  const personalizedAds = useAdPreferencesStore((s) => s.personalizedAds);
  const setPersonalizedAds = useAdPreferencesStore((s) => s.setPersonalizedAds);
  const Lock = Icon.lock;

  // 永続化されたトグルだけを表示する。
  // 旧実装は「プロフィール非公開 / オンライン状態 / 匿名統計」3 つを「準備中」
  // ラベル + disabled Switch で見せていたが、未実装機能を意図せず晒すと
  // (a) 「設定したつもり」の sileng bug を生む、(b) ストア審査で
  // "incomplete feature" の指摘対象になる。
  // → 実装が乗るまでは UI から完全に hide する。実装時にここに項目を追加するだけ。
  const items = [
    {
      label: '「気になる」をこっそり付ける',
      desc: 'ON: 投稿主に届かず、自分のフィルタ用にだけ機能。OFF: 公開され、評価に影響します',
      value: concernsPrivate,
      set: (v: boolean) => updateSettings('concernsPrivate', v),
    },
    {
      label: '興味タグに基づく広告を表示する',
      desc: 'OFF にすると、フィード内に広告が一切表示されなくなります。個人 ID は広告主に送信されません',
      value: personalizedAds,
      set: (v: boolean) => setPersonalizedAds(v),
    },
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
                <View style={{ flex: 1, gap: 2 }}>
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
