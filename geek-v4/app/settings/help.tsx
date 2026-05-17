import { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { PressableScale } from '@/components/ui/PressableScale';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

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
    a: '設定 → アカウント設定から削除できます（実装予定）。削除すると30日以内に個人情報がすべて消去されます。',
  },
  {
    q: 'パスワードを忘れた',
    a: 'ログイン画面の「パスワードを忘れた方」からリセットメールを送信できます。',
  },
];

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="ヘルプ・お問い合わせ" left={<BackButton />} />
      <ScrollView contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'], gap: SP['3'] }}>
        <Text style={[T.h3, { color: C.text }]}>よくある質問</Text>
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <PressableScale
              key={i}
              onPress={() => setOpen(isOpen ? null : i)}
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
          borderWidth: 1, borderColor: C.accentSoft, gap: SP['2'],
        }}>
          <Text style={[T.h4, { color: C.accentLight }]}>📧 お問い合わせ</Text>
          <Text style={[T.small, { color: C.text2 }]}>
            上記で解決しない場合は、以下のメールアドレスまでお問い合わせください。返信まで通常1〜3営業日かかります。
          </Text>
          <Text style={[T.bodyMd, { color: C.accent, marginTop: SP['1'] }]}>support@geek.app</Text>
        </View>
      </ScrollView>
    </View>
  );
}
