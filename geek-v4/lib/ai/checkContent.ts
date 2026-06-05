import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

type CheckResult = { ok: boolean; reason?: string };

// AI 審査 (check-content Edge Function)。投稿 publish 前に await されるので
// ★ タイムアウト必須。Edge 関数のコールドスタートやモバイル回線の half-open で
//   invoke が解決も拒否もしないと、投稿ボタンが「投稿中…」のまま永久に固まる
//   (復帰はリロードのみ)。timeout 時は fail-open(ok:true)で投稿を通す。
export async function checkContent({
  content,
  tags,
}: {
  content: string;
  tags: string[];
}): Promise<CheckResult> {
  try {
    const { data, error } = await withApiTimeout(
      supabase.functions.invoke('check-content', { body: { content, tags } }),
      'checkContent',
      8000,
    );
    if (error) return { ok: true }; // edge function 未設定時はパス
    return data as CheckResult;
  } catch {
    // timeout / network / 未設定 — いずれも fail-open(投稿をブロックしない)
    return { ok: true };
  }
}
