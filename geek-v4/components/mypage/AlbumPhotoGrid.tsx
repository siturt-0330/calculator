// ============================================================
// components/mypage/AlbumPhotoGrid.tsx
// ============================================================
// マイページの「アルバム」タブ配下に表示する 3 列正方形 photo grid。
// - 親 ScrollView の paddingHorizontal: SP['4'] (16) を前提に cellSize を計算
// - flexWrap で 3 列に折り返し (FlashList を入れ子にすると ScrollView 内で warn)
// - shared / hidden の photo に右上 badge を付ける
// - 写真タップで onPhotoPress(id) を発火 (caller 側で /mypage/photo/[id] に遷移)
//
// 参考: components/search/DiscoverPhotoGrid.tsx の grid レイアウトを踏襲
// ============================================================

import { View, Text, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { C, R, SP } from '../../design/tokens';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { sanitizeUrl } from '../../lib/sanitize';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import type { AlbumPhoto } from '../../types/models';

const COLUMN_COUNT = 3;
const GAP = 2;

type Props = {
  photos: AlbumPhoto[];
  onPhotoPress: (id: string) => void;
  isLoading?: boolean;
  // 親 ScrollView の水平 padding (default: SP['4'] = 16)。
  // mypage.tsx は SP['4'] を使っているので default で OK。
  horizontalPadding?: number;
};

export function AlbumPhotoGrid({
  photos,
  onPhotoPress,
  isLoading = false,
  horizontalPadding = SP['4'],
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const cellSize = Math.floor(
    (screenWidth - horizontalPadding * 2 - GAP * (COLUMN_COUNT - 1)) / COLUMN_COUNT,
  );

  if (isLoading && photos.length === 0) {
    return (
      <View style={{ padding: SP['8'], alignItems: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (photos.length === 0) {
    // empty 時は null を返す — 呼び出し側で <EmptyAlbums /> を出す責任
    return null;
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GAP,
      }}
    >
      {photos.map((p) => (
        <PhotoCell
          key={p.id}
          photo={p}
          size={cellSize}
          onPress={() => onPhotoPress(p.id)}
        />
      ))}
    </View>
  );
}

// ============================================================
// PhotoCell — 1 セル (1:1 正方形)
// ============================================================
function PhotoCell({
  photo,
  size,
  onPress,
}: {
  photo: AlbumPhoto;
  size: number;
  onPress: () => void;
}) {
  const safeUrl = photo.image_url ? sanitizeUrl(photo.image_url) : null;
  // Supabase Storage 画像なら transformation endpoint 経由で軽量化
  const resolvedUrl = safeUrl ? thumbedUrl(safeUrl, size * 3) : null;
  const isShared = photo.visibility === 'shared';
  const isHidden = photo.is_hidden;

  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      scaleValue={0.96}
      accessibilityLabel={`写真を開く: ${photo.caption?.slice(0, 30) ?? ''}`}
      style={{
        width: size,
        height: size,
        backgroundColor: C.bg3,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {resolvedUrl ? (
        <Image
          source={{ uri: resolvedUrl }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={resolvedUrl}
          transition={120}
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

      {/* 右上 badge: hidden > shared の優先で 1 つだけ表示 */}
      {isHidden ? (
        <BadgeOverlay icon="🚫" />
      ) : isShared ? (
        <BadgeOverlay icon="👥" />
      ) : null}
    </PressableScale>
  );
}

function BadgeOverlay({ icon }: { icon: string }) {
  return (
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
      }}
    >
      <Text style={{ fontSize: 10, color: '#fff' }}>{icon}</Text>
    </View>
  );
}
