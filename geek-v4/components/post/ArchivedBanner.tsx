// ============================================================
// ArchivedBanner — アーカイブ済み投稿 (90 日経過) を示す banner
// ============================================================
// Reddit ガイド #15 / 2.10 / 3.7 章:
//   90 日経過した post は新規 comment / like / reaction を受け付けない
//   (RLS 段でも deny). UI 側ではそれを「閲覧のみ」として明示するため
//   横長 banner を post 詳細 / カード上部に出す.
//
// レイアウト:
//   [Icon.lock] アーカイブ済み (3ヶ月以上前)。新しいコメント・反応は…
//      └ amber アクセント (薄背景 + amber 文字)
//      └ R.lg / SP['2'] SP['3']
//
// 設計判断:
//   - 単体で完結する presentational component (props 無し).
//   - 配線 (= AnonPostCard / post/[id].tsx に挿入) は別 PR で行う.
//     ここでは表示 component の定義のみを切り出す.
//   - icon は constants/icons.ts の Icon.lock を使用 (Lucide Lock).
//     "archive" alias は未登録なので、視覚的に近い lock を採用.
//   - 色は amber 系で「警告ではないが action 制限がある」を表現.
// ============================================================

import { memo } from 'react';
import { View, Text } from 'react-native';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

function ArchivedBannerImpl() {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel="この投稿はアーカイブ済みです。新しいコメントや反応は受け付けません"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingVertical: SP['2'],
        paddingHorizontal: SP['3'],
        // amber を 8% 不透明で薄敷き. C.amberBg より明るく目立たせる.
        backgroundColor: C.amber + '15',
        borderRadius: R.lg,
        // 境界はあえて細く amber alpha で. テーマと喧嘩しない.
        borderWidth: 1,
        borderColor: C.amber + '33',
      }}
    >
      <Icon.lock size={16} color={C.amber} />
      <Text style={[T.small, { color: C.amber, flex: 1 }]}>
        アーカイブ済み (3ヶ月以上前)。新しいコメント・反応は受け付けません
      </Text>
    </View>
  );
}

// memo: props が無いため再描画は親の identity 変更時のみ. 子から見て stable.
export const ArchivedBanner = memo(ArchivedBannerImpl);
