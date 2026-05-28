import { useRouter, useSegments } from 'expo-router';
import { useCallback, useRef } from 'react';
import { View } from 'react-native';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { SP } from '../../design/tokens';
import { useColors } from '../../hooks/useColors';

// ============================================================
// iOS-native BackButton
// ------------------------------------------------------------
// 設計 (2026-05-28 polish):
//   - chevron-left (< 形) — iOS HIG の navigation back glyph
//   - tappable area は 44pt 固定 (Apple HIG 最小タッチ領域)
//   - hitSlop で更に周辺 12pt まで誤タップを救う
//   - 即時応答 (delayPressIn=0, PressableScale が処理)
//   - dark/light は useColors() で自動切替 (C.text)
//
// 戻るボタンの取りこぼし対策 (既存ロジック維持):
// 1. canGoBack() が false でも tab home へ fallback
// 2. 80ms in-flight ロックで連打吸収
// 3. hitSlop で周辺タップを救う
// ============================================================
const TAPPABLE_SIZE = 44;

export function BackButton({ onPress }: { onPress?: () => void }) {
  const router = useRouter();
  const segments = useSegments();
  const C = useColors();
  const ChevronL = Icon.chevronL;
  const inFlight = useRef(false);

  const handlePress = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    // 80ms 後にロック解除 (誤連打のみ吸収。普通のタップは即時通過)
    setTimeout(() => { inFlight.current = false; }, 80);

    if (onPress) {
      onPress();
      return;
    }
    // expo-router の戻り先が無い時 (直接 URL でアクセス、PWA から起動など) は
    // 文脈に合った tab home へフォールバック
    const r = router as unknown as { canGoBack?: () => boolean };
    const canGoBack = typeof r.canGoBack === 'function' ? r.canGoBack() : true;
    if (canGoBack) {
      router.back();
      return;
    }
    // セグメントから「今どの tab 系の画面にいるか」を推測してそこの home に戻す。
    // ex) /community/abc/spot/create → /community
    const segs = segments as unknown as readonly string[];
    const tabSeg = segs.find((s) => ['community', 'bbs', 'feed', 'mypage'].includes(s));
    const dest =
      tabSeg === 'community' ? '/(tabs)/community'
      : tabSeg === 'bbs' ? '/(tabs)/bbs'
      : tabSeg === 'mypage' ? '/(tabs)/mypage'
      : '/(tabs)/feed';
    router.replace(dest as never);
  }, [onPress, router, segments]);

  return (
    <PressableScale
      onPress={handlePress}
      haptic="tap"
      hitSlop={12}
      // 44pt 固定の tappable container + leading 余白マイナスで視覚的に詰める
      style={{
        width: TAPPABLE_SIZE,
        height: TAPPABLE_SIZE,
        alignItems: 'flex-start',
        justifyContent: 'center',
        marginLeft: -SP['2'],
      }}
      accessibilityLabel="戻る"
      accessibilityRole="button"
    >
      <View
        style={{
          width: TAPPABLE_SIZE,
          height: TAPPABLE_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ChevronL size={28} color={C.text} strokeWidth={2.4} />
      </View>
    </PressableScale>
  );
}
