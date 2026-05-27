// ============================================================
// useSupportThread — Modmail 詳細 hook (thread + messages + send)
// ============================================================
// 用途:
//   - スレッド本体 (subject / state) を fetch
//   - messages 一覧を fetch
//   - sendMessage mutation (user / admin 両方使える)
//   - markRead: 詳細画面を開いたら自動で既読化
//   - archive / reopen mutation (admin 専用 UI から叩く)
//
// queryKey:
//   ['support-thread', threadId]
//   ['support-messages', threadId]
// ============================================================
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveThread,
  fetchMessages,
  fetchThread,
  markRead,
  reopenThread,
  sendMessage,
  type SupportMessage,
  type SupportThread,
} from '../lib/api/support';
import { useToastStore } from '../stores/toastStore';

export function useSupportThread(threadId: string, opts?: { asAdmin?: boolean }) {
  const qc = useQueryClient();
  const asAdmin = !!opts?.asAdmin;

  const threadQuery = useQuery({
    queryKey: ['support-thread', threadId],
    queryFn: () => fetchThread(threadId),
    enabled: !!threadId,
    staleTime: 30_000,
    retry: 1,
  });

  const messagesQuery = useQuery({
    queryKey: ['support-messages', threadId],
    queryFn: () => fetchMessages(threadId),
    enabled: !!threadId,
    // 15s: 返信は活発に来るのでより新鮮に。詳細画面開いてる間はずっと最新を保ちたい
    staleTime: 15_000,
    retry: 1,
  });

  // 既読化: 詳細画面を開いたら 1 度だけ叩く
  // 注: messages を読んだあとで update する必要は無いが、UX 的には開いた瞬間に
  //     一覧の unread bagde を消したいので effect で fire-and-forget。
  useEffect(() => {
    if (!threadId) return;
    void (async () => {
      await markRead(threadId, asAdmin);
      // 一覧の counter を反映するために support-threads 一覧を invalidate
      void qc.invalidateQueries({ queryKey: ['support-threads'] });
      // thread 本体も再 fetch (unread 表示の差し戻し)
      void qc.invalidateQueries({ queryKey: ['support-thread', threadId] });
    })();
    // asAdmin / threadId の変化ごとに 1 度だけ実行
  }, [threadId, asAdmin, qc]);

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendMessage(threadId, content, { asAdmin }),
    onSuccess: (newMessage) => {
      // optimistic update: messages list に追加
      qc.setQueryData<SupportMessage[]>(
        ['support-messages', threadId],
        (prev) => (prev ? [...prev, newMessage] : [newMessage]),
      );
      // thread 本体 (counter) と一覧も refresh
      void qc.invalidateQueries({ queryKey: ['support-thread', threadId] });
      void qc.invalidateQueries({ queryKey: ['support-threads'] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : '';
      useToastStore
        .getState()
        .show(msg ? `送信に失敗しました: ${msg}` : '送信に失敗しました', 'error');
    },
  });

  // admin 用 mutation: archive / reopen
  const archiveMutation = useMutation({
    mutationFn: () => archiveThread(threadId),
    onSuccess: () => {
      useToastStore.getState().show('解決済にしました', 'success');
      void qc.invalidateQueries({ queryKey: ['support-thread', threadId] });
      void qc.invalidateQueries({ queryKey: ['support-threads'] });
    },
    onError: () => {
      useToastStore.getState().show('変更に失敗しました', 'error');
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => reopenThread(threadId),
    onSuccess: () => {
      useToastStore.getState().show('再オープンしました', 'success');
      void qc.invalidateQueries({ queryKey: ['support-thread', threadId] });
      void qc.invalidateQueries({ queryKey: ['support-threads'] });
    },
    onError: () => {
      useToastStore.getState().show('変更に失敗しました', 'error');
    },
  });

  return {
    thread: (threadQuery.data ?? null) as SupportThread | null,
    messages: (messagesQuery.data ?? []) as SupportMessage[],
    isLoading: threadQuery.isLoading || messagesQuery.isLoading,
    isRefetching: messagesQuery.isRefetching,
    refetch: messagesQuery.refetch,
    error: threadQuery.error || messagesQuery.error,
    send: sendMutation.mutateAsync,
    sending: sendMutation.isPending,
    archive: archiveMutation.mutateAsync,
    archiving: archiveMutation.isPending,
    reopen: reopenMutation.mutateAsync,
    reopening: reopenMutation.isPending,
  };
}
