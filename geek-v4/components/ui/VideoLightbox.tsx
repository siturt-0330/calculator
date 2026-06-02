// ============================================================
// VideoLightbox — タップで開く全画面動画ビューア (画像の ImageLightbox の動画版)
// ------------------------------------------------------------
// グローバル store (useVideoLightboxStore) の uri がセットされたら開く。アプリ root
// (_layout) に 1 つだけ常駐させる。各所の VideoPlayer タップ → store.open(uri) で起動。
//   - 暗背景 + 中央に VideoPlayer (shouldPlay=再生固定 / initialMuted=false=音あり /
//     expandable=false=再帰展開防止)
//   - 背景 single-tap で閉じる / 右上 × / Android back / native は下スワイプで閉じる
//   - Web は gesture-handler が不安定なため tap + × のみ (ImageLightbox と同方針)
// ============================================================
import { memo, useMemo } from 'react';
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../constants/icons';
import { useColors } from '../../hooks/useColors';
import { VideoPlayer } from './VideoPlayer';
import { useVideoLightboxStore } from '../../stores/videoLightboxStore';

function VideoLightboxInner() {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const uri = useVideoLightboxStore((s) => s.uri);
  const poster = useVideoLightboxStore((s) => s.poster);
  const close = useVideoLightboxStore((s) => s.close);

  const isWeb = Platform.OS === 'web';

  // native: 下スワイプ (translationY > 100) で閉じる
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(12)
        .onEnd((e) => {
          if (e.translationY > 100 || e.velocityY > 800) {
            runOnJS(close)();
          }
        }),
    [close],
  );

  if (!uri) {
    return (
      <Modal visible={false} transparent animationType="none">
        <View />
      </Modal>
    );
  }

  const player = (
    <VideoPlayer
      uri={uri}
      poster={poster ?? undefined}
      shouldPlay
      expandable={false}
      initialMuted={false}
      style={{ width: screenW, borderRadius: 0 }}
    />
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        {/* 背景 close レイヤ — プレイヤーの背面に敷く全画面 Pressable。
            プレイヤーは sibling として上に重ねるので、動画タップが close へ伝播しない
            (web で nested Pressable だと「動画タップ→mute と close が二重発火」になる問題の回避)。 */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
        />
        {/* 中央プレイヤー (box-none: 空き領域のタップは背面 close レイヤへ抜ける) */}
        <View style={styles.center} pointerEvents="box-none">
          {isWeb ? (
            player
          ) : (
            <GestureDetector gesture={panGesture}>
              <View>{player}</View>
            </GestureDetector>
          )}
        </View>
        {/* × ボタン */}
        <Pressable
          onPress={close}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          style={[styles.closeBtn, { top: insets.top + 8, right: insets.right + 12 }]}
        >
          <Icon.close size={22} color={C.text} strokeWidth={2.4} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
});

export const VideoLightbox = memo(VideoLightboxInner);
