import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '@/lib/realtime';
import { fetchReactionsForPosts, toggleReaction, type ReactionsByPost } from '@/lib/api/reactions';

const KEY_PREFIX = 'reactions';

function keyForIds(postIds: string[]) {
  return [KEY_PREFIX, postIds.slice().sort().join(',')];
}

// 投稿IDの集合に対するリアクション一括取得 + Realtime 反映
export function useReactions(postIds: string[]) {
  const qc = useQueryClient();
  const sortedKey = postIds.slice().sort().join(',');

  const q = useQuery({
    queryKey: keyForIds(postIds),
    queryFn: () => fetchReactionsForPosts(postIds),
    enabled: postIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (postIds.length === 0) return;
    return attachChannel(`reactions:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'post_reactions' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { post_id?: string } | null;
          if (!row?.post_id) return;
          // 影響を受ける post を含むクエリだけを refetch
          // (KEY_PREFIX で全 reactions キーを invalidate すると、画面上の
          //  関係ない post まで refetch されて UI がチカチカする)
          qc.invalidateQueries({
            predicate: (query) => {
              const k = query.queryKey;
              if (!Array.isArray(k) || k[0] !== KEY_PREFIX) return false;
              const ids = typeof k[1] === 'string' ? k[1] : '';
              return ids.split(',').includes(row.post_id!);
            },
          });
        },
      ),
    );
  }, [sortedKey, postIds, qc]);

  return { data: (q.data ?? {}) as ReactionsByPost, isLoading: q.isLoading };
}

export function useReactionToggle() {
  const qc = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ postId, meme }: { postId: string; meme: string }) => toggleReaction(postId, meme),
    onMutate: async ({ postId, meme }) => {
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] });
      // Optimistic: 全ての reactions クエリで該当 postId/meme をトグル
      qc.setQueriesData({ queryKey: [KEY_PREFIX] }, (old: ReactionsByPost | undefined) => {
        if (!old) return old;
        const next = { ...old };
        const list = (next[postId] ?? []).slice();
        const idx = list.findIndex((r) => r.meme === meme);
        const cur = idx >= 0 ? list[idx] : undefined;
        if (cur) {
          if (cur.mine) {
            const newCount = cur.count - 1;
            if (newCount <= 0) list.splice(idx, 1);
            else list[idx] = { meme: cur.meme, count: newCount, mine: false };
          } else {
            list[idx] = { meme: cur.meme, count: cur.count + 1, mine: true };
          }
        } else {
          list.push({ meme, count: 1, mine: true });
        }
        list.sort((a, b) => b.count - a.count);
        next[postId] = list;
        return next;
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
    },
  });

  return {
    toggle: (postId: string, meme: string) =>
      mutateAsync({ postId, meme }).catch((e) => {
        console.warn('[useReactions] toggle failed:', e);
        // 失敗時は invalidate して server-truth に戻す (楽観更新の rollback)
        qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
      }),
  };
}
