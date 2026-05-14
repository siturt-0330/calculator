import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export function useSave() {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const toggle = async (postId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const isSaved = saved.has(postId);
    if (isSaved) {
      setSaved((s) => { const n = new Set(s); n.delete(postId); return n; });
      await supabase.from('saves').delete().eq('post_id', postId).eq('user_id', user.id);
    } else {
      setSaved((s) => new Set([...s, postId]));
      await supabase.from('saves').insert({ post_id: postId, user_id: user.id });
    }
  };

  return { toggle, isSaved: (id: string) => saved.has(id) };
}
