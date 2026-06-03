// =============================================================================
// SavedPostsList — 「保存済み」タブ: 自分が保存した投稿を時系列で表示
// -----------------------------------------------------------------------------
// app/mypage/saved.tsx のロジックを踏襲。saves → posts の 2 段 fetch。
// 自分専用 (RLS で他人は読めない) なので、他人視点では呼ばないこと。
// =============================================================================

import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image as ExpoImage } from 'expo-image';
import { MessageCircle, Heart, Lock } from 'lucide-react-native';

import { supabase } from '../../lib/supabase';
import { PressableScale } from '../ui/PressableScale';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { formatRelative } from '../../lib/utils/date';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import { useAuthStore } from '../../stores/authStore';

type SavedPost = {
  id: string;
  content: string;
  title: string | null;
  tag_names: string[];
  media_urls: string[] | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
};

async function fetchSavedPostsList(): Promise<SavedPost[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data: saves } = await supabase
    .from('saves')
    .select('post_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (!saves || saves.length === 0) return [];
  const postIds = (saves as { post_id: string }[]).map((s) => s.post_id);
  const { data: posts } = await supabase
    .from('posts')
    .select('id, content, title, tag_names, media_urls, likes_count, comments_count, created_at')
    .in('id', postIds);
  // 保存順を維持
  const map = new Map((posts ?? []).map((p) => [(p as SavedPost).id, p as SavedPost]));
  return postIds.map((id) => map.get(id)).filter(Boolean) as SavedPost[];
}

export function SavedPostsList({ onBrowseFeed }: { onBrowseFeed?: () => void }) {
  const router = useRouter();
  // 別ユーザーへ永続キャッシュ経由で前ユーザーの保存リストが漏れるのを防ぐ。
  const userId = useAuthStore((s) => s.user?.id);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['saved-posts', userId],
    queryFn: fetchSavedPostsList,
    enabled: !!userId,
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
          icon={Icon.save}
          title="保存した投稿はまだありません"
          message="気になる投稿は ブックマーク しておくと、あとでここから読めます。保存はあなただけが見られます。"
          actionLabel={onBrowseFeed ? 'フィードを見る' : undefined}
          onAction={onBrowseFeed}
          tone="amber"
        />
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['3'], paddingBottom: SP['10'], gap: SP['3'] }}>
      {/* 「あなただけが見られます」notice (自分専用バッジ) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          paddingHorizontal: SP['3'],
          paddingVertical: SP['2'],
          backgroundColor: C.bg2,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.divider,
        }}
      >
        <Lock size={14} color={C.text3} strokeWidth={2.2} />
        <Text style={[T.caption, { color: C.text3, flex: 1 }]}>
          保存済みはあなただけが見られます
        </Text>
      </View>

      {items.map((p) => (
        <SavedCard key={p.id} post={p} onPress={() => router.push(`/post/${p.id}` as never)} />
      ))}
    </View>
  );
}

function SavedCard({ post, onPress }: { post: SavedPost; onPress: () => void }) {
  const cover = post.media_urls && post.media_urls.length > 0 ? post.media_urls[0] : null;
  const title = post.title?.trim() || null;
  const snippet = post.content?.trim() || (title ?? '');

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel="保存した投稿を開く"
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
      {/* 72px 表示なので retina 144px の正方形サムネを要求。recyclingKey で
          recycler の画像残像を防ぐ。 */}
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
          <Icon.save size={20} color={C.text4} strokeWidth={1.6} />
        </View>
      )}
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
