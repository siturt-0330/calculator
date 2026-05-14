import { useRouter } from 'expo-router';
import { Icon } from '@/constants/icons';
import { PressableScale } from '@/components/ui/PressableScale';
import { C, SP } from '@/design/tokens';

export function BackButton({ onPress }: { onPress?: () => void }) {
  const router = useRouter();
  const ChevronL = Icon.chevronL;
  return (
    <PressableScale
      onPress={() => (onPress ? onPress() : router.back())}
      style={{ padding: SP['2'], marginLeft: -SP['2'] }}
      accessibilityLabel="戻る"
    >
      <ChevronL size={26} color={C.text} strokeWidth={2.2} />
    </PressableScale>
  );
}
