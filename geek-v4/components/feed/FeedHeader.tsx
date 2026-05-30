import { ScrollView, View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../ui/PressableScale';
import { T } from '../../design/typography';
import { useColors, useGradients } from '../../hooks/useColors';

// ============================================================
// FeedHeader — iOS-native な story-ring 風タグ row
// ------------------------------------------------------------
// 旧: 60px 黒円 + 黄色っぽい LinearGradient ring。やや派手で「タップしてください」
//     感が強かった。
// 新: 56px 円 (iOS Stories と同じサイズ) + subtle ring (border or primary gradient)
//     + SF Pro 風 letterSpacing。trending only に gradient を強調、非 trending は
//     hairline border のみで上品に。divider トークン経由でテーマ対応。
// ============================================================
export function FeedHeader({
  tags,
  onTagPress,
  onAddPress,
}: {
  tags: { name: string; trending?: boolean }[];
  onTagPress: (name: string) => void;
  onAddPress: () => void;
}) {
  const C = useColors();
  const GRAD = useGradients();
  return (
    <View
      style={{
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: C.divider,
        backgroundColor: C.bg,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 18, gap: 14 }}
      >
        {/* 追加ボタン — hairline ring + bg3 で iOS の "add" affordance */}
        <PressableScale
          onPress={onAddPress}
          style={{ alignItems: 'center', gap: 6 }}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel="タグを追加"
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: C.bg3,
              borderWidth: 1,
              borderColor: C.divider,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontSize: 26,
                lineHeight: 30,
                color: C.text2,
                fontWeight: '300',
                includeFontPadding: false,
              }}
            >
              +
            </Text>
          </View>
          <Text
            style={[
              T.caption,
              { color: C.text2, letterSpacing: -0.06 },
            ]}
          >
            追加
          </Text>
        </PressableScale>

        {tags.map((tag) => (
          <PressableScale
            key={tag.name}
            onPress={() => onTagPress(tag.name)}
            style={{ alignItems: 'center', gap: 6 }}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel={`タグ ${tag.name} を見る`}
          >
            {tag.trending ? (
              // trending: 紫→桃の gradient ring (Instagram Stories 風)
              <LinearGradient
                colors={GRAD.primarySoft as readonly [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 2, borderRadius: 30 }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: C.bg2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: C.bg,
                  }}
                >
                  <Text
                    style={[
                      T.bodyB,
                      { color: C.text, letterSpacing: -0.2, fontSize: 14 },
                    ]}
                    numberOfLines={1}
                  >
                    #{tag.name.slice(0, 4)}
                  </Text>
                </View>
              </LinearGradient>
            ) : (
              // 通常: hairline border のみで上品に
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: C.bg2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: C.divider,
                }}
              >
                <Text
                  style={[
                    T.bodyB,
                    { color: C.text, letterSpacing: -0.2, fontSize: 14 },
                  ]}
                  numberOfLines={1}
                >
                  #{tag.name.slice(0, 4)}
                </Text>
              </View>
            )}
            <Text
              style={[
                T.caption,
                { color: C.text2, maxWidth: 64, letterSpacing: -0.06 },
              ]}
              numberOfLines={1}
            >
              {tag.name}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}
