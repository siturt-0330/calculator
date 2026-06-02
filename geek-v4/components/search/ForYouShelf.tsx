// ============================================================
// ForYouShelf — 「あなたへのおすすめ」 2x3 グリッド
// ------------------------------------------------------------
// ログイン中ユーザー向け パーソナライズ投稿 (fetchPosts sort='for-you')。
// 未ログインなら何も描画しない (auth required signal)。
// - 2 列 x 3 行 = 6 件 (limit=6 で固定)
// - 各カードは小型 (title + サムネ縮小版 + like count)
// - tap → /post/[id]
// ============================================================
import { useMemo, useState } from 'react';
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
import { VideoPlayer } from '../ui/VideoPlayer';
import { Icon } from '../../constants/icons';
import { R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { fetchPosts } from '../../lib/api/posts';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { getEvents, computeProfile, computePostScore, diversifyFeed } from '../../lib/personalize';
import type { FeedEvent } from '../../lib/personalize';
import { deepNormalize } from '../../lib/search/tokenize';
import type { Post } from '../../types/models';

const COLUMNS = 2;
const ROWS = 3;
const LIMIT = COLUMNS * ROWS;
// 個人化再ランク用に広めの候補プールを取得（hot 上位の素並びと差別化する余白）
const POOL = 24;
const GAP = SP['2']; // 8px

export function ForYouShelf() {
  const C = useColors();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const userCreatedAt = useAuthStore((s) => s.user?.created_at);

  // 親 padding は paddingHorizontal: SP['4'] (16) を想定
  const cardWidth = Math.floor(
    (screenWidth - SP['4'] * 2 - GAP * (COLUMNS - 1)) / COLUMNS,
  );

  // 候補プール: hot 候補を広め (POOL) に取得し、下でローカルの興味プロフィールで再ランクする。
  const { data: pool, isLoading } = useQuery({
    queryKey: ['for-you-shelf-pool', userId, POOL],
    queryFn: async () => {
      if (!userId) return [] as Post[];
      const r = await fetchPosts({
        sort: 'for-you',
        likedTags: [],
        blockedTags: [],
        limit: POOL,
        home: true,
      });
      return r.posts;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  // 端末ローカルのイベントログ → 興味プロフィール（フィードと同じ ['feed-events'] キャッシュを共有）
  const { data: events } = useQuery<FeedEvent[]>({
    queryKey: ['feed-events'],
    queryFn: () => getEvents(),
    staleTime: 30_000,
    enabled: !!userId,
  });

  // アカウント作成日からの日数（新規ユーザーの探索ノイズ用）。Date.now() は memo 内で。
  const myAccountAgeDays = useMemo(() => {
    if (!userCreatedAt) return 0;
    const t = new Date(userCreatedAt).getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  }, [userCreatedAt]);

  // ★ 本物のパーソナライズ:
  //   フィードの Phase-3 再ランク (computePostScore=タグ親和性+エンゲージメント+時間減衰,
  //   diversifyFeed=同 author/同タグ連続の抑制) をそのまま共有して候補プールを再並び替え。
  //   これで「いま盛り上がっている(hot)」の素の並びと別物になる。
  const posts = useMemo<Post[]>(() => {
    const candidates = pool ?? [];
    if (candidates.length === 0) return [];
    const profile = computeProfile(events ?? []);
    const userLikedTagsFreq = new Map<string, number>(Object.entries(profile.tagAffinity));
    const globalTagFreq = new Map<string, number>();
    for (const p of candidates) {
      for (const t of p.tag_names ?? []) {
        const n = deepNormalize(t);
        if (n) globalTagFreq.set(n, (globalTagFreq.get(n) ?? 0) + 1);
      }
    }
    const now = new Date();
    const scored = candidates.map((p) => ({
      post: p,
      score: computePostScore({
        post: p,
        userLikedTagsFreq,
        globalTagFreq,
        now,
        myAccountAgeDays,
        totalPosts: candidates.length,
      }),
    }));
    return diversifyFeed(scored, 2).slice(0, LIMIT);
  }, [pool, events, myAccountAgeDays]);

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
  // ★ sanitizeUrl は通さない (HotPostsRow と同理由): data: URL 等を弾いて「詳細では
  //   出るのにカードだけ画像が出ない」原因になっていた。生 URL を thumbedUrl に通すだけにする。
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

  // 動画は VideoPlayer で自動再生 (タップで全画面)。poster は静止画 or video_posters。
  const isVideo = (post.video_urls?.length ?? 0) > 0;
  const videoUrl = post.video_urls?.[0] ?? null;
  const posterUrl = post.media_urls?.[0] ?? post.video_posters?.[0] ?? undefined;
  const hasMedia = !!thumbSource || (isVideo && !!videoUrl);

  const title = useMemo(() => {
    const firstLine = (post.content ?? '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 0 ? firstLine.slice(0, 60) : '';
  }, [post.content]);

  // height はおおよそ 4:5 比率 (Reddit For You カード比率) + footer
  const height = Math.round((width * 5) / 4);
  // 画像はカードの約半分の固定高さに抑え、残りをタイトルに回す (画像が大きすぎ
  // てタイトルが消える問題への対応)。
  const thumbH = Math.round(height * 0.5);

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
      {/* サムネ — 上部に小さめ固定高さ (カードの約半分) で。タイトルを潰さない。 */}
      {isVideo && videoUrl ? (
        <VideoPlayer
          uri={videoUrl}
          poster={posterUrl}
          style={{ width: '100%', height: thumbH, borderRadius: 0 }}
        />
      ) : thumbSource ? (
        <View style={{ height: thumbH, backgroundColor: C.bg3 }}>
          <ExpoImage
            source={thumbSource}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={firstMedia ?? undefined}
            onError={() => setThumbFailed(true)}
          />
        </View>
      ) : null}

      {/* タイトル — flex:1 で残りを埋め、必ず表示する */}
      <View
        style={{
          paddingHorizontal: SP['2'] + 2,
          paddingTop: SP['2'],
          paddingBottom: 6,
          flex: 1,
          justifyContent: hasMedia ? 'flex-start' : 'center',
        }}
      >
        <Text
          style={[T.smallB, { color: C.text }]}
          numberOfLines={hasMedia ? 3 : 4}
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
