// ============================================================
// CategorySortBar — 検索結果のカテゴリタブ + ソートチップ
// ============================================================
// app/search.tsx から抽出。
// カテゴリタブ: all / posts / tags / bbs (各々件数バッジ付き)
// ソートチップ: relevance / newest / popular
// pure presentational — value/onChange + counts を親が握る。
//
// CATEGORY_LABELS / SORT_LABELS / Category / SortMode 型もここに集約。
// 親 (SearchScreen) は `import { Category, SortMode } from '../components/search/CategorySortBar'` で取得。
// ============================================================
import { ScrollView, Text, View } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

export type Category = 'all' | 'posts' | 'tags' | 'bbs';
export type SortMode = 'relevance' | 'newest' | 'popular';

export const CATEGORY_LABELS: Record<Category, { label: string; emoji: string }> = {
  all: { label: 'すべて', emoji: '✨' },
  posts: { label: '投稿', emoji: '📝' },
  tags: { label: 'タグ', emoji: '#' },
  bbs: { label: '掲示板', emoji: '💬' },
};

export const SORT_LABELS: Record<SortMode, { label: string; emoji: string }> = {
  relevance: { label: '関連度', emoji: '🎯' },
  newest: { label: '新着順', emoji: '🕐' },
  popular: { label: '人気順', emoji: '🔥' },
};

export function CategorySortBar({
  category,
  onCategoryChange,
  sortMode,
  onSortChange,
  counts,
}: {
  category: Category;
  onCategoryChange: (c: Category) => void;
  sortMode: SortMode;
  onSortChange: (s: SortMode) => void;
  counts: Record<Category, number>;
}) {
  return (
    <View style={{ gap: SP['2'] }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => {
            const active = category === c;
            const meta = CATEGORY_LABELS[c];
            const cnt = counts[c];
            return (
              <PressableScale
                key={c}
                onPress={() => onCategoryChange(c)}
                haptic="select"
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: SP['3'], paddingVertical: 6,
                  backgroundColor: active ? C.accent : C.bg3,
                  borderRadius: R.full,
                  borderWidth: 1, borderColor: active ? C.accent : C.border,
                }}
              >
                <Text style={{ fontSize: 11 }}>{meta.emoji}</Text>
                <Text style={[T.caption, { color: active ? '#fff' : C.text, fontWeight: '700' }]}>
                  {meta.label}
                </Text>
                <View style={{
                  paddingHorizontal: 4, paddingVertical: 1,
                  backgroundColor: active ? 'rgba(255,255,255,0.2)' : C.bg4,
                  borderRadius: R.sm,
                }}>
                  <Text style={{ fontSize: 9, color: active ? '#fff' : C.text3, fontWeight: '700' }}>
                    {cnt}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </View>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(Object.keys(SORT_LABELS) as SortMode[]).map((s) => {
            const active = sortMode === s;
            const meta = SORT_LABELS[s];
            return (
              <PressableScale
                key={s}
                onPress={() => onSortChange(s)}
                haptic="tap"
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 3,
                  paddingHorizontal: 8, paddingVertical: 4,
                  backgroundColor: active ? C.accentBg : 'transparent',
                  borderRadius: R.full,
                  borderWidth: 1, borderColor: active ? C.accent : C.border,
                }}
              >
                <Text style={{ fontSize: 10 }}>{meta.emoji}</Text>
                <Text style={[T.caption, { color: active ? C.accentLight : C.text2, fontWeight: '600' }]}>
                  {meta.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
