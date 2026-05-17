import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '第1条（目的）',
    body: '本規約は、Geek（以下「本サービス」）の利用条件を定めるものです。ユーザーは本規約に同意した上で本サービスを利用するものとします。',
  },
  {
    title: '第2条（アカウント）',
    body: 'ユーザーは登録時に正確な情報を提供する必要があります。一人につき複数アカウントの保有は原則禁止です。アカウント情報の管理責任はユーザーにあります。',
  },
  {
    title: '第3条(匿名性)',
    body: '本サービスはすべての投稿が匿名で行われます。ニックネームやアイコンは本人のみが確認できる情報です。他のユーザーに対しては「匿」表示となります。',
  },
  {
    title: '第4条（禁止事項）',
    body: '次の行為を禁止します：\n・誹謗中傷、ハラスメント\n・違法行為の助長\n・著作権・肖像権の侵害\n・スパム・自演・ステマ\n・運営の妨害\n・複数アカウントを利用した不正行為',
  },
  {
    title: '第5条（信頼スコア）',
    body: '本サービスはユーザー行動に基づく信頼スコアを設けています。スコアは投稿の表示優先度や一部機能の利用に影響することがあります。',
  },
  {
    title: '第6条（コンテンツの権利）',
    body: 'ユーザーの投稿コンテンツの著作権はユーザーに帰属します。ただし、本サービス内での表示・配信・保存のために必要な範囲でライセンスを付与するものとします。',
  },
  {
    title: '第7条（サービスの変更・停止）',
    body: '運営は予告なくサービスの内容を変更・追加・停止する場合があります。これによりユーザーに損害が生じても運営は責任を負いません。',
  },
  {
    title: '第8条（免責）',
    body: '運営は本サービスの完全性・正確性・有用性について保証しません。ユーザー間のトラブルについては、当事者間で解決するものとします。',
  },
  {
    title: '第9条（規約の変更）',
    body: '運営は必要に応じて本規約を変更することがあります。変更後の規約は本サービス内に掲示した時点で効力を生じます。',
  },
  {
    title: '第10条（準拠法・管轄）',
    body: '本規約は日本法に準拠します。本サービスに関する紛争は東京地方裁判所を専属的合意管轄裁判所とします。',
  },
];

export default function TermsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="利用規約" left={<BackButton />} />
      <ScrollView contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'], gap: SP['4'] }}>
        <Text style={[T.caption, { color: C.text3 }]}>最終更新日：2026年5月15日</Text>
        {SECTIONS.map((s, i) => (
          <View key={i} style={{ gap: SP['2'] }}>
            <Text style={[T.h4, { color: C.text }]}>{s.title}</Text>
            <Text style={[T.body, { color: C.text2 }]}>{s.body}</Text>
          </View>
        ))}
        <Text style={[T.caption, { color: C.text3, marginTop: SP['4'] }]}>
          以上 © 2026 Geek Project
        </Text>
      </ScrollView>
    </View>
  );
}
