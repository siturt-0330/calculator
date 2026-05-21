import { useTagFilterStore } from '../stores/tagFilterStore';
import { useToastStore } from '../stores/toastStore';
import { impact, Haptics } from '../lib/haptics';

// Selectors are scoped to a single store-field per call so that toast
// show/dismiss cycles (very frequent) don't re-render every consumer of
// useBlock. action refs from zustand are stable across renders.
export function useBlock() {
  const addBlocked = useTagFilterStore((s) => s.addBlocked);
  const removeBlocked = useTagFilterStore((s) => s.removeBlocked);
  const blockedTags = useTagFilterStore((s) => s.blockedTags);
  const show = useToastStore((s) => s.show);

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
