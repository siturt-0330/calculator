import { useState } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { safeOpenUrl } from '../../lib/openUrl';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

const FAQ: { q: string; a: string }[] = [
  {
    q: '投稿は誰に見られますか？',
    a: '「誰でも閲覧可能」を選んだ場合はすべてのユーザーに表示されます。「自分だけ」を選ぶと自分だけが見られる下書きとして保存されます。',
  },
  {
    q: 'ニックネームやアイコンは他人に見える？',
    a: '見えません。プロフィールに設定したニックネーム・アイコンは自分のマイページでのみ表示されます。他のユーザーからは常に「匿」マークの匿名表示です。',
  },
  {
    q: '電話番号は何に使われますか？',
    a: '不正利用防止のためにのみ使用します。他のユーザーには絶対に公開されません。',
  },
  {
    q: '気になるって何ですか？',
    a: '投稿の信頼度に疑問がある時に押すボタンです。多くの人が押すと「⚠ 注意」が表示されます。デマや不確かな情報の拡散を防ぐ仕組みです。',
  },
  {
    q: '事実・意見・ネタ・WIPって？',
    a: '投稿時に選ぶカテゴリです。「事実」を選ぶには出典URLが必要で、誤情報があれば信頼が大きく下がります。「WIP」は未完成作品用で、温かい目で見てもらえます。',
  },
  {
    q: '好きなタグとブロックタグの違いは？',
    a: '好きなタグの投稿は優先表示されます。ブロックタグの投稿はフィードから完全に除外されます。同じタグを両方に登録することはできません。',
  },
  {
    q: 'タグの「コミュニティ」って？',
    a: 'タグをタップすると、そのタグの投稿だけが見られるコミュニティページに飛びます。参加ボタンを押すとメンバーになり、新着通知が届きます。',
  },
  {
    q: '掲示板と投稿の違いは？',
    a: '投稿はタイムライン形式、掲示板はスレッド形式で議論用です。長く続く話題や実況に向いています。',
  },
  {
    q: 'カレンダーの「10%同意」って？',
    a: 'タグの参加者の10%が「同意」を押すと、提案された予定が全員のカレンダーに採用される仕組みです。タグ規模に応じて承認のしやすさが変わります。',
  },
  {
    q: '大富豪のローカルルールは？',
    a: '革命・8切り・5スキップ・7渡し・10捨て・11バック・12ボンバー・階段・スペ3返しなど、部屋ごとに設定できます。',
  },
  {
    q: 'アカウントを削除したい',
    a: '設定 → アカウントから削除できます。削除すると 30 日以内に個人情報がすべて消去されます。削除前に「データをエクスポート」で自分の投稿等を JSON 保存することも可能です。',
  },
  {
    q: 'パスワードを忘れた',
    a: 'ログイン画面の「パスワードを忘れた方」からリセットメールを送信できます。',
  },
];

// サポート問い合わせ時にユーザー操作が不要で済むよう、診断情報を mailto: の
// body に pre-fill する。PII (email / nickname) は一切含めない。
function buildDiagnosticsMailto(): string {
  const version = Constants.expoConfig?.version ?? 'unknown';
  const ios = Constants.expoConfig?.ios?.buildNumber ?? '-';
  const android = Constants.expoConfig?.android?.versionCode ?? '-';
  const lines = [
    'お問い合わせありがとうございます。お困りの内容をできるだけ具体的にご記入ください。',
    '',
    '----- 以下は自動入力 (削除しないでください) -----',
    `App version: ${version}`,
    `iOS build: ${ios} / Android versionCode: ${android}`,
    `Platform: ${Platform.OS} (${Platform.Version})`,
    `Locale: ${typeof navigator !== 'undefined' ? navigator.language : '-'}`,
  ];
  const subject = encodeURIComponent(`[GEEK Support] ${version}`);
  const body = encodeURIComponent(lines.join('\n'));
  return `mailto:support@geek.app?subject=${subject}&body=${body}`;
}

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  // 旧: index を持っていたが、FAQ の追加/削除/順序入替で開閉位置がズレる。
  // 質問文 (q) は unique なので、それを開閉キーにする。
  const [openQ, setOpenQ] = useState<string | null>(null);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="ヘルプ・お問い合わせ" left={<BackButton />} />
      <ScrollView contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'], gap: SP['3'] }}>
        <Text style={[T.h3, { color: C.text }]}>よくある質問</Text>
        {FAQ.map((item) => {
          const isOpen = openQ === item.q;
          return (
            <PressableScale
              key={item.q}
              onPress={() => setOpenQ(isOpen ? null : item.q)}
              haptic="tap"
              style={{
                padding: SP['4'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: isOpen ? C.accent : C.border,
                gap: SP['2'],
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <Text style={[T.bodyMd, { color: C.text, flex: 1 }]}>Q. {item.q}</Text>
                {isOpen
                  ? <Icon.chevronU size={18} color={C.text2} strokeWidth={2.2} />
                  : <Icon.chevronD size={18} color={C.text3} strokeWidth={2.2} />}
              </View>
              {isOpen && (
                <Text style={[T.body, { color: C.text2, marginTop: SP['1'] }]}>A. {item.a}</Text>
              )}
            </PressableScale>
          );
        })}

        <View style={{
          marginTop: SP['6'], padding: SP['4'],
          backgroundColor: C.accentBg, borderRadius: R.lg,
          borderWidth: 1, borderColor: C.accentSoft, gap: SP['3'],
        }}>
          <Text style={[T.h4, { color: C.accentLight }]}>📧 お問い合わせ</Text>
          <Text style={[T.small, { color: C.text2 }]}>
            上記で解決しない場合は、以下からお問い合わせください。返信まで通常 1〜3 営業日かかります。
          </Text>

          {/* 診断情報付きメール起動 — 環境情報が自動で件名 / 本文に入るので
              ユーザーは操作内容を書くだけで済む。PII は一切含めない。 */}
          <PressableScale
            haptic="select"
            accessibilityLabel="診断情報付きでサポートにメールを送る"
            hitSlop={8}
            onPress={() => {
              void safeOpenUrl(buildDiagnosticsMailto(), {
                errorMessage: 'メールアプリを開けませんでした。support@geek.app へ直接ご連絡ください。',
              });
            }}
            style={{
              paddingVertical: SP['3'], paddingHorizontal: SP['4'],
              backgroundColor: C.accent, borderRadius: R.md,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={[T.bodyMd, { color: C.bg, fontWeight: '700' }]}>
              📩 診断情報付きでメールを送る
            </Text>
          </PressableScale>

          <Text style={[T.small, { color: C.text3 }]}>
            または直接: <Text style={{ color: C.accent }}>support@geek.app</Text>
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            セキュリティ脆弱性のご報告は security@geek.app、
            著作権侵害申立は copyright@geek.app までお願いします。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
