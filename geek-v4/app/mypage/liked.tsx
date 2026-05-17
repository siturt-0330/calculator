import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { PressableScale } from '@/components/ui/PressableScale';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { formatRelative } from '@/lib/utils/date';

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
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['liked-posts'],
    queryFn: fetchLikedPosts,
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="いいねした投稿" left={<BackButton />} />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['10'], gap: SP['2'] }}
        >
          {items.length === 0 ? (
            <EmptyState
              icon={Icon.heart}
              title="いいねした投稿はありません"
              message="気に入った投稿のハートを押すとここに表示されます"
              tone="pink"
            />
          ) : (
            items.map((p) => (
              <PressableScale
                key={p.id}
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
                </View>
                <Text style={[T.body, { color: C.text }]} numberOfLines={3}>{p.content}</Text>
                <View style={{ flexDirection: 'row', gap: SP['3'] }}>
                  <Text style={[T.caption, { color: C.pink }]}>♥ {p.likes_count}</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>💬 {p.comments_count}</Text>
                </View>
              </PressableScale>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
