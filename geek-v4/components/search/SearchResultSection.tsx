// ============================================================
// SearchResultSection — 検索結果セクション (header + 上位 3 件 + もっと見る pill)
// ------------------------------------------------------------
// 仕様 (タスク §3 / §8):
//   - props: title, count, items, renderItem, onShowMore
//   - セクション header (アイコン + タイトル + 件数 badge)
//   - 上位 N 件を items で受けて renderItem で描画
//   - count > items.length のとき「もっと見る (N - 3)」 pill を下に出す
//   - Geek UI tokens に従う
// ============================================================
import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export interface SearchResultSectionProps<T> {
  /** セクションタイトル (例: "投稿") */
  title: string;
  /** 表示アイコン (絵文字 or React node) — 簡易は string */
  icon?: string;
  /** 総件数 (= overflow 計算に使う) */
  count: number;
  /** 描画対象 (= 上位 N 件) */
  items: readonly T[];
  /** 各 item の描画 (key は renderItem が出す) */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** 「もっと見る」 pill を押した時のハンドラ。undefined なら出さない */
  onShowMore?: () => void;
  /** key を抽出する関数. 省略時は index. (item を直接受け取って一意キーを返す) */
  keyExtractor?: (item: T, index: number) => string;
}

export function SearchResultSection<T>({
  title,
  icon,
  count,
  items,
  renderItem,
  onShowMore,
  keyExtractor,
}: SearchResultSectionProps<T>) {
  // 完全に空ならセクション全体を描かない
  if (items.length === 0) return null;

  const overflow = Math.max(0, count - items.length);
  const showMore = overflow > 0 && onShowMore !== undefined;

  return (
    <View style={{ gap: SP['2'] }}>
      {/* header — icon + title + count badge */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {icon !== undefined && (
          <Text style={{ fontSize: 14 }}>{icon}</Text>
        )}
        <Text
          style={[
            T.smallM,
            { color: C.text2, fontWeight: '700', letterSpacing: 0.3 },
          ]}
        >
          {title}
        </Text>
        <View
          style={{
            paddingHorizontal: 6,
            paddingVertical: 1,
            backgroundColor: C.bg3,
            borderRadius: R.sm,
          }}
        >
          <Text style={{ fontSize: 10, color: C.text3, fontWeight: '700' }}>
            {count}
          </Text>
        </View>
      </View>

      {/* items */}
      <View style={{ gap: SP['2'] }}>
        {items.map((it, i) => {
          const key = keyExtractor ? keyExtractor(it, i) : `sec-item-${i}`;
          return (
            <View key={key}>{renderItem(it, i)}</View>
          );
        })}
      </View>

      {/* もっと見る pill */}
      {showMore && (
        <PressableScale
          onPress={onShowMore}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={`${title}をもっと見る`}
          style={{
            marginTop: SP['1'],
            paddingVertical: SP['2'] + 2,
            paddingHorizontal: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.accent + '40',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>
            {title}をもっと見る ({overflow})
          </Text>
          <Icon.chevronR
            size={14}
            color={C.accentLight}
            strokeWidth={2.2}
          />
        </PressableScale>
      )}
    </View>
  );
}
