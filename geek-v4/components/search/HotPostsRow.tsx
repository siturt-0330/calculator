// ============================================================
// HotPostsRow — 検索/ディスカバリータブの「Hot 投稿」横スクロール
// ------------------------------------------------------------
// 直近で勢いのある投稿 (sort=hot) を 10 件、Reddit Apollo 風の
// 280x200 カード横スクロールで見せる。
// - title (= content 1 行目) があれば上半分に、サムネがあれば下半分に
// - tap → /post/[id]
// - 1 RTT (fetchPosts) + React Query キャッシュ (staleTime 60s)
// ============================================================
import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '../../hooks/useColors';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { fetchPosts } from '../../lib/api/posts';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { sanitizeUrl } from '../../lib/sanitize';
import type { Post } from '../../types/models';

const CARD_WIDTH = 280;
const CARD_HEIGHT = 200;
const LIMIT = 10;

export function HotPostsRow() {
  const C = useColors();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['hot-posts-row', LIMIT],
    queryFn: async () => {
      const r = await fetchPosts({
        sort: 'hot',
        likedTags: [],
        blockedTags: [],
        limit: LIMIT,
        home: true,
      });
      return r.posts;
    },
    staleTime: 60_000,
  });

  const posts = data ?? [];

  if (isLoading && posts.length === 0) {
    return (
      <View style={{ paddingVertical: SP['6'], alignItems: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (posts.length === 0) return null;

  return (
    <View style={{ gap: SP['2'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: SP['4'],
        }}
      >
        <Icon.sparkles size={14} color={C.text3} strokeWidth={2.2} />
        <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>
          いま盛り上がっている
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: SP['3'],
          paddingHorizontal: SP['4'],
        }}
      >
        {posts.map((p) => (
          <HotPostCard
            key={p.id}
            post={p}
            onPress={() => router.push(`/post/${p.id}` as never)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function HotPostCard({ post, onPress }: { post: Post; onPress: () => void }) {
  const C = useColors();
  const firstMedia = post.media_urls?.[0];
  const safeUrl = useMemo(
    () => (firstMedia ? sanitizeUrl(firstMedia) : null),
    [firstMedia],
  );
  const thumb = useMemo(
    () => (safeUrl ? thumbedUrl(safeUrl, 240) : null),
    [safeUrl],
  );
  const thumbSource = useMemo(() => (thumb ? { uri: thumb } : null), [thumb]);

  // title = content 1 行目を 60 文字までで作成
  const title = useMemo(() => {
    const firstLine = (post.content ?? '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 0 ? firstLine.slice(0, 80) : null;
  }, [post.content]);

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.97}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        borderRadius: R.md,
        backgroundColor: C.bg2,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}
      accessibilityLabel={`投稿を開く: ${title ?? ''}`}
    >
      {/* タイトル */}
      {title ? (
        <View
          style={{
            paddingHorizontal: SP['3'],
            paddingTop: SP['3'],
            paddingBottom: SP['2'],
            flex: thumbSource ? 0 : 1,
            justifyContent: thumbSource ? 'flex-start' : 'center',
          }}
        >
          <Text
            style={[T.bodyB, { color: C.text }]}
            numberOfLines={thumbSource ? 2 : 5}
          >
            {title}
          </Text>
        </View>
      ) : null}

      {/* サムネ */}
      {thumbSource ? (
        <View style={{ flex: 1, backgroundColor: C.bg3 }}>
          <ExpoImage
            source={thumbSource}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
          />
        </View>
      ) : null}

      {/* footer (like 数) */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          paddingHorizontal: SP['3'],
          paddingVertical: 6,
          backgroundColor: 'rgba(0,0,0,0.5)',
        }}
      >
        <Icon.heart size={11} color="#fff" strokeWidth={2.2} />
        <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>
          {post.likes_count.toLocaleString('ja-JP')}
        </Text>
        <Icon.comment size={11} color="#fff" strokeWidth={2.2} />
        <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>
          {post.comments_count.toLocaleString('ja-JP')}
        </Text>
      </View>
    </PressableScale>
  );
}
