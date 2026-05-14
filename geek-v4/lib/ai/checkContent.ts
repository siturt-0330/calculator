import { supabase } from '@/lib/supabase';

type CheckResult = { ok: boolean; reason?: string };

export async function checkContent({
  content,
  tags,
}: {
  content: string;
  tags: string[];
}): Promise<CheckResult> {
  try {
    const { data, error } = await supabase.functions.invoke('check-content', {
      body: { content, tags },
    });
    if (error) return { ok: true }; // edge function 未設定時はパス
    return data as CheckResult;
  } catch {
    return { ok: true };
  }
}
