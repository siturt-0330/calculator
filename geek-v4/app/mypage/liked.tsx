import { View, Text } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonRow } from '../../components/ui/SkeletonRow';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { useAuthStore } from '../../stores/authStore';
import { ObsidianSaveButton } from '../../components/ui/ObsidianSaveButton';
import { postToObsidianNote } from '../../hooks/useObsidian';

type Item = {
  id: string;
  content: string;
  tag_names: string[];
  likes_count: number;
  comments_count: number;
  created_at: string;
};

async function fetchLikedPosts(): Promise<Item[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data: likes } = await supabase
    .from('likes')
    .select('post_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (!likes || likes.length === 0) return [];
  const postIds = likes.map((s: { post_id: string }) => s.post_id);
  const { data: posts } = await supabase
    .from('posts')
    .select('id, content, tag_names, likes_count, comments_count, created_at')
    .in('id', postIds);
  const map = new Map((posts ?? []).map((p: Item) => [p.id, p]));
  return postIds.map((id) => map.get(id)).filter(Boolean) as Item[];
}

export default function LikedPosts() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // 別ユーザーが同一端末でログインした際、永続キャッシュ経由で前ユーザーの
  // 「いいね」リストが見えてしまうのを防ぐため queryKey を userId でスコープ化。
  const userId = useAuthStore((s) => s.user?.id);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['liked-posts', userId],
    queryFn: fetchLikedPosts,
    enabled: !!userId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="いいねした投稿" left={<BackButton />} />
      {isLoading ? (
        // skeleton list — ActivityIndicator より「内容が来る」感が出る
        <View style={{ padding: SP['4'] }}>
          <SkeletonRow kind="list-item" count={6} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ padding: SP['4'] }}>
          <EmptyState
            icon={Icon.heart}
            title="まだ いいね した投稿はありません"
            message="気になる投稿のハートをタップすると、ここに集まります"
            actionLabel="フィードを見る"
            onAction={() => router.push('/(tabs)/feed' as never)}
            tone="pink"
          />
        </View>
      ) : (
        // 100 件まで取得し得るので virtualization (FlashList) で描画コスト削減。
        // 元は ScrollView + .map() で全件を初回 mount 時に作っていた。
        <FlashList
          data={items}
          keyExtractor={(p) => p.id}
          // 3 行 numberOfLines + メタ 2 行 で約 140px
          estimatedItemSize={140}
          drawDistance={250}
          // FlashList 1.7.3 は recycler で virtualization 済み。removeClippedSubviews は no-op のため撤去。
          decelerationRate="fast"
          contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'] }}
          ListHeaderComponent={
            // 件数ヘッダー — 「30 件 / 100 件まで保存」のように上限も示す
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: SP['1'],
              paddingBottom: SP['2'],
              gap: SP['2'],
            }}>
              <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>
                {items.length} 件
              </Text>
              <Text style={[T.caption, { color: C.text3 }]}>· 新しい順</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: SP['2'] }} />}
          renderItem={({ item: p }) => (
            <PressableScale
              onPress={() => router.push(`/post/${p.id}` as never)}
              haptic="tap"
              style={{
                padding: SP['3'],
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                gap: SP['2'],
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                <Avatar size={20} anonymous />
                <Text style={[T.caption, { color: C.accent }]}>
                  {p.tag_names[0] ? `#${p.tag_names[0]}` : '#雑談'}
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>· {formatRelative(p.created_at)}</Text>
                <View style={{ flex: 1 }} />
                <ObsidianSaveButton note={postToObsidianNote(p as never)} size={16} />
              </View>
              <Text style={[T.body, { color: C.text }]} numberOfLines={3}>{p.content}</Text>
              <View style={{ flexDirection: 'row', gap: SP['3'] }}>
                <Text style={[T.caption, { color: C.pink }]}>♥ {p.likes_count}</Text>
                <Text style={[T.caption, { color: C.text3 }]}>💬 {p.comments_count}</Text>
              </View>
            </PressableScale>
          )}
        />
      )}
    </View>
  );
}
