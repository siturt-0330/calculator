// ============================================================
// components/post/MediaPickerGrid.tsx
// ============================================================
// 投稿作成画面用の「画像 + 動画」サムネ選択 grid。
// Instagram の post creation UI に寄せた horizontal scroll + snap。
//
// 主要要素:
//   - 画像 thumbnail (expo-image, 96x96, 角丸 14)
//   - 動画 thumbnail (静止画扱い + Play アイコン overlay)
//   - 各サムネ右上の削除 × ボタン (24x24 円, white bg)
//   - 末尾の追加 + ボタン (画像 / 動画 各 1 つ、dashed border, accent color)
//   - uploading 中は全 thumb に半透明 overlay + 中央 spinner
//
// 設計判断:
//   - PressableScale を使わず、自前で Reanimated spring scale を実装
//     (PressableScale は子全体を scale するため、 shadow / overlay まで
//      縮んで違和感が出るのを避ける)
//   - ScrollView snap は thumb + gap = 96 + 8 = 104px に揃える
//   - 動画は expo-image に video URI を渡しても thumb が出ない可能性が
//     高いので、bg + 中央 Play アイコンの placeholder で表現する
//   - dark / light 両対応 (useColors 経由)
//   - haptic は削除時 warning / 追加時 light (要件どおり)
//   - Lucide icon の Video / Play は constants/icons.ts に未登録なので
//     直 import (icons.ts の規約とおりだが、 tree-shaking は問題ない)
// ============================================================

import { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
  type GestureResponderEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Video as VideoIcon, Play as PlayIcon } from 'lucide-react-native';
import { Icon } from '../../constants/icons';
import { useColors } from '../../hooks/useColors';
import { T } from '../../design/typography';
import { R, SP, SHADOW } from '../../design/tokens';
import { SPRING_SNAPPY, PRESS_SCALE } from '../../design/motion';
import { hapticPresets } from '../../lib/haptics';

// ============================================================
// 定数: サイズ・配色
// ============================================================
const THUMB_SIZE = 96;
const THUMB_RADIUS = 14;
const GAP = SP['2']; // 8px
const SNAP_INTERVAL = THUMB_SIZE + GAP; // 104px
const REMOVE_BUTTON_SIZE = 24;

// Pressable の delayPressIn を 0 にして即時 press フィードバックを取りたい。
// PressableProps の公式型に乗っていないため、 cast して spread する
// (AlbumPhotoGrid.tsx と同じ手法)。
const extraPressableProps = { delayPressIn: 0 } as Record<string, unknown>;

// ============================================================
// Props
// ============================================================
export type MediaPickerGridProps = {
  /** 画像 URI list (local or remote). 表示順そのまま grid 表示する */
  mediaUris: string[];
  /** 動画 URI list. 1 投稿あたり 1 本想定だが list 形で渡せるようにする */
  videoUris: string[];
  /** + ボタン (画像) tap で呼ばれる. 親で ImagePicker を起動する想定 */
  onAddImage: () => void;
  /** + ボタン (動画) tap で呼ばれる. 親で ImagePicker (videos) を起動 */
  onAddVideo: () => void;
  /** × ボタン tap で呼ばれる. uri と kind を渡すので親側で list から弾く */
  onRemove: (uri: string, kind: 'image' | 'video') => void;
  /** 画像の上限. これに達したら画像 + ボタンを隠す. default 4 */
  maxImages?: number;
  /** 動画の上限. これに達したら動画 + ボタンを隠す. default 1 */
  maxVideos?: number;
  /** uploading 中は全 thumb を薄く + 中央 spinner を出して操作不能にする */
  uploading?: boolean;
};

// ============================================================
// MediaPickerGrid — 単一 export
// ============================================================
export function MediaPickerGrid({
  mediaUris,
  videoUris,
  onAddImage,
  onAddVideo,
  onRemove,
  maxImages = 4,
  maxVideos = 1,
  uploading = false,
}: MediaPickerGridProps): JSX.Element {
  const C = useColors();

  const canAddImage = mediaUris.length < maxImages;
  const canAddVideo = videoUris.length < maxVideos;

  const handleRemove = useCallback(
    (uri: string, kind: 'image' | 'video') => {
      hapticPresets.warning();
      onRemove(uri, kind);
    },
    [onRemove],
  );

  const handleAddImage = useCallback(() => {
    hapticPresets.light();
    onAddImage();
  }, [onAddImage]);

  const handleAddVideo = useCallback(() => {
    hapticPresets.light();
    onAddVideo();
  }, [onAddVideo]);

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={STYLES.scrollContent}
        // uploading 中は scroll 操作も止めて誤操作防止
        scrollEnabled={!uploading}
      >
        {/* 画像 thumbnails */}
        {mediaUris.map((uri) => (
          <MediaThumb
            key={`image-${uri}`}
            uri={uri}
            kind="image"
            uploading={uploading}
            onRemove={handleRemove}
            removeButtonBg={C.text}
            removeIconColor={C.bg}
            thumbBg={C.bg3}
          />
        ))}

        {/* 動画 thumbnails */}
        {videoUris.map((uri) => (
          <MediaThumb
            key={`video-${uri}`}
            uri={uri}
            kind="video"
            uploading={uploading}
            onRemove={handleRemove}
            removeButtonBg={C.text}
            removeIconColor={C.bg}
            thumbBg={C.bg3}
          />
        ))}

        {/* 追加 + ボタン (画像) */}
        {canAddImage && !uploading && (
          <AddButton
            kind="image"
            onPress={handleAddImage}
            accentColor={C.accent}
            bgColor={C.bg2}
            labelColor={C.text2}
          />
        )}

        {/* 追加 + ボタン (動画) */}
        {canAddVideo && !uploading && (
          <AddButton
            kind="video"
            onPress={handleAddVideo}
            accentColor={C.accent}
            bgColor={C.bg2}
            labelColor={C.text2}
          />
        )}
      </ScrollView>

      {/* counter — 画像 / 動画 のカウンタを subtle text で出す */}
      <View style={STYLES.counterRow}>
        <Text style={[T.caption, { color: C.text3 }]}>
          {`画像 ${mediaUris.length} / ${maxImages} ・ 動画 ${videoUris.length} / ${maxVideos}`}
        </Text>
      </View>
    </View>
  );
}

// ============================================================
// MediaThumb — 1 つの thumbnail (画像 or 動画)
//
// - 画像: expo-image で contentFit cover
// - 動画: placeholder bg + 中央 Play アイコン (expo-image で
//         動画 URI を直接 source に渡してもサムネが出ない端末が
//         多いため、明示的な静止画 placeholder を用意する)
// - 右上に削除 × ボタン
// - uploading 時は thumb 自体に opacity 0.5 + 中央 spinner
// ============================================================
type MediaThumbProps = {
  uri: string;
  kind: 'image' | 'video';
  uploading: boolean;
  onRemove: (uri: string, kind: 'image' | 'video') => void;
  removeButtonBg: string;
  removeIconColor: string;
  thumbBg: string;
};

function MediaThumb({
  uri,
  kind,
  uploading,
  onRemove,
  removeButtonBg,
  removeIconColor,
  thumbBg,
}: MediaThumbProps): JSX.Element {
  return (
    <View style={[STYLES.thumbWrap, { backgroundColor: thumbBg }, SHADOW.sm]}>
      <Pressable
        {...extraPressableProps}
        accessibilityRole="button"
        accessibilityLabel={kind === 'image' ? '画像サムネ' : '動画サムネ'}
        // tap は将来 lightbox preview 用の hook 予定。今は no-op。
        onPress={undefined}
        style={STYLES.thumbInner}
      >
        {kind === 'image' ? (
          <ExpoImage
            source={{ uri }}
            style={STYLES.thumbImage}
            contentFit="cover"
            transition={120}
            cachePolicy="memory-disk"
            recyclingKey={uri}
            accessible={false}
          />
        ) : (
          // 動画 placeholder: bg + 中央 Play
          <View style={[STYLES.videoPlaceholder, { backgroundColor: thumbBg }]}>
            <View style={STYLES.videoPlayBadge}>
              <PlayIcon size={20} color="#fff" strokeWidth={2.2} fill="#fff" />
            </View>
          </View>
        )}

        {/* uploading 時の overlay + spinner */}
        {uploading && (
          <View style={STYLES.uploadOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </Pressable>

      {/* 削除 × ボタン — uploading 中は隠す (誤操作防止) */}
      {!uploading && (
        <RemoveButton
          onPress={() => onRemove(uri, kind)}
          bgColor={removeButtonBg}
          iconColor={removeIconColor}
        />
      )}
    </View>
  );
}

// ============================================================
// RemoveButton — 右上の削除 × 円ボタン
//
// 自前で scale anim を持つ. PressableScale だと shadow まで縮むため。
// ============================================================
function RemoveButton({
  onPress,
  bgColor,
  iconColor,
}: {
  onPress: () => void;
  bgColor: string;
  iconColor: string;
}): JSX.Element {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (_e: GestureResponderEvent) => {
      scale.value = withSpring(PRESS_SCALE, SPRING_SNAPPY);
    },
    [scale],
  );
  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_SNAPPY);
  }, [scale]);

  return (
    <Animated.View style={[STYLES.removeWrap, animStyle]}>
      <Pressable
        {...extraPressableProps}
        accessibilityRole="button"
        accessibilityLabel="削除"
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        // 24x24 だと iOS の min tap target を割るので hitSlop を広めに
        hitSlop={8}
        style={[
          STYLES.removeButton,
          { backgroundColor: bgColor },
          SHADOW.sm,
        ]}
      >
        <Icon.close size={14} color={iconColor} strokeWidth={2.6} />
      </Pressable>
    </Animated.View>
  );
}

// ============================================================
// AddButton — 末尾の + ボタン (画像 or 動画)
//
// dashed border + accent color + 中央アイコン.
// press で spring scale 0.95.
// ============================================================
function AddButton({
  kind,
  onPress,
  accentColor,
  bgColor,
  labelColor,
}: {
  kind: 'image' | 'video';
  onPress: () => void;
  accentColor: string;
  bgColor: string;
  labelColor: string;
}): JSX.Element {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (_e: GestureResponderEvent) => {
      scale.value = withSpring(0.95, SPRING_SNAPPY);
    },
    [scale],
  );
  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_SNAPPY);
  }, [scale]);

  const Glyph = kind === 'image' ? Icon.image : VideoIcon;
  const label = kind === 'image' ? '画像' : '動画';

  return (
    <Animated.View style={[STYLES.addWrap, animStyle]}>
      <Pressable
        {...extraPressableProps}
        accessibilityRole="button"
        accessibilityLabel={kind === 'image' ? '画像を追加' : '動画を追加'}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          STYLES.addButton,
          {
            backgroundColor: bgColor,
            // dashed border は RN 全 platform で動く (Web 含む)
            borderColor: accentColor,
            borderStyle: 'dashed',
          },
        ]}
      >
        <Glyph size={26} color={accentColor} strokeWidth={2} />
        <Text
          style={[
            T.caption,
            {
              color: labelColor,
              marginTop: 4,
            },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ============================================================
// Styles
// ============================================================
const STYLES = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: SP['4'],
    paddingVertical: SP['2'],
    gap: GAP,
    // ScrollView の子は flexDirection: row だが、 paddingHorizontal を
    // 子側の gap と分離したいので contentContainerStyle で当てる
  },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_RADIUS,
    position: 'relative',
    // overflow visible で右上の × ボタンを thumb の外にはみ出させる
    overflow: 'visible',
  },
  thumbInner: {
    width: '100%',
    height: '100%',
    borderRadius: THUMB_RADIUS,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: THUMB_RADIUS,
  },
  removeWrap: {
    position: 'absolute',
    // thumb の角からほんの少しだけはみ出させる ("浮いてる感")
    top: -6,
    right: -6,
  },
  removeButton: {
    width: REMOVE_BUTTON_SIZE,
    height: REMOVE_BUTTON_SIZE,
    borderRadius: REMOVE_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // subtle ring で薄い背景にも輪郭が出る
    borderWidth: Platform.OS === 'ios' ? 0 : 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  addWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_RADIUS,
  },
  addButton: {
    width: '100%',
    height: '100%',
    borderRadius: THUMB_RADIUS,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterRow: {
    paddingHorizontal: SP['4'],
    paddingTop: SP['1'],
    paddingBottom: SP['2'],
  },
});
