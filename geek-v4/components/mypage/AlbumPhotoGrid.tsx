// ============================================================
// components/mypage/AlbumPhotoGrid.tsx
// ============================================================
// マイページの「アルバム」タブ配下に表示する 3 列正方形 photo grid。
// - 親 ScrollView の paddingHorizontal: SP['4'] (16) を前提に cellSize を計算
// - flexWrap で 3 列に折り返し (FlashList を入れ子にすると ScrollView 内で warn)
// - shared / hidden の photo に右上 / 左上 floating badge を付ける
// - 写真タップで onPhotoPress(id) を発火 (caller 側で /mypage/photo/[id] に遷移)
//
// UI Polish (Phase 2):
// - 各 cell に R.md 角丸 + SHADOW.sm
// - press 時は Reanimated useSharedValue + withSpring で scale 0.96 にスナップ
// - shared (👥) / hidden (🚫) badge は丸い floating chip (rgba bg + white icon)
//
// 参考: components/search/DiscoverPhotoGrid.tsx の grid レイアウトを踏襲
// ============================================================

import { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { SPRING_SNAP } from '../../design/motion';
import { Icon } from '../../constants/icons';
import { sanitizeUrl } from '../../lib/sanitize';
import { thumbedUrl } from '../../lib/utils/imageUrl';
import type { AlbumPhoto } from '../../types/models';

const COLUMN_COUNT = 3;
const GAP = SP['1']; // 4px (旧 2px → 1px 角丸 cell との相性を考えて少し広げる)

// Pressable の delayPressIn は @types/react-native では PressableProps に乗って
// いないが、実 API では存在する (RN 公式 docs)。PressableScale.tsx と同じく
// Record<string, unknown> を介して型エラーを避けつつ spread する。
// 0 にすることで OS 既定の ~130ms 遅延を消し、押した瞬間に scale が動く。
const extraPressableProps = { delayPressIn: 0 } as Record<string, unknown>;

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
//
// Reanimated useSharedValue + withSpring で press 時に scale 0.96 へ。
// PressableScale を使わずに自前で scale animation を書くのは、cell に
// SHADOW.sm を「scale で消えないように」外側 wrapper に持たせたいから
// (PressableScale は子全体を scale するので shadow まで縮む)。
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

  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (_e: GestureResponderEvent) => {
      scale.value = withSpring(0.96, SPRING_SNAP);
      if (Platform.OS !== 'web') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
          // best-effort
        }
      }
    },
    [scale],
  );

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_SNAP);
  }, [scale]);

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: R.md,
          backgroundColor: C.bg3,
          overflow: 'hidden',
          position: 'relative',
        },
        SHADOW.sm,
        animStyle,
      ]}
    >
      <Pressable
        {...extraPressableProps}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={`写真を開く: ${photo.caption?.slice(0, 30) ?? ''}`}
        style={{ width: '100%', height: '100%' }}
      >
        {resolvedUrl ? (
          <Image
            source={{ uri: resolvedUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={resolvedUrl}
            transition={140}
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

        {/* floating badges (重ね順: hidden が前面) */}
        {isShared && <SharedBadge />}
        {isHidden && <HiddenBadge />}
      </Pressable>
    </Animated.View>
  );
}

// 右上 floating: 共有 photo を示す紫グロウの丸 chip
function SharedBadge() {
  return (
    <View
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(124,106,247,0.9)',
        alignItems: 'center',
        justifyContent: 'center',
        // subtle ring で背景画像から浮かせる
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
      }}
      accessibilityLabel="共有写真"
    >
      <Text style={{ fontSize: 12, color: '#fff', lineHeight: 14 }}>👥</Text>
    </View>
  );
}

// 左上 floating: 非表示 photo を示す暗い丸 chip
function HiddenBadge() {
  return (
    <View
      style={{
        position: 'absolute',
        top: 6,
        left: 6,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
      }}
      accessibilityLabel="非表示写真"
    >
      <Text style={{ fontSize: 12, color: '#fff', lineHeight: 14 }}>🚫</Text>
    </View>
  );
}
