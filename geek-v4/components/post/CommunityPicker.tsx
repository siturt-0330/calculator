// ============================================================
// CommunityPicker — 投稿先コミュニティの multi-select picker
// ============================================================
// app/post/create.tsx から抽出。
// visibility が 'community_only' / 'community_public' のときだけ表示する
// (親側で showCommunityPicker を判定し、true のときだけ描画する想定)。
//
// fully controlled component — state は親が握る:
//   - query / onQueryChange: 検索 input
//   - results: 表示する候補 (親側で query で filter 済み)
//   - selected (Community[]): 選択中の community
//   - loading: 検索中フラグ
//   - myCommunitiesEmpty: そもそも参加コミュ 0 件の時の empty state 切り替え用
//   - onToggle / onRemove: 選択操作
// ============================================================
import { Image, Text, View } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { Input } from '../ui/Input';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';

const CommunityIcon = Icon.community;
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import type { Community } from '../../lib/api/communities';

export function CommunityPicker({
  query,
  onQueryChange,
  results,
  selected,
  loading,
  myCommunitiesEmpty,
  onToggle,
  onRemove,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  results: Community[];
  selected: Community[];
  loading: boolean;
  myCommunitiesEmpty: boolean;
  onToggle: (c: Community) => void;
  onRemove: (id: string) => void;
}) {
  const selectedIds = new Set(selected.map((c) => c.id));

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      layout={Layout.springify().damping(20)}
      style={{ gap: SP['2'] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
        <CommunityIcon size={14} color={C.text2} strokeWidth={2.2} />
        <Text style={[T.smallM, { color: C.text2, flex: 1 }]}>
          コミュニティを選ぶ (複数選択可)
        </Text>
        {selected.length > 0 && (
          <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
            {selected.length} 件選択中
          </Text>
        )}
      </View>

      {/* 選択済みコミュニティ pills */}
      {selected.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
          {selected.map((c) => (
            <PressableScale
              key={c.id}
              onPress={() => onRemove(c.id)}
              haptic="warn"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: SP['3'],
                paddingVertical: 6,
                borderRadius: R.full,
                backgroundColor: C.accent + '20',
                borderWidth: 1,
                borderColor: C.accent,
              }}
            >
              <View
                style={{
                  width: 18, height: 18, borderRadius: 9,
                  backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                  alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {c.icon_url ? (
                  <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <Text style={{ fontSize: 11 }}>{c.icon_emoji}</Text>
                )}
              </View>
              <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]} numberOfLines={1}>
                {c.name}
              </Text>
              <X size={12} color={C.accentLight} strokeWidth={2.6} />
            </PressableScale>
          ))}
        </View>
      )}

      {/* 検索 input */}
      <Input
        placeholder="参加中のコミュニティを検索"
        value={query}
        onChangeText={onQueryChange}
        icon={Icon.search}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* 検索結果 */}
      <View style={{
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}>
        {loading && results.length === 0 ? (
          <View style={{ padding: SP['4'], alignItems: 'center' }}>
            <Text style={[T.caption, { color: C.text3 }]}>検索中…</Text>
          </View>
        ) : results.length === 0 ? (
          <View style={{ padding: SP['4'], alignItems: 'center', gap: 6 }}>
            {myCommunitiesEmpty ? (
              <>
                <Text style={[T.body, { color: C.text2, textAlign: 'center' }]}>
                  まだコミュニティに参加していません
                </Text>
                <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
                  参加してから、そのコミュニティに投稿できます
                </Text>
              </>
            ) : (
              <Text style={[T.caption, { color: C.text3 }]}>
                「{query.trim()}」 と一致する参加中コミュニティがありません
              </Text>
            )}
          </View>
        ) : (
          results.map((c, idx) => {
            const isSelected = selectedIds.has(c.id);
            return (
              <PressableScale
                key={c.id}
                onPress={() => onToggle(c)}
                haptic="tap"
                scaleValue={0.99}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['3'],
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['3'],
                  backgroundColor: isSelected ? C.accent + '15' : 'transparent',
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderTopColor: C.divider,
                }}
              >
                <View
                  style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                    alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {c.icon_url ? (
                    <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  ) : (
                    <Text style={{ fontSize: 18 }}>{c.icon_emoji}</Text>
                  )}
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                    メンバー {c.member_count.toLocaleString('ja-JP')} 人
                  </Text>
                </View>
                <View
                  style={{
                    width: 22, height: 22, borderRadius: 11,
                    borderWidth: isSelected ? 0 : 1.5,
                    borderColor: C.border2,
                    backgroundColor: isSelected ? C.accent : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {isSelected && <Icon.ok size={14} color="#fff" strokeWidth={2.8} />}
                </View>
              </PressableScale>
            );
          })
        )}
      </View>
    </Animated.View>
  );
}
