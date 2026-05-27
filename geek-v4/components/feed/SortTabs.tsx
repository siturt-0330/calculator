import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP, GRAD, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { useT } from '../../lib/i18n';
import type { SortMode } from '../../lib/api/posts';

// label は ja 文字列を直接書いて、表示時に useT で翻訳。DICT 側で en/zh/ko/es/fr 対応済。
// 'rising' は Reddit 風「直近 3h で likes/分 が速い post」— 既存 'hot' (= 累積 like) とは
// 別軸なので並列で出す。視覚的に区別するため 🚀 icon prefix を付与している。
// rising の label key は DICT に無いので useT は as-is で返す (= 多言語でも日本語 + 🚀)。
const ORDER: ReadonlyArray<{ v: SortMode; label: string; icon?: string }> = [
  { v: 'for-you', label: 'あなた向け' },
  { v: 'new', label: '新着' },
  { v: 'rising', label: '急上昇', icon: '🚀' },
  { v: 'hot', label: '急上昇' },
  { v: 'top', label: '人気' },
];

export function SortTabs({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  const t = useT();
  return (
    <View
      style={{
        flexDirection: 'row',
        // inactive は subtle (灰色背景) — bg3 で柔らかい segmented container 風
        backgroundColor: C.bg3,
        borderRadius: R.full,
        padding: 3,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      {ORDER.map((m) => {
        const active = value === m.v;
        // active 時は GRAD.primary のグラデを overlay。inactive は背景透明で
        // container の bg3 がそのまま見える。
        return (
          <PressableScale
            key={m.v}
            onPress={() => onChange(m.v)}
            haptic="select"
            style={{
              flex: 1,
              paddingVertical: SP['2'],
              paddingHorizontal: SP['2'],
              borderRadius: R.full,
              alignItems: 'center',
              overflow: 'hidden',
              // active の場合だけ subtle glow を付けて「選ばれている」感を出す
              ...(active ? SHADOW.glow : null),
            }}
          >
            {active && (
              <LinearGradient
                colors={GRAD.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                }}
              />
            )}
            <Text
              style={[
                T.smallM,
                {
                  color: active ? '#fff' : C.text2,
                  fontWeight: active ? '700' : '500',
                  letterSpacing: active ? 0.3 : 0,
                },
              ]}
            >
              {m.icon ? `${m.icon} ` : ''}{t(m.label)}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
