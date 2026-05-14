import { ScrollView, View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '@/components/ui/PressableScale';
import { C, R, SP, GRAD } from '@/design/tokens';
import { T } from '@/design/typography';

export function FeedHeader({
  tags,
  onTagPress,
  onAddPress,
}: {
  tags: { name: string; trending?: boolean }[];
  onTagPress: (name: string) => void;
  onAddPress: () => void;
}) {
  return (
    <View style={{ paddingVertical: SP['3'], borderBottomWidth: 1, borderBottomColor: C.border }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP['4'], gap: SP['3'] }}
      >
        <PressableScale onPress={onAddPress} style={{ alignItems: 'center', gap: SP['1'] }}>
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: C.bg3,
              borderWidth: 1,
              borderColor: C.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[T.h2, { color: C.text2 }]}>+</Text>
          </View>
          <Text style={[T.caption, { color: C.text2 }]}>追加</Text>
        </PressableScale>

        {tags.map((tag) => (
          <PressableScale
            key={tag.name}
            onPress={() => onTagPress(tag.name)}
            style={{ alignItems: 'center', gap: SP['1'] }}
          >
            <LinearGradient
              colors={tag.trending ? ([...GRAD.accent] as [string, string]) : ([C.border2, C.border] as [string, string])}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 2, borderRadius: 32 }}
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: C.bg2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: C.bg,
                }}
              >
                <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
                  #{tag.name.slice(0, 4)}
                </Text>
              </View>
            </LinearGradient>
            <Text style={[T.caption, { color: C.text2, maxWidth: 64 }]} numberOfLines={1}>
              {tag.name}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}
