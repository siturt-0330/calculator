// ============================================================
// InterestCategories — 「興味のあるカテゴリ」 2 列グリッド
// ------------------------------------------------------------
// app/(tabs)/bbs.tsx の CATEGORIES と歩調を合わせた静的カテゴリ
// (掲示板で使っているのと同じ色彩・呼称)。tap → /search?q=#<category>
// ============================================================
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '../../hooks/useColors';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

// app/(tabs)/bbs.tsx と一致 (「すべて」は除外: フィルタ意図がないため検索動線として無意味)
const CATEGORIES: ReadonlyArray<{ label: string; color: string; emoji: string }> = [
  { label: '雑談',     color: '#22D3A4', emoji: '💬' },
  { label: 'アニメ',   color: '#FF6B7A', emoji: '📺' },
  { label: 'ゲーム',   color: '#7CB1FF', emoji: '🎮' },
  { label: 'マンガ',   color: '#F472B6', emoji: '📚' },
  { label: '音楽',     color: '#FCD34D', emoji: '🎵' },
  { label: 'アイドル', color: '#FF8C30', emoji: '🌟' },
  { label: 'Vtuber',   color: '#A78BFA', emoji: '🎤' },
  { label: '推し活',   color: '#EC4899', emoji: '💖' },
  { label: 'グルメ',   color: '#84CC16', emoji: '🍜' },
  { label: 'コスプレ', color: '#06B6D4', emoji: '✨' },
  { label: 'ニュース', color: '#94A3B8', emoji: '📰' },
];

const COLUMNS = 2;

export function InterestCategories() {
  const C = useColors();
  const router = useRouter();

  return (
    <View style={{ gap: SP['2'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: SP['4'],
        }}
      >
        <Icon.hash size={14} color={C.text3} strokeWidth={2.2} />
        <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>
          興味のあるカテゴリ
        </Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          paddingHorizontal: SP['4'],
          gap: SP['2'],
        }}
      >
        {CATEGORIES.map((cat) => (
          <CategoryChip
            key={cat.label}
            label={cat.label}
            emoji={cat.emoji}
            color={cat.color}
            onPress={() => {
              const q = encodeURIComponent(`#${cat.label}`);
              router.push(`/search?q=${q}` as never);
            }}
          />
        ))}
      </View>
    </View>
  );
}

function CategoryChip({
  label,
  emoji,
  color,
  onPress,
}: {
  label: string;
  emoji: string;
  color: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.96}
      style={{
        // 2 列均等割り — gap: SP['2'] (8) なので幅 = (100% - 8px) / 2 を flexBasis で表現
        flexBasis: `${100 / COLUMNS}%`,
        // 親 gap を引いた幅にする (gap: SP['2'] = 8px, 2 列 → 1 つあたり 4px 引き)
        maxWidth: `${100 / COLUMNS}%`,
        flexGrow: 1,
        minWidth: 0,
      }}
      accessibilityLabel={`カテゴリで検索: ${label}`}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          paddingHorizontal: SP['3'],
          paddingVertical: SP['3'],
          borderRadius: R.md,
          backgroundColor: C.bg2,
          borderWidth: 1,
          borderColor: C.border,
          // 左の color stripe
          borderLeftWidth: 3,
          borderLeftColor: color,
        }}
      >
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
        <Text
          style={[T.bodyB, { color: C.text, flexShrink: 1 }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}
