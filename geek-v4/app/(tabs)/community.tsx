import { View, Text, ScrollView, RefreshControl, Image } from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { TABBAR } from '../../design/tabbar';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../../components/ui/PressableScale';
import { EmptyState } from '../../components/ui/EmptyState';
import { fetchMyCommunities, fetchMyCommunityFeed } from '../../lib/api/communities';
import type { Community, CommunityPostWithCommunity } from '../../lib/api/communities';
import { useAuthStore } from '../../stores/authStore';

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 時間前`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 日前`;
  return new Date(iso).toLocaleDateString('ja-JP');
}

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [posts, setPosts] = useState<CommunityPostWithCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [comms, feed] = await Promise.all([
      fetchMyCommunities(),
      fetchMyCommunityFeed(40),
    ]);
    setMyCommunities(comms);
    setPosts(feed);
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [user, load]);

  // タブ復帰時に最新化
  useFocusEffect(
    useCallback(() => {
      if (user) void load();
    }, [user, load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* 上部ヘッダ — YouTube のロゴ列に相当 */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
          backgroundColor: C.bg,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <Text style={[T.h2, { flex: 1, color: C.text }]}>コミュニティ</Text>
        <PressableScale
          onPress={() => router.push('/community/discover' as never)}
          haptic="tap"
          style={{ padding: SP['2'] }}
        >
          <Icon.search size={22} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale
          onPress={() => router.push('/community/create' as never)}
          haptic="confirm"
          style={{
            paddingHorizontal: SP['3'],
            paddingVertical: SP['2'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: C.accent,
            borderRadius: R.full,
          }}
        >
          <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
          <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>作成</Text>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + TABBAR.height + SP['6'],
        }}
        refreshControl={
          <RefreshControl tintColor={C.text2} refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* 横スクロール: 自分の所属コミュニティ */}
        <View style={{ paddingTop: SP['4'], paddingBottom: SP['3'] }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SP['4'], gap: SP['3'] }}
          >
            {myCommunities.length === 0 && !loading ? (
              <View
                style={{
                  paddingVertical: SP['3'],
                  paddingHorizontal: SP['4'],
                  backgroundColor: C.bg2,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderStyle: 'dashed',
                }}
              >
                <Text style={[T.small, { color: C.text3 }]}>
                  まだコミュニティに参加していません
                </Text>
              </View>
            ) : (
              myCommunities.map((c) => (
                <PressableScale
                  key={c.id}
                  onPress={() => router.push(`/community/${c.id}` as never)}
                  haptic="tap"
                  style={{ alignItems: 'center', width: 70 }}
                >
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderColor: C.border,
                      overflow: 'hidden',
                    }}
                  >
                    {c.icon_url ? (
                      <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : (
                      <Text style={{ fontSize: 28 }}>{c.icon_emoji}</Text>
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      T.caption,
                      { color: C.text2, marginTop: 4, textAlign: 'center' },
                    ]}
                  >
                    {c.name}
                  </Text>
                </PressableScale>
              ))
            )}

            {/* 末尾に「探す」ボタン */}
            <PressableScale
              onPress={() => router.push('/community/discover' as never)}
              haptic="tap"
              style={{ alignItems: 'center', width: 70 }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: C.bg3,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: C.border,
                  borderStyle: 'dashed',
                }}
              >
                <Icon.search size={22} color={C.text3} strokeWidth={2.2} />
              </View>
              <Text
                numberOfLines={1}
                style={[T.caption, { color: C.text3, marginTop: 4, textAlign: 'center' }]}
              >
                探す
              </Text>
            </PressableScale>
          </ScrollView>
        </View>

        {/* 区切り */}
        <View style={{ height: 1, backgroundColor: C.divider, marginHorizontal: SP['4'] }} />

        {/* 最新投稿フィード */}
        <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['4'], gap: SP['3'] }}>
          {posts.length === 0 ? (
            <View style={{ paddingTop: SP['10'] }}>
              <EmptyState
                icon={Icon.community}
                title={myCommunities.length === 0 ? 'コミュニティに参加しよう' : 'まだ投稿がありません'}
                message={
                  myCommunities.length === 0
                    ? '好きなテーマで集まれる場所。検索して参加するか、自分で作ろう。'
                    : '所属コミュニティの新着投稿がここに表示されます。'
                }
              />
              {myCommunities.length === 0 && (
                <View style={{ gap: SP['2'], marginTop: SP['4'] }}>
                  <PressableScale
                    onPress={() => router.push('/community/discover' as never)}
                    haptic="confirm"
                    style={{
                      paddingVertical: SP['3'],
                      backgroundColor: C.accent,
                      borderRadius: R.md,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={[T.bodyMd, { color: '#fff', fontWeight: '700' }]}>
                      コミュニティを探す
                    </Text>
                  </PressableScale>
                  <PressableScale
                    onPress={() => router.push('/community/create' as never)}
                    haptic="tap"
                    style={{
                      paddingVertical: SP['3'],
                      backgroundColor: C.bg3,
                      borderRadius: R.md,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={[T.bodyMd, { color: C.text, fontWeight: '600' }]}>
                      新しく作る
                    </Text>
                  </PressableScale>
                </View>
              )}
            </View>
          ) : (
            posts.map((p) => (
              <PressableScale
                key={p.id}
                onPress={() => router.push(`/community/${p.community_id}` as never)}
                haptic="tap"
                scaleValue={0.985}
                style={{
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  padding: SP['3'],
                  gap: SP['2'],
                }}
              >
                {/* ヘッダ行: アイコン + コミュ名 + 時刻 */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: p.community?.icon_url
                        ? C.bg3
                        : (p.community?.icon_color ?? C.accent),
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {p.community?.icon_url ? (
                      <Image source={{ uri: p.community.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : (
                      <Text style={{ fontSize: 16 }}>{p.community?.icon_emoji ?? '👥'}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                      {p.community?.name ?? 'コミュニティ'}
                    </Text>
                    <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                      {p.author_nickname ?? '匿名'} · {timeAgo(p.created_at)}
                    </Text>
                  </View>
                </View>
                {/* 本文 */}
                <Text style={[T.body, { color: C.text }]} numberOfLines={4}>
                  {p.body}
                </Text>
                {p.image_url && (
                  <Image
                    source={{ uri: p.image_url }}
                    style={{
                      width: '100%',
                      aspectRatio: 16 / 9,
                      borderRadius: R.md,
                      backgroundColor: C.bg3,
                    }}
                    resizeMode="cover"
                  />
                )}
              </PressableScale>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
