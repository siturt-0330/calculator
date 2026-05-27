// ============================================================
// postEdits — 投稿の編集履歴 (Reddit ガイド 2.11 章)
// ============================================================
// 投稿 UPDATE 時に DB trigger (0062_post_edits.sql) が過去版を
// post_edits テーブルに保存する。本モジュールはそれを読むだけの
// read-only クエリ層。
//
// 設計判断:
//   - INSERT/UPDATE/DELETE は提供しない — RLS で deny default にしてある
//     ので、誤って client から書き込もうとしても 403 になる。trigger
//     経由のみが正規ルート。
//   - resilient / withApiTimeout は使わない — modal を開いた時の lazy
//     fetch なので、retry のためにユーザーを待たせる価値が薄い。失敗
//     したら React Query が onError で素直にエラー表示する方が UX が良い。
// ============================================================

import { supabase } from '../supabase';

export type PostEdit = {
  id: string;
  post_id: string;
  prev_content: string;
  edited_at: string;
};

/**
 * 指定 post の編集履歴を最新順で取得。
 *
 * @param postId  投稿 ID
 * @returns       最新 3 版までの過去 content (新しい順)。trigger 側で 3 件
 *                cap してあるので追加の limit は不要だが、防御的に limit(3)
 *                を付けて将来 cap が変わっても client 側で安全になるように。
 */
export async function fetchPostEditHistory(postId: string): Promise<PostEdit[]> {
  const { data, error } = await supabase
    .from('post_edits')
    .select('id, post_id, prev_content, edited_at')
    .eq('post_id', postId)
    .order('edited_at', { ascending: false })
    .limit(3);
  if (error) throw error;
  return (data ?? []) as PostEdit[];
}
