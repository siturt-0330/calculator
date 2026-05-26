// ============================================================
// components/mypage/AlbumCard.tsx
// ============================================================
// アルバム一覧表示用 card。
// cover_url (なければ placeholder) + title + photo_count + 共有数。
// 共有数 = shared_with_user_ids.length (album 単位の共有相手数)。
// タップで onPress (caller 側で /mypage/album/[id] に遷移)。
// ============================================================

import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { sanitizeUrl } from '../../lib/sanitize';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import type { Album } from '../../types/models';

type Props = {
  album: Album;
  onPress: () => void;
};

export function AlbumCard({ album, onPress }: Props) {
  const safeCover = album.cover_url ? sanitizeUrl(album.cover_url) : null;
  // 240px 程度に thumb 化 (card は 大きくないが retina 用に余裕)
  const cover = safeCover ? thumbedUrl(safeCover, 480) : null;
  const sharedCount = album.shared_with_user_ids.length;

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.97}
      style={{
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        padding: SP['3'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['3'],
      }}
    >
      {/* cover thumb 64x64 */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: R.md,
          overflow: 'hidden',
          backgroundColor: C.bg3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {cover ? (
          <Image
            source={{ uri: cover }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={cover}
            transition={120}
          />
        ) : (
          <Icon.image size={22} color={C.text3} strokeWidth={1.8} />
        )}
      </View>

      {/* title + meta */}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
          {album.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon.camera size={12} color={C.text3} strokeWidth={2} />
            <Text style={[T.caption, { color: C.text3 }]}>{album.photo_count}枚</Text>
          </View>
          {album.visibility === 'shared' && sharedCount > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon.friends size={12} color={C.text3} strokeWidth={2} />
              <Text style={[T.caption, { color: C.text3 }]}>{sharedCount}人と共有</Text>
            </View>
          )}
        </View>
      </View>

      {/* chevron */}
      <Icon.chevronR size={16} color={C.text4} strokeWidth={2.2} />
    </PressableScale>
  );
}
