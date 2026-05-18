import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '@/lib/realtime';
import {
  fetchReactionsForReplies,
  toggleBBSReplyReaction,
  type ReactionsByReply,
} from '@/lib/api/bbsReplyReactions';

const KEY_PREFIX = 'bbs-reply-reactions';

function keyForIds(replyIds: string[]) {
  return [KEY_PREFIX, replyIds.slice().sort().join(',')];
}

export function useBBSReplyReactions(replyIds: string[]) {
  const qc = useQueryClient();
  const sortedKey = replyIds.slice().sort().join(',');

  const q = useQuery({
    queryKey: keyForIds(replyIds),
    queryFn: () => fetchReactionsForReplies(replyIds),
    enabled: replyIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!sortedKey) return;
    const idSet = new Set(sortedKey.split(','));
    return attachChannel(`bbs-reply-reactions:${sortedKey.slice(0, 64)}`, (ch) =>
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bbs_reply_reactions' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { reply_id?: string } | null;
          if (row?.reply_id && idSet.has(row.reply_id)) {
            qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
          }
        },
      ),
    );
  }, [sortedKey, qc]);

  return { data: (q.data ?? {}) as ReactionsByReply, isLoading: q.isLoading };
}

export function useBBSReplyReactionToggle() {
  const qc = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ replyId, meme }: { replyId: string; meme: string }) =>
      toggleBBSReplyReaction(replyId, meme),
    onMutate: async ({ replyId, meme }) => {
      await qc.cancelQueries({ queryKey: [KEY_PREFIX] });
      qc.setQueriesData({ queryKey: [KEY_PREFIX] }, (old: ReactionsByReply | undefined) => {
        if (!old) return old;
        const next = { ...old };
        const list = (next[replyId] ?? []).slice();
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
        next[replyId] = list;
        return next;
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY_PREFIX] });
    },
  });

  return {
    toggle: (replyId: string, meme: string) =>
      mutateAsync({ replyId, meme }).catch(() => {}),
  };
}
