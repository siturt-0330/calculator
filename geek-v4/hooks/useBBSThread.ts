import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchReplies, createReply } from '@/lib/api/bbs';

export function useBBSThread(threadId: string) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['bbs-replies', threadId],
    queryFn: () => fetchReplies(threadId),
    staleTime: 30_000,
  });

  const { mutateAsync: reply } = useMutation({
    mutationFn: (content: string) => createReply(threadId, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bbs-replies', threadId] }),
  });

  return { replies: data ?? [], loading: isLoading, reply };
}
