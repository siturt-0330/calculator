import { View, Text, useWindowDimensions } from 'react-native';
import { Icon } from '@/constants/icons';
import type { Post } from '@/types/models';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { PressableScale } from '@/components/ui/PressableScale';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { DoubleTapHeart } from '@/components/ui/DoubleTapHeart';
import { TagPill } from '@/components/tag/TagPill';
import { TrustBar } from '@/components/ui/TrustBar';
import { Avatar } from '@/components/ui/Avatar';
import { formatRelative } from '@/lib/utils/date';

export function AnonPostCard({
  post,
  onLike,
  onComment,
  onSave,
  onShare,
  onTagPress,
  onMore,
}: {
  post: Post;
  onLike: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
  onTagPress: (name: string) => void;
  onMore: () => void;
}) {
  const { width } = useWindowDimensions();
  const Heart = Icon.heart;
  const Comment = Icon.comment;
  const Save = Icon.save;
  const Share = Icon.share;
  const More = Icon.more;

  return (
    <View style={{ backgroundColor: C.bg, marginBottom: SP['6'] }}>
      {/* ヘッダー: 完全匿名 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
          gap: SP['3'],
        }}
      >
        <Avatar size={36} anonymous />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', gap: SP['2'], alignItems: 'center' }}>
            <Text style={[T.bodyB, { color: C.text }]}>
              {post.tag_names[0] ? `#${post.tag_names[0]}` : '#無題'}
            </Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              · {formatRelative(post.created_at)}
            </Text>
          </View>
          <TrustBar score={post.trust_score_at_post} compact />
        </View>
        <PressableScale onPress={onMore} style={{ padding: SP['2'] }}>
          <More size={22} color={C.text2} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* メディア */}
      {post.media_urls.length > 0 && (
        <DoubleTapHeart onDoubleTap={onLike}>
          <ProgressiveImage
            uri={post.media_urls[0] ?? ''}
            width={width}
            height={width}
            radius={0}
          />
        </DoubleTapHeart>
      )}

      {/* アクション行 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          gap: SP['5'],
        }}
      >
        <PressableScale onPress={onLike} haptic="pop">
          <Heart size={26} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale onPress={onComment}>
          <Comment size={26} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale onPress={onShare}>
          <Share size={24} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <View style={{ flex: 1 }} />
        <PressableScale onPress={onSave}>
          <Save size={26} color={C.text} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* カウント */}
      <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['2'] }}>
        <Text style={[T.bodyB, { color: C.text }]}>
          {post.likes_count.toLocaleString()} いいね
        </Text>
      </View>

      {/* キャプション */}
      {post.content ? (
        <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['1'] }}>
          <Text style={[T.body, { color: C.text }]} numberOfLines={3}>
            {post.content}
          </Text>
        </View>
      ) : null}

      {/* タグ */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          paddingHorizontal: SP['4'],
          paddingTop: SP['2'],
          gap: SP['2'],
        }}
      >
        {post.tag_names.map((tag) => (
          <TagPill key={tag} name={tag} state="normal" onPress={() => onTagPress(tag)} />
        ))}
      </View>

      {/* コメント数 */}
      {post.comments_count > 0 && (
        <PressableScale
          onPress={onComment}
          style={{ paddingHorizontal: SP['4'], paddingTop: SP['2'] }}
          haptic="tap"
        >
          <Text style={[T.small, { color: C.text2 }]}>
            {post.comments_count}件のコメントを見る
          </Text>
        </PressableScale>
      )}
    </View>
  );
}
