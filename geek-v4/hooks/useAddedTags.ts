import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '../lib/realtime';
import { addPostTag, fetchAddedTagsForPosts, removePostTag } from '../lib/api/tags';

const KEY_PREFIX = 'post-added-tags-batch';

function keyForIds(postIds: string[]) {
  return [KEY_PREFIX, postIds.slice().sort().join(',')];
}

export function useAddedTags(postIds: string[]) {
  const qc = useQueryClient();
  const sortedKey = postIds.slice().sort().join(',');

  const q = useQuery({
    queryKey: keyForIds(postIds),
    queryFn: () => fetchAddedTagsForPosts(postIds),
    enabled: postIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (postIds.length === 0) return;
    // O(1) lookup
    const idSet = new Set(postIds);
    // server-side filter で現在表示中の post の追加タグ変更だけを受信。
    // 全フィードユーザーに全タグ追加イベントを fanout するのは無駄。
    const serverIds = postIds.slice(0, 30);
    return attachChannel(`post-added-tags:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_added_tags',
          filter: `post_id=in.(${serverIds.join(',')})`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as { post_id?: string } | null;
          // 「全 prefix を invalidate」ではなく、今の sortedKey の query だけを再 fetch
          // 他のフィードビュー (例: 検索結果) の query は影響を受けない
          if (row?.post_id && idSet.has(row.post_id)) {
            qc.invalidateQueries({ queryKey: [KEY_PREFIX, sortedKey] });
          }
        },
      ),
    );
  }, [sortedKey, postIds, qc]);

  return { data: (q.data ?? {}) as Record<string, string[]>, isLoading: q.isLoading };
}

export function useAddTag() {
  const qc = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ postId, tag }: { postId: string; tag: string }) => addPostTag(postId, tag),
    onMutate: async ({ postId, tag }) => {
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] });
      qc.setQueriesData({ queryKey: [KEY_PREFIX] }, (old: Record<string, string[]> | undefined) => {
        if (!old) return old;
        const next = { ...old };
        const arr = (next[postId] ?? []).slice();
        if (!arr.includes(tag)) arr.push(tag);
        next[postId] = arr;
        return next;
      });
      // 個別 queryKey もある (post detail)
      qc.invalidateQueries({ queryKey: ['post-added-tags', postId] });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
    },
  });
  return {
    addTag: (postId: string, tag: string) => mutateAsync({ postId, tag }),
  };
}

export function useRemoveTag() {
  const qc = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ postId, tag }: { postId: string; tag: string }) => removePostTag(postId, tag),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
      qc.invalidateQueries({ queryKey: ['post-added-tags'] });
    },
  });
  return {
    removeTag: (postId: string, tag: string) => mutateAsync({ postId, tag }).catch(() => {}),
  };
}
