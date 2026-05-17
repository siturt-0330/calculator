import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTagFilter } from '@/hooks/useTagFilter';
import { TagPill } from '@/components/tag/TagPill';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Icon } from '@/constants/icons';

export default function BlockedListScreen() {
  const insets = useSafeAreaInsets();
  const { blockedTags, removeBlocked } = useTagFilter();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="ブロックリスト" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
      >
        <View style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
        }}>
          <Text style={[T.h4, { color: C.text, marginBottom: SP['3'] }]}>
            ブロック中のタグ ({blockedTags.length})
          </Text>
          {blockedTags.length === 0 ? (
            <Text style={[T.small, { color: C.text3 }]}>
              ブロック中のタグはありません
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {blockedTags.map((t) => (
                <TagPill key={t} name={t} state="blocked" onPress={() => removeBlocked(t)} />
              ))}
            </View>
          )}
        </View>

        <View style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
        }}>
          <Text style={[T.h4, { color: C.text, marginBottom: SP['2'] }]}>
            ブロック中のユーザー
          </Text>
          <Text style={[T.small, { color: C.text3 }]}>
            ブロック中のユーザーはいません
          </Text>
        </View>

        {blockedTags.length === 0 && (
          <EmptyState
            icon={Icon.block}
            title="ブロックリストは空です"
            message="気になるタグやユーザーは投稿から直接ブロックできます"
          />
        )}
      </ScrollView>
    </View>
  );
}
