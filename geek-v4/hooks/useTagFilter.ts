import { useTagFilterStore } from '../stores/tagFilterStore';

// Field-scoped selectors so action-only callers (e.g. an ObsidianSaveButton
// that just needs addLiked) don't re-render whenever any tag is added/removed
// elsewhere in the tree.
export function useTagFilter() {
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const blockedTags = useTagFilterStore((s) => s.blockedTags);
  const addLiked = useTagFilterStore((s) => s.addLiked);
  const removeLiked = useTagFilterStore((s) => s.removeLiked);
  const addBlocked = useTagFilterStore((s) => s.addBlocked);
  const removeBlocked = useTagFilterStore((s) => s.removeBlocked);

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
