import { useRouter, useSegments } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Icon } from '../../constants/icons';
import { PressableScale } from '../ui/PressableScale';
import { C, SP } from '../../design/tokens';

// 戻るボタンの取りこぼし対策:
// 1. canGoBack() が false でも (= ディープリンクで直接開いた等) 文脈に合った tab に戻れる
//    fallback (community 詳細 → コミュニティ一覧、bbs 詳細 → 掲示板 etc.)
// 2. 短時間の連打を吸収して、navigation が処理中に追加 push されるのを防ぐ
// 3. hitSlop を広げてタップしやすく
// 4. アイコン自体に opacity フェードは付けず即時応答
export function BackButton({ onPress }: { onPress?: () => void }) {
  const router = useRouter();
  const segments = useSegments();
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
      style={{ padding: SP['2'], marginLeft: -SP['2'] }}
      accessibilityLabel="戻る"
    >
      <ChevronL size={26} color={C.text} strokeWidth={2.2} />
    </PressableScale>
  );
}
