import { View, Text, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Divider } from '../../components/ui/Divider';
import { useSettingsStore } from '../../stores/settingsStore';
import { useToastStore } from '../../stores/toastStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  const concernsPrivate = useSettingsStore((s) => s.concernsPrivate);
  const updateSettings = useSettingsStore((s) => s.update);
  const showToast = useToastStore((s) => s.show);
  const Lock = Icon.lock;

  // 永続化されていない 3 つのトグルは「準備中」として disabled で表示する。
  // 旧実装は useState を使っていたため、トグルしても画面再訪で消える silent bug
  // (ユーザーは「設定した」と思い込むが実際には何も保存されていない) があった。
  const items = [
    {
      label: '「気になる」をこっそり付ける',
      desc: 'ON: 投稿主に届かず、自分のフィルタ用にだけ機能。OFF: 公開され、評価に影響します',
      value: concernsPrivate,
      set: (v: boolean) => updateSettings('concernsPrivate', v),
      pending: false,
    },
    {
      label: 'プロフィールを非公開',
      desc: '準備中の機能です',
      value: false,
      set: () => showToast('近日対応予定です', 'info'),
      pending: true,
    },
    {
      label: 'オンライン状態を隠す',
      desc: '準備中の機能です',
      value: false,
      set: () => showToast('近日対応予定です', 'info'),
      pending: true,
    },
    {
      label: '匿名統計の送信を無効化',
      desc: '準備中の機能です',
      value: false,
      set: () => showToast('近日対応予定です', 'info'),
      pending: true,
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
                opacity: item.pending ? 0.55 : 1,
              }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                    <Text style={[T.body, { color: C.text }]}>{item.label}</Text>
                    {item.pending && (
                      <View style={{
                        paddingHorizontal: 6,
                        paddingVertical: 1,
                        borderRadius: R.full,
                        backgroundColor: C.bg3,
                      }}>
                        <Text style={{ fontSize: 10, color: C.text3, fontWeight: '700' }}>準備中</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[T.caption, { color: C.text3 }]}>{item.desc}</Text>
                </View>
                <Switch
                  value={item.value}
                  onValueChange={item.set}
                  trackColor={{ false: C.bg4, true: C.accent }}
                  thumbColor="#fff"
                  disabled={item.pending}
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
