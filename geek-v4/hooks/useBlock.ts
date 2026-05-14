import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useToastStore } from '@/stores/toastStore';
import * as Haptics from 'expo-haptics';

export function useBlock() {
  const { addBlocked, removeBlocked, blockedTags } = useTagFilterStore();
  const { show } = useToastStore();

  const blockTag = (tagName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addBlocked(tagName);
    show(`「${tagName}」をブロックしました`, 'success', { undoLabel: '元に戻す', onUndo: () => removeBlocked(tagName) });
  };

  const unblockTag = (tagName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    removeBlocked(tagName);
    show(`「${tagName}」のブロックを解除しました`, 'success');
  };

  const isBlocked = (tagName: string) => blockedTags.includes(tagName);

  return { blockTag, unblockTag, isBlocked, blockedTags };
}
