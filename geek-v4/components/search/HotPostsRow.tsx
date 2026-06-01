// ============================================================
// HotPostsRow — 検索/ディスカバリータブの「Hot 投稿」横スクロール
// ------------------------------------------------------------
// 直近で勢いのある投稿 (sort=hot) を 10 件、Apple News / Reddit Apollo 風の
// editorial カード横スクロールで見せる。
//   - 画像は上に banner として大きく、タイトル(= content 1 行目)は下に
//   - like / comment の統計は「画像に被せず」カード地の上に置く
//     (旧実装は半透明バンドを画像最下部に重ねており、写真内のテキストを
//      隠して "汚い" 見た目になっていた)
//   - tap → /post/[id]
//   - 1 RTT (fetchPosts) + React Query キャッシュ (staleTime 60s)
// ============================================================
import { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
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
const CARD_HEIGHT = 210;
// 画像 banner の高さ。残り (= CARD_HEIGHT - IMAGE_HEIGHT) がタイトル + 統計領域。
const IMAGE_HEIGHT = 120;
const LIMIT = 10;
// iOS-native: card 間 gap を含めた snap 単位
const SNAP_INTERVAL = CARD_WIDTH + SP['3'];

// セクション見出し ("✨ いま盛り上がっている") — skeleton / 本体で共用
function SectionHeader() {
  const C = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: SP['4'],
      }}
    >
      <Icon.sparkles size={15} color={C.accent} strokeWidth={2.2} />
      <Text style={[T.smallB, { color: C.text2, letterSpacing: 0.3 }]}>
        いま盛り上がっている
      </Text>
    </View>
  );
}

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
    // skeleton: 新レイアウト (画像 banner + 2 本のタイトル行) を薄く再現して
    // ロード中であることを自然に伝える
    return (
      <View style={{ gap: SP['3'] }}>
        <SectionHeader />
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
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: C.border,
                overflow: 'hidden',
              }}
            >
              <View style={{ height: IMAGE_HEIGHT, backgroundColor: C.bg3 }} />
              <View style={{ paddingHorizontal: 14, paddingTop: SP['3'], gap: SP['2'] }}>
                <View style={{ height: 11, borderRadius: 4, backgroundColor: C.bg3, width: '88%' }} />
                <View style={{ height: 11, borderRadius: 4, backgroundColor: C.bg3, width: '52%' }} />
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (posts.length === 0) return null;

  return (
    <View style={{ gap: SP['3'] }}>
      <SectionHeader />
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
  const fromVideoPoster = !post.media_urls?.[0] && !!post.video_posters?.[0];
  // ★ sanitizeUrl は通さない: data: URL や 500 字超の URL を null 化/切り詰めしてしまい、
  //   詳細 (ProgressiveImage は sanitize しない) では画像が出るのにカードだけ出ない原因に
  //   なっていた。画像ロードは SSRF リスクが無いので、生 URL を thumbedUrl に通すだけにする。
  const thumb = useMemo(
    () => (firstMedia ? thumbedUrl(firstMedia, 480) : null),
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
  const hasImage = !!thumbSource;

  // title = content 1 行目 (画像ありは 2 行 / 画像なしは 5 行まで表示)
  const title = useMemo(() => {
    const firstLine = (post.content ?? '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 0 ? firstLine.slice(0, 120) : null;
  }, [post.content]);

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.97}
      style={[
        {
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          borderRadius: R.lg,
          backgroundColor: C.bg2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: C.border,
          overflow: 'hidden',
        },
        SHADOW.sm,
      ]}
      accessibilityLabel={`投稿を開く: ${title ?? ''}`}
    >
      {/* 画像 banner (上) — cover crop。card の overflow:hidden で上角は自動で丸まる。
          タイトルは下に置くので scrim は不要 (写真をクリーンに見せる)。 */}
      {hasImage ? (
        <View
          style={{
            height: IMAGE_HEIGHT,
            backgroundColor: C.bg3,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: C.border,
          }}
        >
          <ExpoImage
            source={thumbSource}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={140}
            recyclingKey={firstMedia ?? undefined}
            onError={() => setThumbFailed(true)}
          />
          {/* 動画なら ▶ 再生バッジ (右下) */}
          {isVideo ? (
            <View
              style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: 'rgba(0,0,0,0.55)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon.play size={15} color="#fff" />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 本文領域 — タイトルを上、統計を下に振り分ける (space-between)。
          画像が無いカードは領域全体を使ってタイトルを大きく見せる。 */}
      <View
        style={{
          flex: 1,
          paddingHorizontal: 14,
          paddingTop: hasImage ? SP['3'] : SP['4'],
          paddingBottom: SP['3'],
          justifyContent: 'space-between',
        }}
      >
        {title ? (
          <Text
            style={[hasImage ? T.bodyB : T.h4, { color: C.text }]}
            numberOfLines={hasImage ? 2 : 5}
          >
            {title}
          </Text>
        ) : (
          <View />
        )}

        {/* 統計 (like / comment) — 画像に被せず、控えめな text2 で */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['4'],
            marginTop: SP['2'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon.heart size={13} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.captionM, { color: C.text2 }]}>
              {post.likes_count.toLocaleString('ja-JP')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon.comment size={13} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.captionM, { color: C.text2 }]}>
              {post.comments_count.toLocaleString('ja-JP')}
            </Text>
          </View>
        </View>
      </View>
    </PressableScale>
  );
}
