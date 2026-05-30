// ============================================================
// components/post/composer/AutoTagSuggestionRow.tsx
// ============================================================
// コンポーザー本文から自動抽出されたタグ候補を提示する slim パネル。
// 「本文から提案」ヘッダ (sparkles アイコン + ラベル) の下に、
// 横スクロールする候補チップを並べる。チップをタップすると onAdd が
// その tag 文字列を呼び、選択タグに追加する想定。
//
// 設計判断:
//   - 純 presentational。候補 (suggestions) は useAutoTagSuggest 等で
//     外部計算され props で渡る。state / supabase / hook ロジックは持たない。
//   - チップは TagPill の 'normal' 見た目を踏襲しつつ、先頭に Icon.plus を
//     置いて「タップで追加できる」ことを示す (TagPill 自体は再利用せず、
//     leading plus + #tag の専用見た目を内製)。
//   - 横スクロール (ScrollView horizontal) を採用 — X (Twitter) のサジェスト
//     行に寄せた、はみ出しても 1 行で流せる体験にする。
//   - FadeIn entrance は ComposerMediaGrid と同じ reanimated 経路を踏襲。
//   - !visible もしくは候補 0 件なら null を返す (呼び出し側を軽くする)。
// ============================================================

import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useColors } from '../../../hooks/useColors';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../ui/PressableScale';

// ============================================================
// Props
// ============================================================
export interface AutoTagSuggestionRowProps {
  /** useAutoTagSuggest の items 形 (最低限 .tag を持つ) */
  suggestions: { tag: string }[];
  /** チップタップで該当 tag を選択タグに追加する */
  onAdd: (tag: string) => void;
  /** false もしくは suggestions 空 → null を描画 */
  visible: boolean;
}

// ============================================================
// AutoTagSuggestionRow — 単一 export
// ============================================================
export function AutoTagSuggestionRow({
  suggestions,
  onAdd,
  visible,
}: AutoTagSuggestionRowProps): JSX.Element | null {
  const C = useColors();

  // 非表示 / 候補なしは何も描かない
  if (!visible || suggestions.length === 0) return null;

  return (
    <Animated.View entering={FadeIn.duration(180)} style={{ gap: SP['2'] }}>
      {/* ヘッダ: sparkles + 「本文から提案」 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
        <Icon.sparkles size={13} color={C.accent} strokeWidth={2.2} />
        <Text style={[T.smallM, { color: C.text3 }]}>本文から提案</Text>
      </View>

      {/* 候補チップ: 横スクロール (X 風) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexDirection: 'row', gap: SP['2'], paddingRight: SP['1'] }}
      >
        {suggestions.map(({ tag }) => (
          <SuggestionChip key={tag} tag={tag} onAdd={onAdd} accent={C.accent} bg={C.accentBg} border={C.border} text={C.text} />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

// ============================================================
// SuggestionChip — 先頭 plus + #tag の追加用ピル
// ============================================================
function SuggestionChip({
  tag,
  onAdd,
  accent,
  bg,
  border,
  text,
}: {
  tag: string;
  onAdd: (tag: string) => void;
  accent: string;
  bg: string;
  border: string;
  text: string;
}): JSX.Element {
  return (
    <PressableScale
      onPress={() => onAdd(tag)}
      haptic="select"
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`提案タグを追加: ${tag}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['1'],
        paddingHorizontal: SP['3'],
        paddingVertical: SP['1'],
        borderRadius: R.full,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <Icon.plus size={12} color={accent} strokeWidth={2.6} />
      <Text style={[T.small, { color: text }]}>#{tag}</Text>
    </PressableScale>
  );
}
