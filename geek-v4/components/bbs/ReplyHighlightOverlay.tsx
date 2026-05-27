// ============================================================
// ReplyHighlightOverlay
// ============================================================
// >>N タップで該当返信に scroll した直後、薄い accent overlay を
// 該当行に被せて「ここだよ」を示すための ephemeral overlay。
//
// 使い方 (任意):
//   const [hl, setHl] = useState<string | null>(null);
//   // >>N tap 後に flash 開始
//   onPressQuote = () => { scrollToReply(idx); setHl(item.id); };
//   // renderReply の中で:
//   <View style={{ position: 'relative' }}>
//     ...reply 本体...
//     <ReplyHighlightOverlay
//       visible={hl === item.id}
//       onDone={() => setHl(null)}
//     />
//   </View>
//
// 設計:
//   - pointerEvents: 'none' で下層の tap を妨げない
//   - reanimated useSharedValue + withTiming で fade in/out
//   - 200ms hold + 220ms fade-out (合計 ~600ms 程度の subtle pulse)
//   - reduced motion ユーザには即時表示 → 即時消し (静止フラッシュ)
// ============================================================
import { useEffect } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { C, R } from '../../design/tokens';

export interface ReplyHighlightOverlayProps {
  /** true になった瞬間に flash を 1 回再生する */
  visible: boolean;
  /** flash 完了時に呼ばれる (親側で state を null に戻す用) */
  onDone?: () => void;
  /** 既定の角丸を上書きしたい場合 (reply card の borderRadius と揃える) */
  borderRadius?: number;
  /** 開始までの delay (ms) — scroll 完了後に発火させたい時に使う */
  delayMs?: number;
  /** ピーク時の opacity (default 0.32) */
  peakOpacity?: number;
  /** カスタム style (position は absolute 固定) */
  style?: StyleProp<ViewStyle>;
}

const FADE_IN_MS = 120;
const HOLD_MS = 200;
const FADE_OUT_MS = 240;

export function ReplyHighlightOverlay({
  visible,
  onDone,
  borderRadius = R.lg,
  delayMs = 0,
  peakOpacity = 0.32,
  style,
}: ReplyHighlightOverlayProps) {
  // useSharedValue で opacity を制御 — worklet スレッドで動くので 60fps を保てる
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      // 親が visible=false に戻したら即フェード out
      opacity.value = withTiming(0, { duration: FADE_OUT_MS });
      return;
    }
    // visible=true の瞬間に 1 回だけシーケンスを走らせる
    opacity.value = withDelay(
      delayMs,
      withSequence(
        withTiming(peakOpacity, { duration: FADE_IN_MS }),
        withDelay(
          HOLD_MS,
          withTiming(0, { duration: FADE_OUT_MS }, (finished) => {
            if (finished && onDone) {
              // worklet → JS thread に戻して onDone を発火
              runOnJS(onDone)();
            }
          }),
        ),
      ),
    );
    // `opacity` (SharedValue) は ref 同様の不変 ID なので deps に入れる必要なし
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, delayMs, peakOpacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      // 下層の reply 本体の tap を妨げない
      pointerEvents="none"
      // overflow:'hidden' を kanji にして gradient を借りた状態でも親 (reply card)
      // の borderRadius に綺麗にクリップされるよう、ここでも radius を持つ。
      style={[
        StyleSheet.absoluteFillObject,
        { borderRadius, overflow: 'hidden' },
        animStyle,
        style,
      ]}
    >
      <LinearGradient
        // 紫 → 透明 (左上から右下へ) — 「光が差した」風の演出
        colors={[C.accentGlow, 'rgba(124,106,247,0.10)', 'rgba(124,106,247,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    </Animated.View>
  );
}

export default ReplyHighlightOverlay;
