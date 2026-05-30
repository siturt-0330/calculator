// ============================================================
// components/post/composer/TagFlairRow.tsx
// ============================================================
// Reddit 風「フレア (flair)」行 — コンポーザーで現在選択中のタグを
// 取り外し可能なピルとして並べ、末尾に「+ タグ」追加ボタンを置く。
//
// このコンポーザーではタグが必須。なので空のときは「エラー」ではなく
// 「少なくとも 1 つ要る」と優しく促す dashed な affordance を出す
// (accent 寄りで少しだけ目立たせる)。1 つでも付いたら通常トーンに戻る。
//
// 設計判断:
//   - 純 presentational。選択中タグ・上限は props、削除/追加は callback。
//     supabase / zustand / fetch は一切持たない (CommunityPill と同じ流儀)。
//   - TagPill は「ラベルのみ」で末尾に X を差し込む slot が無いため、
//     インライン削除 X を内包する専用ピルを自前で組む。見た目の言語は
//     TagPill に揃える (R.full / accent-tinted bg=accentBg / text=accent)。
//   - flexWrap で折り返し。key は tag 文字列 (index 禁止)。
//   - ComposerMediaGrid に倣い reanimated の FadeIn/FadeOut + Layout spring で
//     追加・削除を滑らかに。
// ============================================================

import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';
import { X as IconX } from 'lucide-react-native';
import { useColors } from '../../../hooks/useColors';
import { SP, R } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../ui/PressableScale';

// ============================================================
// 定数
// ============================================================
const GAP = SP['2']; // 8px — ピル間の隙間 (行内・折り返し共通)
const REMOVE_HIT = 8; // 削除 X の hitSlop
const DEFAULT_MAX = 5;

// ============================================================
// Props
// ============================================================
export interface TagFlairRowProps {
  /** 現在選択中のタグ名 (先頭 # 無し) */
  tags: string[];
  /** タグの削除 (tag 文字列を渡す) */
  onRemove: (tag: string) => void;
  /** タグ picker を開く / タグ入力にフォーカス */
  onPressAdd: () => void;
  /** 付けられるタグ上限 (default: 5)。到達したら追加ボタンを隠す */
  max?: number;
}

// ============================================================
// TagFlairRow — 単一 export
// ============================================================
export function TagFlairRow({
  tags,
  onRemove,
  onPressAdd,
  max = DEFAULT_MAX,
}: TagFlairRowProps): JSX.Element {
  const C = useColors();

  const isEmpty = tags.length === 0;
  const atMax = tags.length >= max;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: GAP,
      }}
    >
      {tags.map((tag) => (
        <RemovablePill key={tag} tag={tag} onRemove={onRemove} colors={C} />
      ))}

      {/* 上限未満のときだけ追加ボタン。空のときは accent 寄りで少し目立たせる */}
      {!atMax && (
        <AddPill empty={isEmpty} onPress={onPressAdd} colors={C} />
      )}
    </View>
  );
}

// ============================================================
// RemovablePill — "#tag" + 末尾の取り外し X (TagPill の accent 'added' 風)
// ============================================================
function RemovablePill({
  tag,
  onRemove,
  colors: C,
}: {
  tag: string;
  onRemove: (tag: string) => void;
  colors: ReturnType<typeof useColors>;
}): JSX.Element {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={Layout.springify().damping(20)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['1'],
        paddingLeft: SP['3'],
        paddingRight: SP['2'],
        paddingVertical: SP['1'],
        borderRadius: R.full,
        backgroundColor: C.accentBg,
        borderWidth: 1,
        borderColor: C.accentSoft,
      }}
    >
      <Icon.hash size={12} color={C.accent} strokeWidth={2.6} />
      <Animated.Text style={[T.small, { color: C.accent }]} numberOfLines={1}>
        {tag}
      </Animated.Text>

      {/* 末尾の取り外し X — タップ範囲を確保しつつ密な行でも隣と競合しない */}
      <PressableScale
        onPress={() => onRemove(tag)}
        haptic="pop"
        hitSlop={REMOVE_HIT}
        accessibilityRole="button"
        accessibilityLabel={`タグを削除: ${tag}`}
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: C.accentSoft,
        }}
      >
        <IconX size={11} color={C.accent} strokeWidth={2.6} />
      </PressableScale>
    </Animated.View>
  );
}

// ============================================================
// AddPill — dashed-border ghost ピル「+ タグ」
// ------------------------------------------------------------
// 通常 (タグあり): border2 / text2 の控えめゴースト。
// 空のとき: accent の dashed で少しだけ前に出し「タグが要る」を示唆。
// ============================================================
function AddPill({
  empty,
  onPress,
  colors: C,
}: {
  empty: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}): JSX.Element {
  const tint = empty ? C.accent : C.text2;
  const border = empty ? C.accent : C.border2;
  const label = empty ? 'タグを追加' : 'タグ';

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={Layout.springify().damping(20)}
    >
      <PressableScale
        onPress={onPress}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel="タグを追加"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['1'],
          paddingHorizontal: SP['3'],
          paddingVertical: SP['1'],
          borderRadius: R.full,
          backgroundColor: empty ? C.accentBg : 'transparent',
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: border,
        }}
      >
        <Icon.plus size={13} color={tint} strokeWidth={2.6} />
        <Animated.Text style={[T.smallM, { color: tint }]} numberOfLines={1}>
          {label}
        </Animated.Text>
      </PressableScale>
    </Animated.View>
  );
}
