import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { C, SP } from '../../design/tokens';
import { T } from '../../design/typography';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '取得する情報',
    body: '本サービスでは以下の情報を取得・保存します：\n・メールアドレス（認証用）\n・電話番号（不正利用防止用、非公開）\n・ニックネーム・アバター（自分のみ閲覧可能）\n・投稿内容・タグ・いいね・コメント等の利用ログ\n・端末情報（OS、ブラウザ）\n・IPアドレス（不正検知用、短期保管）',
  },
  {
    title: '匿名性の保護',
    body: '投稿は完全匿名で表示されます。他のユーザーから個人を特定できる情報（ニックネーム・電話番号・メールアドレス等）は公開されません。',
  },
  {
    title: '利用目的',
    body: '取得した情報は以下の目的でのみ使用します：\n・サービスの提供・改善\n・不正利用の検知・防止\n・統計分析（個人を特定しない形）\n・運営からの重要なお知らせ',
  },
  {
    title: '第三者提供',
    body: '法令に基づく場合を除き、ユーザーの同意なく個人情報を第三者に提供することはありません。',
  },
  {
    title: 'Cookieとローカルストレージ',
    body: '本サービスはセッション維持のためにブラウザのlocalStorageを使用します。ログイン情報のみを保存しており、トラッキング目的では使用しません。',
  },
  {
    title: 'データの削除',
    body: 'アカウント削除時は、利用ログを含むすべての個人情報を30日以内に消去します。投稿コンテンツについては、サービス継続性のため匿名化された形で残ることがあります。',
  },
  {
    title: 'セキュリティ',
    body: 'パスワードはハッシュ化して保存します。通信はすべて SSL/TLS で暗号化されます。Supabaseの行レベルセキュリティ（RLS）により、他人のデータにアクセスできない設計です。',
  },
  {
    title: '未成年者の利用',
    body: '13歳未満の方は本サービスを利用できません。18歳未満の方は保護者の同意の上でご利用ください。',
  },
  {
    title: 'お問い合わせ',
    body: 'プライバシーに関するご質問は「ヘルプ・お問い合わせ」よりご連絡ください。',
  },
];

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="プライバシーポリシー" left={<BackButton />} />
      <ScrollView contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'], gap: SP['4'] }}>
        <Text style={[T.caption, { color: C.text3 }]}>最終更新日：2026年5月15日</Text>
        <Text style={[T.body, { color: C.text2 }]}>
          Geek（以下「本サービス」）は、ユーザーのプライバシーを最優先に設計されています。
          匿名性の確保、最小限のデータ収集、ユーザー自身による管理を基本方針としています。
        </Text>
        {SECTIONS.map((s, i) => (
          <View key={i} style={{ gap: SP['2'] }}>
            <Text style={[T.h4, { color: C.text }]}>{s.title}</Text>
            <Text style={[T.body, { color: C.text2 }]}>{s.body}</Text>
          </View>
        ))}
        <Text style={[T.caption, { color: C.text3, marginTop: SP['4'] }]}>
          © 2026 Geek Project
        </Text>
      </ScrollView>
    </View>
  );
}
