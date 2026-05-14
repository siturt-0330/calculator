import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchThreads, createThread } from '@/lib/api/bbs';

export function useBBS() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['bbs-threads'],
    queryFn: fetchThreads,
    staleTime: 60_000,
  });

  const { mutateAsync: create } = useMutation({
    mutationFn: ({ title, category }: { title: string; category: string }) =>
      createThread(title, category),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bbs-threads'] }),
  });

  return {
    threads: data ?? [],
    loading: isLoading,
    create,
  };
}
