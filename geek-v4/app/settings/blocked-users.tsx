import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { PressableScale } from '../../components/ui/PressableScale';
import { useTagFilter } from '../../hooks/useTagFilter';
import { TagPill } from '../../components/tag/TagPill';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

export default function BlockedListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
          <>
            <EmptyState
              icon={Icon.block}
              title="ブロックリストは空です"
              message="気になるタグやユーザーは投稿から直接ブロックできます"
            />
            {/* ヘルプ導線 — ブロックの仕方が分からないユーザー向け */}
            <PressableScale
              onPress={() => router.push('/settings/blocked-tags' as never)}
              haptic="tap"
              style={{
                alignSelf: 'center',
                paddingHorizontal: SP['4'],
                paddingVertical: SP['2'],
                backgroundColor: C.bg2,
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: C.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon.hash size={14} color={C.accent} strokeWidth={2.2} />
              <Text style={[T.smallM, { color: C.accent, fontWeight: '700' }]}>
                タグをブロックする方法
              </Text>
            </PressableScale>
          </>
        )}
      </ScrollView>
    </View>
  );
}
