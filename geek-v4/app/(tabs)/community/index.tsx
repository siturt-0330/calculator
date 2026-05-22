import { View, Text, ScrollView, RefreshControl, Image } from 'react-native';
import { useEffect, useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { TABBAR } from '../../../design/tabbar';
import { Icon } from '../../../constants/icons';
import { PressableScale } from '../../../components/ui/PressableScale';
import { EmptyState } from '../../../components/ui/EmptyState';
import { OfficialBadge } from '../../../components/community/OfficialBadge';
import {
  fetchMyCommunities,
  fetchMyCommunityFeed,
  subscribeToMyCommunityChanges,
} from '../../../lib/api/communities';
import { useAuthStore } from '../../../stores/authStore';

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
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  // React Query 化 — 旧 useState+useEffect だと:
  //   - 別画面で join しても戻った時に古いリストが見える (stale)
  //   - ネットワーク失敗時の自動 retry がない
  //   - キャッシュ統一されておらず複数画面で重複 fetch
  // を解決する。
  const myCommunitiesQuery = useQuery({
    queryKey: ['my-communities', user?.id],
    queryFn: fetchMyCommunities,
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const feedQuery = useQuery({
    queryKey: ['my-community-feed', user?.id],
    queryFn: () => fetchMyCommunityFeed(40),
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const myCommunities = myCommunitiesQuery.data ?? [];
  const posts = feedQuery.data ?? [];
  const loading = myCommunitiesQuery.isLoading || feedQuery.isLoading;
  const refreshing = myCommunitiesQuery.isFetching && !myCommunitiesQuery.isLoading;

  // realtime: 自分が別画面で join/leave した時に即時反映
  useEffect(() => {
    if (!user?.id) return;
    const sub = subscribeToMyCommunityChanges(user.id, () => {
      qc.invalidateQueries({ queryKey: ['my-communities', user.id] });
      qc.invalidateQueries({ queryKey: ['my-community-feed', user.id] });
    });
    return () => sub.unsubscribe();
  }, [user?.id, qc]);

  // タブ復帰時に refetch (ただし staleTime 内ならキャッシュ使用)
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void qc.invalidateQueries({ queryKey: ['my-communities', user.id] });
      void qc.invalidateQueries({ queryKey: ['my-community-feed', user.id] });
    }, [user?.id, qc]),
  );

  const onRefresh = useCallback(async () => {
    if (!user?.id) return;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['my-communities', user.id] }),
      qc.invalidateQueries({ queryKey: ['my-community-feed', user.id] }),
    ]);
  }, [user?.id, qc]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* 上部ヘッダ */}
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
        <Text style={[T.h2, { flex: 1, color: C.text, letterSpacing: -0.5 }]}>コミュニティ</Text>
        <PressableScale
          onPress={() => router.push('/community/discover' as never)}
          haptic="tap"
          style={{ padding: SP['2'] }}
          accessibilityLabel="コミュニティを検索"
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
            ...SHADOW.accentGlow,
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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: SP['4'],
              marginBottom: SP['2'],
            }}
          >
            <Text style={[T.smallB, { color: C.text2, letterSpacing: 0.4, fontWeight: '700' }]}>
              参加中
              {myCommunities.length > 0 && (
                <Text style={[T.smallB, { color: C.text3 }]}>  {myCommunities.length}</Text>
              )}
            </Text>
            {myCommunities.length > 4 && (
              <Text style={[T.caption, { color: C.text3 }]}>← スワイプで全部見る</Text>
            )}
          </View>
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
                  <View style={{ position: 'relative' }}>
                    <View
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 28,
                        backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: c.is_official ? 2 : 1,
                        borderColor: c.is_official ? C.accent : C.border,
                        overflow: 'hidden',
                      }}
                    >
                      {c.icon_url ? (
                        <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: 28 }}>{c.icon_emoji}</Text>
                      )}
                    </View>
                    {c.is_official && (
                      <View
                        style={{
                          position: 'absolute',
                          right: -2,
                          bottom: -2,
                          borderWidth: 2,
                          borderColor: C.bg,
                          borderRadius: R.full,
                        }}
                      >
                        <OfficialBadge size="sm" iconOnly />
                      </View>
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[T.caption, { color: C.text2, marginTop: 4, textAlign: 'center' }]}
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
                // 監査指摘: 同じ post が複数コミュに attach されると key={p.id} で衝突する。
                // community_id を合成 key にして React の重複警告と稀ちらつきを回避。
                key={`${p.community_id}:${p.id}`}
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={[T.smallM, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                        {p.community?.name ?? 'コミュニティ'}
                      </Text>
                      {p.community?.is_official && <OfficialBadge size="sm" />}
                    </View>
                    <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                      {p.official_author
                        ? `${p.official_author.name || '公式管理者'}${p.official_author.organization ? ` · ${p.official_author.organization}` : ''} · ${timeAgo(p.created_at)}`
                        : `${p.author_nickname ?? '匿名'} · ${timeAgo(p.created_at)}`}
                    </Text>
                  </View>
                </View>
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
