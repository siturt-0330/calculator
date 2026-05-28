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
import { R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

// iOS-native: 色付きの円形 glyph + ラベル (SF Symbols 風の hue spec).
// glyph は SF Pro semibold の latin 1 文字。emoji ではなく純粋な text 描画で
// レンダリングが platform 跨いで安定。bbs.tsx の色定義と完全に揃えている。
const CATEGORIES: ReadonlyArray<{ label: string; color: string; glyph: string }> = [
  { label: '雑談',     color: '#22D3A4', glyph: 'T' },
  { label: 'アニメ',   color: '#FF6B7A', glyph: 'A' },
  { label: 'ゲーム',   color: '#7CB1FF', glyph: 'G' },
  { label: 'マンガ',   color: '#F472B6', glyph: 'M' },
  { label: '音楽',     color: '#FCD34D', glyph: 'M' },
  { label: 'アイドル', color: '#FF8C30', glyph: 'I' },
  { label: 'Vtuber',   color: '#A78BFA', glyph: 'V' },
  { label: '推し活',   color: '#EC4899', glyph: 'O' },
  { label: 'グルメ',   color: '#84CC16', glyph: 'F' },
  { label: 'コスプレ', color: '#06B6D4', glyph: 'C' },
  { label: 'ニュース', color: '#94A3B8', glyph: 'N' },
];

const COLUMNS = 2;
const GLYPH_SIZE = 32;

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
            glyph={cat.glyph}
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
  glyph,
  color,
  onPress,
}: {
  label: string;
  glyph: string;
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
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
            paddingHorizontal: SP['3'],
            paddingVertical: SP['3'],
            // iOS-native: list row 風の radius (14)
            borderRadius: R.lg,
            backgroundColor: C.bg2,
            borderWidth: 1,
            borderColor: C.border,
          },
          SHADOW.xs,
        ]}
      >
        {/* SF Symbols 風: 色付きの正方形 (radius 8) 内に glyph 1 文字 */}
        <View
          style={{
            width: GLYPH_SIZE,
            height: GLYPH_SIZE,
            borderRadius: 8,
            backgroundColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: '700',
              color: '#0a0a0a',
              letterSpacing: -0.3,
            }}
          >
            {glyph}
          </Text>
        </View>
        <Text
          style={[
            T.bodyB,
            { color: C.text, flexShrink: 1, letterSpacing: -0.2 },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}
