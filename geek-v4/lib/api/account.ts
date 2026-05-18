import { supabase } from '@/lib/supabase';

// ============================================================
// Account API (GDPR / personal data control)
// ============================================================
// - exportUserData: 自分のデータをまとめて JSON で取得
//   (GDPR Right to Data Portability / 個人情報保護法の本人開示請求)
// - deleteAccount: アカウント完全削除
//   (GDPR Right to Erasure / 個人情報保護法の利用停止・消去請求)
//
// 削除されるデータ:
//   profiles, posts, comments, bbs_threads, bbs_replies, likes,
//   reactions, bookmarks, follows, blocks, notifications,
//   tag_filters, oshi, saved_searches, polls, votes, app_feedback
//
// 注: 法令対応のため、auth.users 自体は Supabase admin function (RPC: delete_account)
//     経由で削除する。RLS では users テーブルに自己 DELETE 権限を付けない設計が安全。
// ============================================================

export type UserExportData = {
  exported_at: string;
  user_id: string;
  profile: Record<string, unknown> | null;
  posts: unknown[];
  comments: unknown[];
  bbs_threads: unknown[];
  bbs_replies: unknown[];
  likes: unknown[];
  post_reactions: unknown[];
  bbs_reply_reactions: unknown[];
  saves: unknown[];
  bookmark_collections: unknown[];
  tag_subscriptions: unknown[];
  user_liked_tags: unknown[];
  user_blocked_tags: unknown[];
  user_stamps: unknown[];
  saved_searches: unknown[];
  notifications: unknown[];
  concerns: unknown[];
};

export async function exportUserData(): Promise<UserExportData> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const uid = user.id;

  // 並列で全テーブル取得
  const [
    profile,
    posts,
    comments,
    bbsThreads,
    bbsReplies,
    likes,
    postReactions,
    bbsReplyReactions,
    saves,
    bookmarkCollections,
    tagSubscriptions,
    userLikedTags,
    userBlockedTags,
    userStamps,
    savedSearches,
    notifications,
    concerns,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
    supabase.from('posts').select('*').eq('author_id', uid),
    supabase.from('comments').select('*').eq('author_id', uid),
    supabase.from('bbs_threads').select('*').eq('author_id', uid),
    supabase.from('bbs_replies').select('*').eq('author_id', uid),
    supabase.from('likes').select('*').eq('user_id', uid),
    supabase.from('post_reactions').select('*').eq('user_id', uid),
    supabase.from('bbs_reply_reactions').select('*').eq('user_id', uid),
    supabase.from('saves').select('*').eq('user_id', uid),
    supabase.from('bookmark_collections').select('*').eq('user_id', uid),
    supabase.from('tag_subscriptions').select('*').eq('user_id', uid),
    supabase.from('user_liked_tags').select('*').eq('user_id', uid),
    supabase.from('user_blocked_tags').select('*').eq('user_id', uid),
    supabase.from('user_stamps').select('*').eq('user_id', uid),
    supabase.from('saved_searches').select('*').eq('user_id', uid),
    supabase.from('notifications').select('*').eq('user_id', uid),
    supabase.from('concerns').select('*').eq('user_id', uid),
  ]);

  return {
    exported_at: new Date().toISOString(),
    user_id: uid,
    profile: (profile.data as Record<string, unknown> | null) ?? null,
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    bbs_threads: bbsThreads.data ?? [],
    bbs_replies: bbsReplies.data ?? [],
    likes: likes.data ?? [],
    post_reactions: postReactions.data ?? [],
    bbs_reply_reactions: bbsReplyReactions.data ?? [],
    saves: saves.data ?? [],
    bookmark_collections: bookmarkCollections.data ?? [],
    tag_subscriptions: tagSubscriptions.data ?? [],
    user_liked_tags: userLikedTags.data ?? [],
    user_blocked_tags: userBlockedTags.data ?? [],
    user_stamps: userStamps.data ?? [],
    saved_searches: savedSearches.data ?? [],
    notifications: notifications.data ?? [],
    concerns: concerns.data ?? [],
  };
}

// JSON ファイルとして保存 (Web は Blob ダウンロード, RN は Share)
export async function downloadUserDataAsJson(): Promise<{ ok: boolean; bytes: number }> {
  const data = await exportUserData();
  const json = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(json).length;

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Web: Blob → a[download]
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `geek-export-${data.user_id.slice(0, 8)}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true, bytes };
  }
  // RN (mobile): expo-sharing で共有
  try {
    // 動的 require: web バンドルにモバイル専用モジュールを含めない
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system') as typeof import('expo-file-system');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    const path = `${FS.cacheDirectory}geek-export-${Date.now()}.json`;
    await FS.writeAsStringAsync(path, json, { encoding: 'utf8' });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'データをエクスポート' });
    }
    return { ok: true, bytes };
  } catch (e) {
    console.warn('[exportUserData] mobile share failed:', e);
    return { ok: false, bytes };
  }
}

// アカウントを完全削除する。RPC `delete_account` 側で削除カスケード + auth.users 削除を行う想定
//   - フォールバックとして、RPC が存在しない/失敗した場合は明示的に各テーブルから本人レコードを削除する
//     (auth.users 自体はクライアントから消せないので、ローカルでサインアウトのみで終了する)
export async function deleteAccount(): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: '未ログインです' };
  const uid = user.id;

  // 1) サーバー側で完全削除を試みる (推奨経路)
  try {
    const { error } = await supabase.rpc('delete_account');
    if (!error) {
      try { await supabase.auth.signOut(); } catch {}
      return { ok: true };
    }
    // RPC が無い (PGRST202) / 権限なし → フォールバックへ
    console.warn('[deleteAccount] RPC failed, falling back:', error.message);
  } catch (e) {
    console.warn('[deleteAccount] RPC threw, falling back:', e);
  }

  // 2) フォールバック: クライアントから各テーブルを削除
  //    RLS の DELETE ポリシーが必要 (0015_account_deletion.sql で追加済)
  const tables: Array<{ table: string; col: string }> = [
    { table: 'likes', col: 'user_id' },
    { table: 'post_reactions', col: 'user_id' },
    { table: 'bbs_reply_reactions', col: 'user_id' },
    { table: 'saves', col: 'user_id' },
    { table: 'bookmark_collections', col: 'user_id' },
    { table: 'tag_subscriptions', col: 'user_id' },
    { table: 'user_liked_tags', col: 'user_id' },
    { table: 'user_blocked_tags', col: 'user_id' },
    { table: 'user_stamps', col: 'user_id' },
    { table: 'saved_searches', col: 'user_id' },
    { table: 'notifications', col: 'user_id' },
    { table: 'concerns', col: 'user_id' },
    { table: 'comments', col: 'author_id' },
    { table: 'bbs_replies', col: 'author_id' },
    { table: 'posts', col: 'author_id' },
    { table: 'bbs_threads', col: 'author_id' },
    { table: 'profiles', col: 'id' },
  ];
  const errors: string[] = [];
  for (const { table, col } of tables) {
    const { error } = await supabase.from(table).delete().eq(col, uid);
    if (error) errors.push(`${table}: ${error.message}`);
  }
  try { await supabase.auth.signOut(); } catch {}
  if (errors.length > 0) {
    return { ok: false, error: `一部のデータが残っています: ${errors.slice(0, 2).join('; ')}` };
  }
  return { ok: true };
}
