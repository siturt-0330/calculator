import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchThreads, createThread } from '../lib/api/bbs';
import { attachChannel } from '../lib/realtime';

export function useBBS() {
  const qc = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['bbs-threads'],
    queryFn: fetchThreads,
    staleTime: 30_000,
    // パフォーマンス監査: 'always' は staleTime を無視して毎マウント refetch するため
    // タブ切替時に必ず網絡 RTT 発生。staleTime 30s に従う default 動作に変更。
    // 新規スレッド検知は realtime subscription (下の attachChannel) でカバー済み。
  });

  const { mutateAsync: create } = useMutation({
    mutationFn: ({ title, category }: { title: string; category: string }) =>
      createThread(title, category),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bbs-threads'] }),
  });

  // Realtime: スレッド新規/更新 + 返信があったら一覧を更新 (replies_count, last_reply_at)
  // - visibility='public' のスレッドだけが一覧に出るので server-side で絞る
  // - bbs_replies の INSERT は filter できない (どの thread の reply かは payload を
  //   見ないと分からない) ので、3s debounce で fanout を集約する
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const invalidate = (delay = 1500) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['bbs-threads'] });
      }, delay);
    };
    const detach = attachChannel('bbs-threads-list', (ch) =>
      ch.on('postgres_changes', {
        event: '*', schema: 'public', table: 'bbs_threads',
        filter: 'visibility=eq.public',
      }, () => invalidate(1500))
        // 返信は filter できないが、3s debounce で集約 (返信量が多いコミュニティでも
        // 重い fanout を吸収)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bbs_replies' },
          () => invalidate(3000)),
    );
    return () => {
      detach();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [qc]);

  return {
    threads: data ?? [],
    loading: isLoading,
    refreshing: isRefetching,
    refresh: refetch,
    create,
  };
}
