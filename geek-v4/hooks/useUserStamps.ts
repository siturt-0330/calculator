import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachChannel } from '@/lib/realtime';
import { createUserStamp, deleteUserStamp, fetchUserStamps, type UserStamp } from '@/lib/api/userStamps';

const KEY = ['user-stamps'];

export function useUserStamps() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: KEY,
    queryFn: fetchUserStamps,
    staleTime: 60_000,
  });

  useEffect(() => {
    return attachChannel('user-stamps-feed', (ch) =>
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_stamps' },
        () => qc.invalidateQueries({ queryKey: KEY }),
      ),
    );
  }, [qc]);

  return { stamps: (q.data ?? []) as UserStamp[], isLoading: q.isLoading };
}

export function useCreateUserStamp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; category?: string; isPublic?: boolean }) =>
      createUserStamp(input.text, input.category, input.isPublic),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteUserStamp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteUserStamp,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
