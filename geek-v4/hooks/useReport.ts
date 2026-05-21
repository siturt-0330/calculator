import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useToastStore } from '../stores/toastStore';
import { notify, Haptics } from '../lib/haptics';

export function useReport() {
  // scoped selector — toast actions are stable, avoid whole-store subscription
  const show = useToastStore((s) => s.show);

  const { mutateAsync: report, isPending } = useMutation({
    mutationFn: async ({ postId, reason }: { postId: string; reason: string }) => {
      const { data: session } = await supabase.auth.getSession();
      const reporter_id = session.session?.user.id;
      if (!reporter_id) throw new Error('Not authenticated');
      const { error } = await supabase.from('reports').insert({ post_id: postId, reason, reporter_id });
      if (error) throw error;
    },
    onSuccess: () => {
      notify(Haptics.NotificationFeedbackType.Success);
      show('通報しました。ご協力ありがとうございます。', 'success');
    },
    onError: () => {
      show('通報に失敗しました。', 'error');
    },
  });

  return { report, isPending };
}
