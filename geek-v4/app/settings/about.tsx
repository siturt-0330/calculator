import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { ListItem } from '../../components/ui/ListItem';
import { Divider } from '../../components/ui/Divider';
import { C, R, SP } from '../../design/tokens';
import { T, LOGO_FONT, LOGO_FONT_WEIGHT } from '../../design/typography';
import { Icon } from '../../constants/icons';

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '4.0.0';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="このアプリについて" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        <View style={{
          padding: SP['6'],
          backgroundColor: C.bg2,
          borderRadius: R.xl,
          borderWidth: 1,
          borderColor: C.border,
          alignItems: 'center',
          gap: SP['2'],
        }}>
          <Text style={{ fontFamily: LOGO_FONT, fontWeight: LOGO_FONT_WEIGHT, fontSize: 56, color: C.text, letterSpacing: -1.5 }}>Geek</Text>
          <Text style={[T.body, { color: C.text2 }]}>好きを、匿名で、安心して続ける</Text>
          <View style={{
            marginTop: SP['2'],
            paddingHorizontal: SP['3'], paddingVertical: SP['1'],
            backgroundColor: C.bg3, borderRadius: R.full,
          }}>
            <Text style={[T.caption, { color: C.text3 }]}>v{version}</Text>
          </View>
        </View>

        <View style={{
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        }}>
          <ListItem icon={Icon.info} label="利用規約" onPress={() => router.push('/settings/terms' as never)} />
          <Divider />
          <ListItem icon={Icon.shield} label="プライバシーポリシー" onPress={() => router.push('/settings/privacy-policy' as never)} />
          <Divider />
          <ListItem icon={Icon.help} label="ヘルプ・お問い合わせ" onPress={() => router.push('/settings/help' as never)} />
          <Divider />
          <ListItem icon={Icon.flag} label="ライセンス" onPress={() => router.push('/settings/license' as never)} />
        </View>

        <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
          © 2026 Geek Project. All rights reserved.
        </Text>
      </ScrollView>
    </View>
  );
}
