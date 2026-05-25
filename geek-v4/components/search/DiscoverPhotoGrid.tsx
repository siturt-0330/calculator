// ============================================================
// DiscoverPhotoGrid — 検索タブの empty 状態用 Instagram 風 3 列写真グリッド
// ------------------------------------------------------------
// 写真ベースで偶然の出会いを増やすため、検索クエリ未入力の時に表示する。
// - 3 列固定 (Instagram と同じ密度)
// - 各セルは 1:1 正方形
// - tap で /post/[id] へ遷移
// - 「もっと見る」ボタンで次の 36 件を append (cursor は created_at)
// ============================================================
import { useState } from 'react';
import {
  View,
  Text,
  Image,
  useWindowDimensions,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import {
  fetchDiscoverMediaPosts,
  type DiscoverMediaPost,
} from '../../lib/api/posts';
import { sanitizeUrl } from '../../lib/sanitize';

const COLUMN_COUNT = 3;
const GAP = 2; // タイトな間隔 — Instagram っぽく
const PAGE_SIZE = 36;

export function DiscoverPhotoGrid() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  // 親 ScrollView は paddingHorizontal: SP['4'] = 16 を想定
  // → 利用可能幅 = screenWidth - 32、gap は 2 × 2 = 4px
  const cellSize = Math.floor((screenWidth - SP['4'] * 2 - GAP * (COLUMN_COUNT - 1)) / COLUMN_COUNT);

  const [pages, setPages] = useState(1);
  const limit = PAGE_SIZE * pages;

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['discover-media-posts', limit],
    queryFn: () => fetchDiscoverMediaPosts({ limit }),
    staleTime: 60_000,
  });

  if (isLoading && posts.length === 0) {
    return (
      <View style={{ padding: SP['8'], alignItems: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <View
        style={{
          padding: SP['6'],
          alignItems: 'center',
          backgroundColor: C.bg2,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.border,
          gap: SP['2'],
        }}
      >
        <Icon.camera size={32} color={C.text3} strokeWidth={1.8} />
        <Text style={[T.small, { color: C.text2, textAlign: 'center' }]}>
          写真付き投稿がまだありません
        </Text>
        <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
          投稿に写真を添えるとここに出ます
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon.camera size={14} color={C.text3} strokeWidth={2.2} />
        <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>
          写真で見つける
        </Text>
      </View>

      {/* グリッド本体 — flexWrap で 3 列に自動折返し */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: GAP,
        }}
      >
        {posts.map((p) => (
          <PhotoCell
            key={p.id}
            post={p}
            size={cellSize}
            onPress={() => router.push(`/post/${p.id}` as never)}
          />
        ))}
      </View>

      {/* もっと見る */}
      {posts.length >= limit && (
        <PressableScale
          onPress={() => setPages((n) => n + 1)}
          haptic="tap"
          style={{
            marginTop: SP['2'],
            paddingVertical: SP['2'] + 2,
            alignItems: 'center',
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text style={[T.smallB, { color: C.text2 }]}>もっと見る</Text>
        </PressableScale>
      )}
    </View>
  );
}

// ============================================================
// PhotoCell — 1 セル (1:1 正方形)。media_urls[0] を thumbnail として
// ============================================================
function PhotoCell({
  post,
  size,
  onPress,
}: {
  post: DiscoverMediaPost;
  size: number;
  onPress: () => void;
}) {
  const firstMedia = post.media_urls[0];
  const safeUrl = firstMedia ? sanitizeUrl(firstMedia) : null;
  const hasMultiple = post.media_urls.length > 1;

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.96}
      accessibilityLabel={`投稿を開く: ${post.content.slice(0, 30)}`}
      style={{
        width: size,
        height: size,
        backgroundColor: C.bg3,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {safeUrl ? (
        <Image
          source={{ uri: safeUrl }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.camera size={20} color={C.text3} strokeWidth={1.8} />
        </View>
      )}
      {/* 複数枚インジケーター (Instagram 風) */}
      {hasMultiple && (
        <View
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: R.sm,
            paddingHorizontal: 4,
            paddingVertical: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Text style={{ fontSize: 9, color: '#fff' }}>📑</Text>
          <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>
            {post.media_urls.length}
          </Text>
        </View>
      )}
      {/* like 数 overlay (hot な投稿だけ — > 10) */}
      {post.likes_count >= 10 && (
        <View
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: R.sm,
            paddingHorizontal: 4,
            paddingVertical: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Text style={{ fontSize: 9, color: '#fff' }}>♥</Text>
          <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>
            {post.likes_count}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}
