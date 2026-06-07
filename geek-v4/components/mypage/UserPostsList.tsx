// =============================================================================
// UserPostsList — 「投稿」タブ: 特定ユーザーの投稿リスト (自分視点 / 他人視点共通)
// -----------------------------------------------------------------------------
// ★ de-anon Phase2: posts.author_id を client で一切扱わない。取得は subject で分岐する RPC:
//   - 自分視点 (subject.kind='self')      → get_my_posts (0117, auth.uid() ベース)
//   - 他人視点 (subject.kind='pseudonym') → get_pseudo_profile_posts (0125, pseudonym_id トークン)
//   いずれも author_id を返さず、可視性は server (RLS / can_view_post / author_visible) が保証する。
//   自分視点は非公開も含み、他人視点は公開 (is_public / community_public) のみが返る。
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

// 取得対象の指定。own/other を型で明示し、author_id を client で持たない。
//   - { kind: 'self' }                 → 自分の投稿 (get_my_posts, auth.uid())
//   - { kind: 'pseudonym'; token }     → 擬似プロフィールの公開投稿 (get_pseudo_profile_posts)
export type UserPostsSubject =
  | { kind: 'self' }
  | { kind: 'pseudonym'; token: string };

// get_pseudo_profile_posts (0125) の返り値。posts[] は is_own を含む (本リストでは未使用)。
type PseudoProfileResult = {
  avatar_url: string | null;
  avatar_emoji: string | null;
  posts: UserPost[] | null;
};

async function fetchUserPosts(subject: UserPostsSubject): Promise<UserPost[]> {
  // 自分視点 (= server の auth.uid()) では is_public=false も含む。他人視点は server が
  // 公開 (is_public / community_public) のみに絞る。author_id は client に渡らない。
  // 埋め込みタブは最初の画面で 30 件もあれば十分なので limit を 30 に抑える。
  if (subject.kind === 'self') {
    const { data, error } = await supabase.rpc('get_my_posts', { p_limit: 30 });
    if (error) {
      console.warn('[UserPostsList] get_my_posts rpc error:', error.message);
      return [];
    }
    return (Array.isArray(data) ? data : []) as UserPost[];
  }
  // pseudonym: token (pseudonym_id) で他人の公開投稿を取得。返りは { avatar_*, posts }。
  const { data, error } = await supabase.rpc('get_pseudo_profile_posts', {
    p_pseudonym_id: subject.token,
    p_limit: 30,
  });
  if (error) {
    console.warn('[UserPostsList] get_pseudo_profile_posts rpc error:', error.message);
    return [];
  }
  const result = (data ?? null) as PseudoProfileResult | null;
  return Array.isArray(result?.posts) ? result.posts : [];
}

// query key は subject を安定 string 化 (self / pseudonym:token)。
function subjectKey(subject: UserPostsSubject | undefined): string {
  if (!subject) return 'none';
  return subject.kind === 'self' ? 'self' : `pseudonym:${subject.token}`;
}

export function UserPostsList({
  subject,
  emptyHint,
  onCompose,
}: {
  subject: UserPostsSubject | undefined;
  emptyHint: string;
  onCompose?: () => void;
}) {
  const router = useRouter();
  const enabled = !!subject;
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['user-posts', subjectKey(subject)],
    queryFn: () => fetchUserPosts(subject!),
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
