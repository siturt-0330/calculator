import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useToastStore } from '@/stores/toastStore';
import { impact, Haptics } from '@/lib/haptics';

export function useBlock() {
  const { addBlocked, removeBlocked, blockedTags } = useTagFilterStore();
  const { show } = useToastStore();

  const blockTag = (tagName: string) => {
    impact(Haptics.ImpactFeedbackStyle.Medium);
    addBlocked(tagName);
    show(`「${tagName}」をブロックしました`, 'success', { undoLabel: '元に戻す', onUndo: () => removeBlocked(tagName) });
  };

  const unblockTag = (tagName: string) => {
    impact(Haptics.ImpactFeedbackStyle.Light);
    removeBlocked(tagName);
    show(`「${tagName}」のブロックを解除しました`, 'success');
  };

  const isBlocked = (tagName: string) => blockedTags.includes(tagName);

  return { blockTag, unblockTag, isBlocked, blockedTags };
}
