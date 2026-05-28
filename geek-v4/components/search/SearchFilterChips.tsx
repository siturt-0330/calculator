// ============================================================
// SearchFilterChips — 検索結果上のフィルタ chip 行 (期間 / 並び順 / コミュ)
// ------------------------------------------------------------
// 仕様 (タスク §4 / §9):
//   - 「期間: 1日 / 1週 / 1ヶ月 / 全期間」
//   - 「並び順: 関連度 / 新着 / 人気」
//   - 「コミュ: すべて / 参加中」
//   - 選択時 accent fill、未選択 outline
//   - 既存 search query に filter を AND で適用 (UI 側で利用)
//
// 設計:
//   - SearchFilters は純粋データ。search.tsx 側が値を使ってクエリに適用する
//   - chip タップ時に onChange(next) で部分更新 (immutable)
//   - 3 行を FlexWrap で stack (narrow 端末でも折り返す)
// ============================================================
import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export type SearchPeriod = 'all' | 'day' | 'week' | 'month';
export type SearchSort = 'relevance' | 'newest' | 'popular';
export type SearchCommunityScope = 'all' | 'joined';

export interface SearchFilters {
  period: SearchPeriod;
  sort: SearchSort;
  community: SearchCommunityScope;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  period: 'all',
  sort: 'relevance',
  community: 'all',
};

export interface SearchFilterChipsProps {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}

const PERIOD_OPTIONS: { value: SearchPeriod; label: string }[] = [
  { value: 'day', label: '1日' },
  { value: 'week', label: '1週' },
  { value: 'month', label: '1ヶ月' },
  { value: 'all', label: '全期間' },
];

const SORT_OPTIONS: { value: SearchSort; label: string }[] = [
  { value: 'relevance', label: '関連度' },
  { value: 'newest', label: '新着' },
  { value: 'popular', label: '人気' },
];

const COMMUNITY_OPTIONS: { value: SearchCommunityScope; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'joined', label: '参加中' },
];

/**
 * 単独 chip — accent fill (selected) / outline (unselected) を切り替える。
 */
function Chip({
  active,
  label,
  onPress,
  accessibilityLabel,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: 6,
        borderRadius: R.full,
        borderWidth: 1,
        backgroundColor: active ? C.accentBg : 'transparent',
        borderColor: active ? C.accent : C.border,
      }}
    >
      <Text
        style={[
          T.caption,
          { color: active ? C.accentLight : C.text2, fontWeight: active ? '700' : '600' },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

export function SearchFilterChips({ filters, onChange }: SearchFilterChipsProps) {
  return (
    <View style={{ gap: SP['2'] }}>
      {/* 期間 */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Text
          style={[
            T.caption,
            { color: C.text3, fontWeight: '700', marginRight: 4, minWidth: 38 },
          ]}
        >
          期間
        </Text>
        {PERIOD_OPTIONS.map((opt) => (
          <Chip
            key={`period-${opt.value}`}
            active={filters.period === opt.value}
            label={opt.label}
            accessibilityLabel={`期間 ${opt.label}`}
            onPress={() => onChange({ ...filters, period: opt.value })}
          />
        ))}
      </View>

      {/* 並び順 */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Text
          style={[
            T.caption,
            { color: C.text3, fontWeight: '700', marginRight: 4, minWidth: 38 },
          ]}
        >
          並び順
        </Text>
        {SORT_OPTIONS.map((opt) => (
          <Chip
            key={`sort-${opt.value}`}
            active={filters.sort === opt.value}
            label={opt.label}
            accessibilityLabel={`並び順 ${opt.label}`}
            onPress={() => onChange({ ...filters, sort: opt.value })}
          />
        ))}
      </View>

      {/* コミュ */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Text
          style={[
            T.caption,
            { color: C.text3, fontWeight: '700', marginRight: 4, minWidth: 38 },
          ]}
        >
          コミュ
        </Text>
        {COMMUNITY_OPTIONS.map((opt) => (
          <Chip
            key={`comm-${opt.value}`}
            active={filters.community === opt.value}
            label={opt.label}
            accessibilityLabel={`コミュ ${opt.label}`}
            onPress={() => onChange({ ...filters, community: opt.value })}
          />
        ))}
      </View>
    </View>
  );
}
