// =============================================================================
// UserPostsList — 「投稿」タブ: 特定ユーザーの投稿リスト (自分視点 / 他人視点共通)
// -----------------------------------------------------------------------------
// posts.author_id でフィルタした card リスト。自分視点では非公開も含めて表示し、
// 他人視点では RLS で is_public=true / community_public のみが返る。
//
// presentational + 軽い fetch (useQuery)。
// =============================================================================

import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image as ExpoImage } from 'expo-image';
import { MessageCircle, Heart } from 'lucide-react-native';

import { supabase } from '../../lib/supabase';
import { PressableScale } from '../ui/PressableScale';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { thumbedUrl } from '../../lib/utils/imageUrl';

type UserPost = {
  id: string;
  content: string;
  title: string | null;
  media_urls: string[] | null;
  likes_count: number;
  comments_count: number;
  is_public: boolean;
  created_at: string;
};

async function fetchPostsByAuthor(authorId: string): Promise<UserPost[]> {
  // 自分視点 (= 自分の RLS) では is_public=false も見える。他人視点では RLS が
  // 自動で is_public=true / community_public のみに絞る (DB ポリシー側で保護)。
  // カード描画に使う列のみ select (tag_names はカードで未使用なので除外)。
  // 埋め込みタブは最初の画面で 30 件もあれば十分なので limit を 30 に抑えて初回
  // ペイロード/描画を軽くする (専用 /mypage/posts はより多く取得する想定)。
  const { data } = await supabase
    .from('posts')
    .select('id, content, title, media_urls, likes_count, comments_count, is_public, created_at')
    .eq('author_id', authorId)
    .order('created_at', { ascending: false })
    .limit(30);
  return (data ?? []) as UserPost[];
}

export function UserPostsList({
  authorId,
  emptyHint,
  onCompose,
}: {
  authorId: string | undefined;
  emptyHint: string;
  onCompose?: () => void;
}) {
  const router = useRouter();
  const enabled = !!authorId;
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['user-posts', authorId],
    queryFn: () => fetchPostsByAuthor(authorId!),
    enabled,
    staleTime: 30_000,
  });

  if (isLoading && items.length === 0) {
    return (
      <View style={{ padding: SP['8'], alignItems: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={{ padding: SP['5'] }}>
        <EmptyState
          icon={Icon.edit}
          title="まだ投稿がありません"
          message={emptyHint}
          actionLabel={onCompose ? '投稿する' : undefined}
          onAction={onCompose}
          tone="accent"
        />
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['10'], gap: SP['3'] }}>
      {items.map((p) => (
        <PostCard key={p.id} post={p} onPress={() => router.push(`/post/${p.id}` as never)} />
      ))}
    </View>
  );
}

function PostCard({ post, onPress }: { post: UserPost; onPress: () => void }) {
  const cover = post.media_urls && post.media_urls.length > 0 ? post.media_urls[0] : null;
  const title = post.title?.trim() || null;
  const body = post.content?.trim() || '';
  const snippet = body.length > 0 ? body : (title ?? '');

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel="投稿を開く"
      style={{
        flexDirection: 'row',
        gap: SP['3'],
        padding: SP['3'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.divider,
      }}
    >
      {/* 左: 画像サムネ (なければ accent dot)。72px 表示なので retina 144px の
          正方形サムネを要求して帯域削減。recyclingKey で recycler の画像残像を防ぐ。 */}
      {cover ? (
        <ExpoImage
          source={{ uri: thumbedUrl(cover, 144, { height: 144 }) }}
          style={{ width: 72, height: 72, borderRadius: R.md, backgroundColor: C.bg3 }}
          contentFit="cover"
          transition={140}
          cachePolicy="memory-disk"
          recyclingKey={post.id}
        />
      ) : (
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: R.md,
            backgroundColor: C.bg3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon.edit size={20} color={C.text4} strokeWidth={1.6} />
        </View>
      )}

      {/* 右: タイトル + 本文 + メタ */}
      <View style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        <Text
          style={[T.small, { color: title ? C.text2 : C.text, marginTop: title ? 2 : 0 }]}
          numberOfLines={title ? 1 : 2}
        >
          {snippet || ' '}
        </Text>

        {/* メタ行: like / comment / 経過時間 / 非公開バッジ */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP['3'],
            marginTop: SP['2'],
          }}
        >
          <MetaIcon Icon={Heart} value={post.likes_count} />
          <MetaIcon Icon={MessageCircle} value={post.comments_count} />
          <Text style={[T.caption, { color: C.text4 }]}>· {formatRelative(post.created_at)}</Text>
          {!post.is_public ? (
            <Text
              style={[
                T.caption,
                {
                  color: C.amber,
                  borderWidth: 1,
                  borderColor: C.amber + '55',
                  borderRadius: 4,
                  paddingHorizontal: 5,
                },
              ]}
            >
              非公開
            </Text>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

function MetaIcon({ Icon: I, value }: { Icon: typeof Heart; value: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <I size={12} color={C.text3} strokeWidth={2} />
      <Text style={[T.caption, { color: C.text3 }]}>{value.toLocaleString()}</Text>
    </View>
  );
}
