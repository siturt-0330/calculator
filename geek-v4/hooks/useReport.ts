import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToastStore } from '@/stores/toastStore';
import * as Haptics from 'expo-haptics';

export function useReport() {
  const { show } = useToastStore();

  const { mutateAsync: report, isPending } = useMutation({
    mutationFn: async ({ postId, reason }: { postId: string; reason: string }) => {
      const { error } = await supabase.from('reports').insert({ post_id: postId, reason });
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      show('通報しました。ご協力ありがとうございます。', 'success');
    },
    onError: () => {
      show('通報に失敗しました。', 'error');
    },
  });

  return { report, isPending };
}
