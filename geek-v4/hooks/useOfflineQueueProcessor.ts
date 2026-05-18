import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { resilient } from '@/lib/resilient';
import { useOfflineQueueStore, type QueuedAction } from '@/stores/offlineQueueStore';
import { useNetworkStatus } from './useNetworkStatus';
import { useToastStore } from '@/stores/toastStore';

const MAX_ATTEMPTS = 5;

async function executeAction(action: QueuedAction): Promise<void> {
  const p = action.payload;
  switch (action.type) {
    case 'like': {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error('Not authenticated');
      await supabase.from('likes').insert({ user_id: userId, post_id: p.postId as string });
      break;
    }
    case 'unlike': {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error('Not authenticated');
      await supabase.from('likes').delete().eq('user_id', userId).eq('post_id', p.postId as string);
      break;
    }
    case 'reaction_add': {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error('Not authenticated');
      await supabase.from('post_reactions').insert({
        user_id: userId,
        post_id: p.postId as string,
        meme: p.meme as string,
      });
      break;
    }
    case 'reaction_remove': {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error('Not authenticated');
      await supabase
        .from('post_reactions')
        .delete()
        .eq('user_id', userId)
        .eq('post_id', p.postId as string)
        .eq('meme', p.meme as string);
      break;
    }
    case 'comment': {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error('Not authenticated');
      const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
      await supabase.from('comments').insert({
        post_id: p.postId as string,
        content: p.content as string,
        avatar_color: color,
        author_id: userId,
      });
      break;
    }
    case 'bbs_reply': {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error('Not authenticated');
      const color = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
      await supabase.from('bbs_replies').insert({
        thread_id: p.threadId as string,
        content: p.content as string,
        color,
        author_id: userId,
      });
      break;
    }
  }
}

/**
 * オフラインキューを定期的にチェックし、復活時に再実行する。
 * Root layout で 1 回だけ mount すれば OK。
 */
export function useOfflineQueueProcessor() {
  const { online } = useNetworkStatus();
  const { queue, dequeue, markAttempt } = useOfflineQueueStore();
  const hydrate = useOfflineQueueStore((s) => s.hydrate);
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();
  const processingRef = useRef(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!online || queue.length === 0 || processingRef.current) return;
    processingRef.current = true;
    void (async () => {
      let processedCount = 0;
      for (const action of queue) {
        if (action.attempts >= MAX_ATTEMPTS) {
          dequeue(action.id);
          continue;
        }
        try {
          await resilient(() => executeAction(action), {
            name: `offline.${action.type}`,
            retries: 1,
            timeoutMs: 8000,
          });
          dequeue(action.id);
          processedCount += 1;
        } catch {
          markAttempt(action.id);
        }
      }
      if (processedCount > 0) {
        show(`📡 オフライン中のアクション ${processedCount} 件を同期しました`, 'success');
        // 関連クエリを更新
        qc.invalidateQueries({ queryKey: ['feed'] });
        qc.invalidateQueries({ queryKey: ['my-likes'] });
        qc.invalidateQueries({ queryKey: ['post-comments'] });
        qc.invalidateQueries({ queryKey: ['bbs-replies'] });
      }
      processingRef.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, queue.length]);
}
