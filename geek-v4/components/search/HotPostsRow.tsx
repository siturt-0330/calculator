// ============================================================
// HotPostsRow — 検索/ディスカバリータブの「Hot 投稿」横スクロール
// ------------------------------------------------------------
// 直近で勢いのある投稿 (sort=hot) を 10 件、Reddit Apollo 風の
// 280x200 カード横スクロールで見せる。
// - title (= content 1 行目) があれば上半分に、サムネがあれば下半分に
// - tap → /post/[id]
// - 1 RTT (fetchPosts) + React Query キャッシュ (staleTime 60s)
// ============================================================
import { useMemo, useState } from 'react';
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
import { R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { fetchPosts } from '../../lib/api/posts';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import type { Post } from '../../types/models';

const CARD_WIDTH = 280;
const CARD_HEIGHT = 200;
const LIMIT = 10;
// iOS-native: card 間 gap を含めた snap 単位
const SNAP_INTERVAL = CARD_WIDTH + SP['3'];

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
    // iOS-native skeleton: 2 枚分のグレー placeholder を横スクロールで
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
          contentContainerStyle={{ gap: SP['3'], paddingHorizontal: SP['4'] }}
        >
          {[0, 1].map((i) => (
            <View
              key={`sk-${i}`}
              style={{
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                borderRadius: R.lg,
                backgroundColor: C.bg2,
                borderWidth: 1,
                borderColor: C.border,
                opacity: 0.6,
              }}
            />
          ))}
        </ScrollView>
        <ActivityIndicator color={C.accent} style={{ position: 'absolute', top: 90, alignSelf: 'center' }} />
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
        // iOS-native: card 1 枚毎に snap (Apple News / Reddit Apollo の挙動)
        snapToInterval={SNAP_INTERVAL}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={{
          gap: SP['3'],
          paddingHorizontal: SP['4'],
          paddingVertical: 2, // shadow が clip されないように余白
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
  // 動画のみ投稿は media_urls が空でも video_posters にサムネがある → fallback
  const firstMedia = post.media_urls?.[0] ?? post.video_posters?.[0] ?? null;
  const fromVideoPoster =
    !post.media_urls?.[0] && !!post.video_posters?.[0];
  // ★ sanitizeUrl は通さない: data: URL や 500 字超の URL を null 化/切り詰めしてしまい、
  //   詳細 (ProgressiveImage は sanitize しない) では画像が出るのにカードだけ出ない原因に
  //   なっていた。画像ロードは SSRF リスクが無いので、生 URL を thumbedUrl に通すだけにする
  //   (= 詳細/フィードと同じ処理に揃える)。
  const thumb = useMemo(
    () => (firstMedia ? thumbedUrl(firstMedia, 240) : null),
    [firstMedia],
  );
  // render 変換エンドポイント (thumbedUrl) が解決できない環境でも画像が出るよう、
  // 読み込み失敗時は生 URL にフォールバックする。
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbSource = useMemo(
    () => (firstMedia ? { uri: thumbFailed ? firstMedia : thumb ?? firstMedia } : null),
    [firstMedia, thumb, thumbFailed],
  );

  // 動画判定: video_urls があるか、サムネが video_posters 由来
  const isVideo = (post.video_urls?.length ?? 0) > 0 || fromVideoPoster;

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
      // iOS-native: radius を lg (14) に, subtle shadow (opacity 0.04 相当)
      style={[
        {
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          borderRadius: R.lg,
          backgroundColor: C.bg2,
          borderWidth: 1,
          borderColor: C.border,
          overflow: 'hidden',
        },
        SHADOW.sm,
      ]}
      accessibilityLabel={`投稿を開く: ${title ?? ''}`}
    >
      {/* タイトル — flex:1 で残りを埋め、画像に潰されず必ず表示する */}
      {title ? (
        <View
          style={{
            paddingHorizontal: SP['3'],
            paddingTop: SP['3'],
            paddingBottom: SP['2'],
            flex: 1,
            justifyContent: 'center',
          }}
        >
          <Text
            style={[T.bodyB, { color: C.text }]}
            numberOfLines={thumbSource ? 4 : 5}
          >
            {title}
          </Text>
        </View>
      ) : null}

      {/* サムネ — タイトルがあるときは小さめ固定高さ (96px)。
          タイトルが無い画像のみ投稿は従来どおり全面表示。 */}
      {thumbSource ? (
        <View
          style={[
            { backgroundColor: C.bg3 },
            title ? { height: 96 } : { flex: 1 },
          ]}
        >
          <ExpoImage
            source={thumbSource}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={firstMedia ?? undefined}
            onError={() => setThumbFailed(true)}
          />
          {/* 動画なら ▶ 再生バッジを重ねる */}
          {isVideo ? (
            <View
              style={{
                position: 'absolute',
                bottom: 6,
                left: 6,
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: 'rgba(0,0,0,0.55)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.play size={14} color="#fff" />
            </View>
          ) : null}
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
