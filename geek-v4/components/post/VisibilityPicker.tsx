import { useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Icon, type IconName } from '../../constants/icons';
import { SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { useColors } from '../../hooks/useColors';
import { hapticPresets } from '../../lib/haptics';

// ============================================================
// VisibilityPicker — 投稿の公開範囲を 4 つの minimal card から選ぶ
// ------------------------------------------------------------
// Reddit / X 系の minimal card UI を踏襲。2x2 grid で 4 つの選択肢を並べ、
// 選択中の card には accent border + accentSoft bg + 右上 check indicator を
// 出す。tap で onChange + haptic light + Reanimated spring scale 0.97 → 1.0。
//
// 設計メモ:
//   - icon は constants/icons.ts の alias を使用 (lucide tree-shaking 効かせる)
//     self → lock / public → globe / community → community (Users2) / mention → at
//   - press scale は worklet で UI スレッド (60fps)
//   - 各 card は flexBasis 48% で 2x2 を組む (gap で隙間)
//   - description は 2 行 + numberOfLines=2 で overflow 防止
//   - 選択中は border 2pt accent / 非選択は border 1pt C.border
//   - dark / light は useColors() で palette 自動切替
// ============================================================

export type Visibility = 'self' | 'public' | 'community' | 'mention';

type Props = {
  value: Visibility;
  onChange: (v: Visibility) => void;
};

type Option = {
  value: Visibility;
  label: string;
  description: string;
  iconKey: IconName;
};

// icon alias は constants/icons.ts に揃える:
//   - users → 'community' (Users2, 2 人アイコン)
//   - atSign → 'at' (AtSign)
const OPTIONS: ReadonlyArray<Option> = [
  { value: 'self', label: '自分だけ', description: '下書き。あなただけに見える', iconKey: 'lock' },
  { value: 'public', label: '一般公開', description: 'ホームと検索に公開', iconKey: 'globe' },
  { value: 'community', label: 'コミュニティ', description: '指定コミュニティに投稿', iconKey: 'community' },
  { value: 'mention', label: '指定して公開', description: '特定の人にだけ通知', iconKey: 'at' },
];

const CARD_HEIGHT = 96;
const CARD_RADIUS = 14;
const CARD_PADDING = 14;
const PRESS_SCALE = 0.97;
// snappy spring — Apple HIG 風の "tap" 体感 (PressableScale 系と揃える)
const SPRING_CFG = { damping: 18, stiffness: 280, mass: 0.6 } as const;

export function VisibilityPicker({ value, onChange }: Props) {
  const C = useColors();

  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SP['3'],
      }}
    >
      {OPTIONS.map((opt) => (
        <VisibilityCard
          key={opt.value}
          option={opt}
          selected={value === opt.value}
          onPress={() => {
            if (value !== opt.value) {
              hapticPresets.light();
            }
            onChange(opt.value);
          }}
          accent={C.accent}
          accentSoft={C.accentSoft}
          accentFg="#ffffff"
          textColor={C.text}
          text2Color={C.text2}
          borderColor={C.border}
          bgColor={C.bg2}
        />
      ))}
    </View>
  );
}

type CardProps = {
  option: Option;
  selected: boolean;
  onPress: () => void;
  accent: string;
  accentSoft: string;
  accentFg: string;
  textColor: string;
  text2Color: string;
  borderColor: string;
  bgColor: string;
};

function VisibilityCard({
  option,
  selected,
  onPress,
  accent,
  accentSoft,
  accentFg,
  textColor,
  text2Color,
  borderColor,
  bgColor,
}: CardProps) {
  const scale = useSharedValue<number>(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(PRESS_SCALE, SPRING_CFG);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_CFG);
  }, [scale]);

  const IconComp = Icon[option.iconKey];
  const CheckComp = Icon.ok;

  return (
    <Animated.View style={[{ flexBasis: '48%', flexGrow: 1 }, animatedStyle]}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={option.label}
        accessibilityHint={option.description}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        hitSlop={4}
        style={{
          height: CARD_HEIGHT,
          borderRadius: CARD_RADIUS,
          padding: CARD_PADDING,
          backgroundColor: selected ? accentSoft : bgColor,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? accent : borderColor,
          // selected 時に border 2pt 増える分の inset 調整 (= ぶれ防止)
          // padding は上下対称のまま、border を内側に詰めて見せる
          justifyContent: 'space-between',
        }}
      >
        {/* 右上の check indicator (selected のみ) */}
        {selected ? (
          <View
            accessible={false}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckComp size={12} color={accentFg} strokeWidth={3} />
          </View>
        ) : null}

        {/* top: icon */}
        <IconComp size={24} color={accent} strokeWidth={2} />

        {/* bottom: label + description */}
        <View style={{ gap: 2 }}>
          <Text
            numberOfLines={1}
            style={[
              T.smallM,
              { fontSize: 15, lineHeight: 20, color: textColor, fontWeight: '600' },
            ]}
          >
            {option.label}
          </Text>
          <Text
            numberOfLines={2}
            style={[T.caption, { fontSize: 11, lineHeight: 14, color: text2Color }]}
          >
            {option.description}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
