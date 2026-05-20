import { View, Text } from 'react-native';
import { C, SP, R } from '../../design/tokens';

// 検索結果の補助バッジ — YouTube 風シンプル設計
// 色は使わず、「過去に調べたかどうか」だけを subtle に伝える
//
// 出すのは 1 種類だけ:
//   - 🕐 履歴あり (= 過去にクエリ / クリックした)
// その他の reason (完全一致 / 高信頼 / トレンド等) は背景の scoring に任せて
// UI には出さない方針

type Props = {
  /** ユーザが過去にクリック / 検索したことがある場合 true */
  seenBefore?: boolean;
};

export function ReasonBadge({ seenBefore }: Props) {
  if (!seenBefore) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: SP['2'],
        paddingVertical: 2,
        backgroundColor: C.bg3,
        borderRadius: R.sm,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Text style={{ fontSize: 10, color: C.text3 }}>🕐</Text>
      <Text style={{ fontSize: 10, color: C.text3, fontWeight: '600' }}>履歴あり</Text>
    </View>
  );
}

// 旧 API 互換 — reasons[] を受け取って seenBefore を計算
export function ReasonBadges({
  reasons,
  seenBefore,
}: {
  reasons?: readonly string[];
  seenBefore?: boolean;
}) {
  // reasons から「履歴あり」相当の signal を抽出 (👀よく見る / ❤あなたの推し / typo:)
  // → これらが入っていれば過去にユーザが触れたサインなので seenBefore=true
  const derived =
    seenBefore ??
    (reasons?.some((r) => r.startsWith('👀') || r.startsWith('❤') || r.startsWith('typo:')) ?? false);
  return <ReasonBadge seenBefore={derived} />;
}
