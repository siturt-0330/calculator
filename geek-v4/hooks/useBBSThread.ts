import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchReplies, createReply, fetchThread } from '../lib/api/bbs';
import { attachChannel } from '../lib/realtime';
import { useToastStore } from '../stores/toastStore';

export function useBBSThread(threadId: string) {
  const qc = useQueryClient();

  const { data: thread, error: threadError, isLoading: threadLoading } = useQuery({
    queryKey: ['bbs-thread', threadId],
    queryFn: () => fetchThread(threadId),
    // 90s: タイトル/カテゴリは基本不変。replies_count / last_reply_at の鮮度は
    // 下の realtime + 300ms defer invalidate で server trigger 反映に追随できる。
    staleTime: 90_000,
    retry: 1,
  });

  const { data, isLoading, isRefetching, refetch, error: repliesError } = useQuery({
    queryKey: ['bbs-replies', threadId],
    queryFn: () => fetchReplies(threadId),
    // 15s: 返信は活発に来るのでより新鮮に。realtime で onCreate INSERT は即 invalidate される
    // が、tab 切替 (=非 focus) で missing event があっても 15s 以内に補完される。
    staleTime: 15_000,
    retry: 1,
  });

  const { mutateAsync: reply } = useMutation({
    mutationFn: (content: string) => createReply(threadId, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bbs-replies', threadId] });
      qc.invalidateQueries({ queryKey: ['bbs-thread', threadId] });
    },
    onError: (e) => {
      // caller (app/bbs/[id].tsx) も try/catch で toast 出しているが、それは reply ボタン
      // 経路のみ。今後の caller (programmatic な reply) を壊さないよう hook 側でも
      // safety-net として toast を出す。重複表示は computeDuration が同 message で
      // 連続しないため許容範囲 (両 toast が異なる文言の可能性もあり、ユーザーに不利益なし)。
      const msg = e instanceof Error ? e.message : '';
      useToastStore.getState().show(
        msg ? `返信の投稿に失敗しました: ${msg}` : '返信の投稿に失敗しました',
        'error',
      );
    },
  });

  // Realtime: 同じスレッドへの新着返信
  // ★ replies INSERT は **replies のみ即 invalidate**。thread (replies_count /
  //   last_reply_at) は server-side trigger で更新されるが、payload が反映される
  //   まで数百 ms ラグがあるため 300ms 後に 1 度だけ defer invalidate する。
  //   従来は両方同時 invalidate していて、thread 側が trigger 反映前の古い値を
  //   そのまま fetch し直すことがあった (=replies_count が古いまま見える)。
  const threadInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!threadId) return;
    const deferThreadInvalidate = () => {
      if (threadInvalidateTimer.current) clearTimeout(threadInvalidateTimer.current);
      threadInvalidateTimer.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['bbs-thread', threadId] });
      }, 300);
    };
    const detach = attachChannel(`bbs-thread:${threadId}`, (ch) =>
      ch.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bbs_replies', filter: `thread_id=eq.${threadId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['bbs-replies', threadId] });
          deferThreadInvalidate();
        },
      ),
    );
    return () => {
      detach();
      if (threadInvalidateTimer.current) clearTimeout(threadInvalidateTimer.current);
    };
  }, [threadId, qc]);

  return {
    thread,
    replies: data ?? [],
    loading: isLoading || threadLoading,
    refreshing: isRefetching,
    refresh: refetch,
    reply,
    error: threadError || repliesError,
  };
}
