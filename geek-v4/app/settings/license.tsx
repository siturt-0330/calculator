import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

const LIBRARIES: { name: string; license: string; desc: string }[] = [
  { name: 'React Native', license: 'MIT', desc: 'UIフレームワーク（Meta）' },
  { name: 'Expo', license: 'MIT', desc: 'クロスプラットフォーム開発SDK' },
  { name: 'Expo Router', license: 'MIT', desc: 'ファイルベースルーティング' },
  { name: 'Supabase', license: 'Apache 2.0', desc: 'バックエンド（DB・認証・ストレージ）' },
  { name: 'React Query', license: 'MIT', desc: 'データフェッチ管理（TanStack）' },
  { name: 'Zustand', license: 'MIT', desc: 'ステート管理' },
  { name: 'Reanimated', license: 'MIT', desc: 'アニメーション（Software Mansion）' },
  { name: 'FlashList', license: 'MIT', desc: '高速リスト（Shopify）' },
  { name: 'Lucide Icons', license: 'ISC', desc: 'アイコン集' },
  { name: 'Noto Sans JP', license: 'OFL', desc: '日本語フォント（Google）' },
  { name: 'Inter', license: 'OFL', desc: '英文フォント' },
  { name: 'Syne', license: 'OFL', desc: 'ディスプレイフォント' },
];

export default function LicenseScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="ライセンス" left={<BackButton />} />
      <ScrollView contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'], gap: SP['3'] }}>
        <Text style={[T.body, { color: C.text2 }]}>
          Geek は以下のオープンソースソフトウェアを利用しています。各ライブラリの開発者に感謝します。
        </Text>

        {LIBRARIES.map((lib) => (
          <View
            key={lib.name}
            style={{
              padding: SP['3'],
              backgroundColor: C.bg2,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[T.bodyMd, { color: C.text }]}>{lib.name}</Text>
              <View style={{
                paddingHorizontal: SP['2'], paddingVertical: 2,
                backgroundColor: C.accentBg, borderRadius: R.sm,
              }}>
                <Text style={[T.caption, { color: C.accentLight }]}>{lib.license}</Text>
              </View>
            </View>
            <Text style={[T.caption, { color: C.text3 }]}>{lib.desc}</Text>
          </View>
        ))}

        <View style={{
          marginTop: SP['4'],
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
        }}>
          <Text style={[T.smallM, { color: C.text2, marginBottom: SP['2'] }]}>📜 ライセンス全文について</Text>
          <Text style={[T.small, { color: C.text3 }]}>
            各ライブラリの完全なライセンス文は、それぞれの公式リポジトリ（GitHub等）で確認できます。{'\n\n'}
            MIT: ソースコードの自由な利用・改変・再配布が認められています。{'\n\n'}
            Apache 2.0: 特許権の明示的な許諾を含むOSS互換ライセンス。{'\n\n'}
            ISC: MITとほぼ同等の許諾的ライセンス。{'\n\n'}
            OFL (Open Font License): フォント専用のOSSライセンス。
          </Text>
        </View>

        <Text style={[T.caption, { color: C.text3, textAlign: 'center', marginTop: SP['4'] }]}>
          © 2026 Geek Project. All rights reserved.
        </Text>
      </ScrollView>
    </View>
  );
}
