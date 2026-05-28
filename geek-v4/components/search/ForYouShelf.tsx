// ============================================================
// ForYouShelf — 「あなたへのおすすめ」 2x3 グリッド
// ------------------------------------------------------------
// ログイン中ユーザー向け パーソナライズ投稿 (fetchPosts sort='for-you')。
// 未ログインなら何も描画しない (auth required signal)。
// - 2 列 x 3 行 = 6 件 (limit=6 で固定)
// - 各カードは小型 (title + サムネ縮小版 + like count)
// - tap → /post/[id]
// ============================================================
import { useMemo } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '../../hooks/useColors';
import { useAuthStore } from '../../stores/authStore';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { fetchPosts } from '../../lib/api/posts';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { sanitizeUrl } from '../../lib/sanitize';
import type { Post } from '../../types/models';

const COLUMNS = 2;
const ROWS = 3;
const LIMIT = COLUMNS * ROWS;
const GAP = SP['2']; // 8px

export function ForYouShelf() {
  const C = useColors();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  // 親 padding は paddingHorizontal: SP['4'] (16) を想定
  const cardWidth = Math.floor(
    (screenWidth - SP['4'] * 2 - GAP * (COLUMNS - 1)) / COLUMNS,
  );

  const { data, isLoading } = useQuery({
    queryKey: ['for-you-shelf', userId, LIMIT],
    queryFn: async () => {
      if (!userId) return [] as Post[];
      const r = await fetchPosts({
        sort: 'for-you',
        likedTags: [],
        blockedTags: [],
        limit: LIMIT,
        home: true,
      });
      return r.posts.slice(0, LIMIT);
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  // 未ログイン → 描画しない (親はこの section の高さを 0 で扱える)
  if (!userId) return null;

  if (isLoading) {
    // skeleton: 「For You」ヘッダー + grid 6 セル分の placeholder
    return (
      <View style={{ gap: SP['3'] }}>
        <ForYouHeader C={C} />
        <View
          style={{
            paddingHorizontal: SP['4'],
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: GAP,
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View
              key={`sk-${i}`}
              style={{
                width: cardWidth,
                height: Math.round((cardWidth * 5) / 4),
                borderRadius: R.lg,
                backgroundColor: C.bg2,
                borderWidth: 1,
                borderColor: C.border,
                opacity: 0.6,
              }}
            />
          ))}
        </View>
        <ActivityIndicator color={C.accent} style={{ position: 'absolute', top: 60, alignSelf: 'center' }} />
      </View>
    );
  }

  const posts = data ?? [];
  if (posts.length === 0) return null;

  return (
    <View style={{ gap: SP['3'] }}>
      <ForYouHeader C={C} />
      <View
        style={{
          paddingHorizontal: SP['4'],
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: GAP,
        }}
      >
        {posts.map((p) => (
          <ForYouCard
            key={p.id}
            post={p}
            width={cardWidth}
            onPress={() => router.push(`/post/${p.id}` as never)}
          />
        ))}
      </View>
    </View>
  );
}

// ============================================================
// ForYouHeader — iOS の large title 風 (semibold, 22pt, tracking -0.3)
// ============================================================
function ForYouHeader({ C }: { C: ReturnType<typeof useColors> }) {
  return (
    <View
      style={{
        paddingHorizontal: SP['4'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
      }}
    >
      <Icon.sparkles size={18} color={C.accent} strokeWidth={2.2} />
      <Text
        style={[
          T.h3,
          {
            color: C.text,
            letterSpacing: -0.3,
            fontWeight: '700',
          },
        ]}
      >
        For You
      </Text>
    </View>
  );
}

function ForYouCard({
  post,
  width,
  onPress,
}: {
  post: Post;
  width: number;
  onPress: () => void;
}) {
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

  const title = useMemo(() => {
    const firstLine = (post.content ?? '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 0 ? firstLine.slice(0, 60) : '';
  }, [post.content]);

  // height はおおよそ 4:5 比率 (Reddit For You カード比率) + footer
  const height = Math.round((width * 5) / 4);

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.96}
      style={[
        {
          width,
          height,
          borderRadius: R.lg,
          backgroundColor: C.bg2,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        },
        SHADOW.xs,
      ]}
      accessibilityLabel={`投稿を開く: ${title}`}
    >
      {/* サムネ (あれば上半分) */}
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

      {/* タイトル */}
      <View
        style={{
          paddingHorizontal: SP['2'] + 2,
          paddingTop: SP['2'],
          paddingBottom: 6,
          flex: thumbSource ? 0 : 1,
          justifyContent: thumbSource ? 'flex-start' : 'center',
        }}
      >
        <Text
          style={[T.smallB, { color: C.text }]}
          numberOfLines={thumbSource ? 2 : 4}
        >
          {title}
        </Text>
      </View>

      {/* footer (like) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: SP['2'] + 2,
          paddingBottom: 6,
        }}
      >
        <Icon.heart size={10} color={C.text3} strokeWidth={2.2} />
        <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>
          {post.likes_count.toLocaleString('ja-JP')}
        </Text>
      </View>
    </PressableScale>
  );
}
