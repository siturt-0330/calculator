// ============================================================
// SearchHistoryChips — 検索画面を開いた瞬間に出す「最近の検索」chip 行
// ------------------------------------------------------------
// 仕様 (タスク §1):
//   - 最大 10 件、横スクロール
//   - 各 chip: 時計アイコン + 検索ワード + × (個別削除)
//   - 右端に「履歴をクリア」ボタン (PolishedButton outline)
//   - Geek UI tokens に従う (C / SP / R / SHADOW / T)
// ============================================================
import { View, Text, ScrollView } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { PolishedButton } from '../ui/PolishedButton';
import { Icon } from '../../constants/icons';
import { C, R, SHADOW, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export interface SearchHistoryChipsProps {
  /** 履歴ワード (新しい順) */
  history: readonly string[];
  /** chip をタップ → そのワードで検索 */
  onPickQuery: (q: string) => void;
  /** × をタップ → 1 件削除 */
  onRemoveQuery: (q: string) => void;
  /** 「履歴をクリア」をタップ → 全削除 */
  onClearAll: () => void;
  /** 最大件数 (default 10) */
  maxItems?: number;
}

export function SearchHistoryChips({
  history,
  onPickQuery,
  onRemoveQuery,
  onClearAll,
  maxItems = 10,
}: SearchHistoryChipsProps) {
  // history が空なら何も描かない (UI 側で別 empty state を出す責務)
  if (!history || history.length === 0) return null;

  const visible = history.slice(0, maxItems);

  return (
    <View style={{ gap: SP['2'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: SP['1'],
        }}
      >
        <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>
          最近の検索
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: 'row',
          gap: SP['2'],
          paddingHorizontal: SP['1'],
          paddingVertical: 2,
        }}
        accessibilityRole="list"
      >
        {visible.map((h) => (
          <View
            key={`hist-${h}`}
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingLeft: SP['3'],
                paddingRight: SP['2'],
                paddingVertical: 6,
                backgroundColor: C.bg2,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: C.border,
              },
              SHADOW.xs,
            ]}
          >
            <PressableScale
              onPress={() => onPickQuery(h)}
              haptic="tap"
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`${h} で再検索`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                maxWidth: 220,
              }}
            >
              <Icon.clock size={14} color={C.text3} strokeWidth={2} />
              <Text
                style={[T.smallM, { color: C.text }]}
                numberOfLines={1}
              >
                {h}
              </Text>
            </PressableScale>
            <PressableScale
              onPress={() => onRemoveQuery(h)}
              haptic="warn"
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${h} を履歴から削除`}
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: C.bg3,
              }}
            >
              <Icon.close size={12} color={C.text2} strokeWidth={2.4} />
            </PressableScale>
          </View>
        ))}

        {/* 右端: 履歴をクリア (outline) */}
        <View style={{ alignSelf: 'center', marginLeft: SP['1'] }}>
          <PolishedButton
            variant="outline"
            size="sm"
            label="履歴をクリア"
            haptic="warn"
            onPress={onClearAll}
          />
        </View>
      </ScrollView>
    </View>
  );
}
