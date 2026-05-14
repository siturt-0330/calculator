import { useTagFilterStore } from '@/stores/tagFilterStore';

export function useTagFilter() {
  const { likedTags, blockedTags, addLiked, removeLiked, addBlocked, removeBlocked } =
    useTagFilterStore();

  return {
    likedTags,
    blockedTags,
    blockedCount: blockedTags.length,
    addLiked,
    removeLiked,
    addBlocked,
    removeBlocked,
  };
}
