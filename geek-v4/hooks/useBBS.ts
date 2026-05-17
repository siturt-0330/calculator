import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchThreads, createThread } from '@/lib/api/bbs';
import { supabase } from '@/lib/supabase';

export function useBBS() {
  const qc = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['bbs-threads'],
    queryFn: fetchThreads,
    staleTime: 30_000,
    refetchOnMount: 'always',  // タブを開き直すたびに最新を取得
  });

  const { mutateAsync: create } = useMutation({
    mutationFn: ({ title, category }: { title: string; category: string }) =>
      createThread(title, category),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bbs-threads'] }),
  });

  // Realtime: スレッド新規/更新 + 返信があったら一覧を更新 (replies_count, last_reply_at)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const invalidate = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['bbs-threads'] });
      }, 1500);
    };
    const channel = supabase
      .channel('bbs-threads-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bbs_threads' }, invalidate)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bbs_replies' }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
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
