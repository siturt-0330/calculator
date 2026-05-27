// ============================================================
// lib/api/support.ts — Modmail (運営問い合わせ) クエリ層
// ============================================================
// user ↔ admin の双方向問い合わせスレッド + メッセージ管理。
// migration 0065 と対応。
//
// 関数:
//   - listMyThreads()              user 用一覧 (自分のスレッド)
//   - listAdminThreads({ filter }) admin 用一覧 (全スレッド)
//   - fetchThread(id)              スレッド本体
//   - fetchMessages(threadId)      スレッド内メッセージ (asc)
//   - createThread(input)          新規スレッド作成 + 初期メッセージ
//   - sendMessage(threadId, body)  メッセージ投稿
//   - markRead(threadId, asAdmin)  unread_count 0 リセット
//   - archiveThread(threadId)      state='archived' に
//   - reopenThread(threadId)       state='in_progress' に
// ============================================================
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

export type SupportThreadState = 'new' | 'in_progress' | 'archived';

export type SupportThreadCategory =
  | 'account_appeal'
  | 'rule_question'
  | 'community_question'
  | 'bug_report'
  | 'feature_request'
  | 'other';

export type SupportThread = {
  id: string;
  user_id: string;
  subject: string;
  category: SupportThreadCategory;
  state: SupportThreadState;
  related_post_id: string | null;
  message_count: number;
  last_message_at: string;
  unread_count_for_user: number;
  unread_count_for_admin: number;
  created_at: string;
};

export type SupportThreadWithNickname = SupportThread & {
  nickname: string | null;
};

export type SupportMessage = {
  id: string;
  thread_id: string;
  author_id: string;
  is_admin_reply: boolean;
  content: string;
  created_at: string;
};

// カテゴリ表示用メタ (UI 側で色 / label をひく)
export const CATEGORY_META: Record<
  SupportThreadCategory,
  { label: string; description: string; emoji: string }
> = {
  account_appeal: { label: 'BAN 異議申立', description: '凍結や警告への異議', emoji: '⚖️' },
  rule_question: { label: 'ルール質問', description: '禁止事項やガイドラインの確認', emoji: '📖' },
  community_question: { label: 'コミュ運営', description: '公式コミュニティ運営の質問', emoji: '🏛️' },
  bug_report: { label: 'バグ報告', description: 'アプリの不具合', emoji: '🐛' },
  feature_request: { label: '機能要望', description: '改善や追加リクエスト', emoji: '✨' },
  other: { label: 'その他', description: 'その他のお問い合わせ', emoji: '💬' },
};

export const STATE_META: Record<
  SupportThreadState,
  { label: string; color: 'amber' | 'accent' | 'text3' }
> = {
  new: { label: '未対応', color: 'amber' },
  in_progress: { label: '対応中', color: 'accent' },
  archived: { label: '解決済', color: 'text3' },
};

const THREAD_COLS =
  'id, user_id, subject, category, state, related_post_id, message_count, last_message_at, unread_count_for_user, unread_count_for_admin, created_at';

// ============================================================
// user 用一覧 — 自分の threads
// ============================================================
export async function listMyThreads(): Promise<SupportThread[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await withApiTimeout(
    supabase
      .from('support_threads')
      .select(THREAD_COLS)
      .eq('user_id', user.id)
      .order('last_message_at', { ascending: false })
      .limit(100),
    'support.listMyThreads',
    8000,
  );
  if (error) {
    console.warn('[support] listMyThreads failed:', error.message);
    throw error;
  }
  return (data ?? []) as SupportThread[];
}

// ============================================================
// admin 用一覧 — 全 threads + author nickname
// ============================================================
// state filter (all / new / in_progress / archived) と category filter を受け取り、
// admin 画面で並べる。
//
// sort 規則 (Reddit 仕様):
//   1) state='new' を上に
//   2) unread_count_for_admin の多い順
//   3) last_message_at desc
// → server-side で 3 軸 sort できないので、まず state asc / unread desc /
//    last_message_at desc を ORDER 化、追加で client 側で state='new' を先頭に押し上げる。
export async function listAdminThreads(filter?: {
  state?: SupportThreadState | 'all';
  category?: SupportThreadCategory | 'all';
}): Promise<SupportThreadWithNickname[]> {
  // 1st try: profile join で nickname も取る
  const buildQuery = (cols: string) => {
    let q = supabase
      .from('support_threads')
      .select(cols)
      .order('state', { ascending: true }) // 'archived' > 'in_progress' > 'new' (alphabetic = a/i/n)
      .order('unread_count_for_admin', { ascending: false })
      .order('last_message_at', { ascending: false })
      .limit(200);
    if (filter?.state && filter.state !== 'all') q = q.eq('state', filter.state);
    if (filter?.category && filter.category !== 'all') q = q.eq('category', filter.category);
    return q;
  };
  let res = await withApiTimeout(
    buildQuery(`${THREAD_COLS}, profiles!support_threads_user_id_fkey(nickname)`),
    'support.listAdminThreads',
    8000,
  );
  if (res.error) {
    console.warn('[support] listAdminThreads (nickname join) failed:', res.error.message);
    res = await withApiTimeout(buildQuery(THREAD_COLS), 'support.listAdminThreads.fallback', 8000);
  }
  if (res.error) throw res.error;
  const rows = (res.data ?? []) as unknown as Record<string, unknown>[];
  const mapped = rows.map((r) => {
    const p = r.profiles as { nickname?: string } | { nickname?: string }[] | null;
    const nickname = Array.isArray(p) ? p[0]?.nickname : p?.nickname;
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      subject: r.subject as string,
      category: r.category as SupportThreadCategory,
      state: r.state as SupportThreadState,
      related_post_id: (r.related_post_id as string) ?? null,
      message_count: (r.message_count as number) ?? 0,
      last_message_at: r.last_message_at as string,
      unread_count_for_user: (r.unread_count_for_user as number) ?? 0,
      unread_count_for_admin: (r.unread_count_for_admin as number) ?? 0,
      created_at: r.created_at as string,
      nickname: nickname ?? null,
    } satisfies SupportThreadWithNickname;
  });
  // state='new' を最上位へ押し上げ (admin の見落としを防ぐ)
  mapped.sort((a, b) => {
    if (a.state === 'new' && b.state !== 'new') return -1;
    if (a.state !== 'new' && b.state === 'new') return 1;
    return 0;
  });
  return mapped;
}

// ============================================================
// 単一スレッド取得
// ============================================================
export async function fetchThread(id: string): Promise<SupportThread | null> {
  if (!id) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) return null;
  const { data, error } = await withApiTimeout(
    supabase.from('support_threads').select(THREAD_COLS).eq('id', id).maybeSingle(),
    'support.fetchThread',
    8000,
  );
  if (error) {
    console.warn('[support] fetchThread failed:', error.message);
    throw error;
  }
  return (data ?? null) as SupportThread | null;
}

// ============================================================
// スレッド内メッセージ一覧 (asc)
// ============================================================
export async function fetchMessages(threadId: string): Promise<SupportMessage[]> {
  if (!threadId) return [];
  const { data, error } = await withApiTimeout(
    supabase
      .from('support_messages')
      .select('id, thread_id, author_id, is_admin_reply, content, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(500),
    'support.fetchMessages',
    8000,
  );
  if (error) {
    console.warn('[support] fetchMessages failed:', error.message);
    throw error;
  }
  return (data ?? []) as SupportMessage[];
}

// ============================================================
// 新規スレッド作成 + 初期メッセージ
// ============================================================
// flow:
//   1. support_threads に row 作成
//   2. support_messages に最初のメッセージ (is_admin_reply=false) 作成
//   3. trigger trg_support_thread_stats が message_count=1 / last_message_at /
//      unread_count_for_admin=1 を自動更新
// 注: 1 と 2 の間で失敗すると orphan thread が残るが、user 自身が後で
//     見える + admin にも見える + delete 可能なので最悪は許容する。
//     transactional にしたい場合は将来 RPC 化を検討。
export async function createThread(input: {
  subject: string;
  category: SupportThreadCategory;
  initialMessage: string;
  relatedPostId?: string | null;
}): Promise<{ thread: SupportThread; firstMessage: SupportMessage }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');

  const subject = input.subject.trim().slice(0, 100);
  const message = input.initialMessage.trim().slice(0, 2000);
  if (!subject) throw new Error('件名を入力してください');
  if (!message) throw new Error('本文を入力してください');

  // 1) thread
  const { data: threadRow, error: threadErr } = await withApiTimeout(
    supabase
      .from('support_threads')
      .insert({
        user_id: user.id,
        subject,
        category: input.category,
        related_post_id: input.relatedPostId ?? null,
        // 初期: message_count=0 / unread_count_for_admin=0 で入れる
        //  → 1 件目の trigger insert で +1 されて自然に 1 になる
        message_count: 0,
        unread_count_for_admin: 0,
      })
      .select(THREAD_COLS)
      .single(),
    'support.createThread.insertThread',
    8000,
  );
  if (threadErr || !threadRow) {
    console.warn('[support] createThread insert failed:', threadErr?.message);
    throw threadErr ?? new Error('スレッドの作成に失敗しました');
  }
  const thread = threadRow as SupportThread;

  // 2) initial message
  const { data: msgRow, error: msgErr } = await withApiTimeout(
    supabase
      .from('support_messages')
      .insert({
        thread_id: thread.id,
        author_id: user.id,
        is_admin_reply: false,
        content: message,
      })
      .select('id, thread_id, author_id, is_admin_reply, content, created_at')
      .single(),
    'support.createThread.insertMessage',
    8000,
  );
  if (msgErr || !msgRow) {
    console.warn('[support] createThread initial message failed:', msgErr?.message);
    throw msgErr ?? new Error('初回メッセージの保存に失敗しました');
  }
  return { thread, firstMessage: msgRow as SupportMessage };
}

// ============================================================
// メッセージ投稿
// ============================================================
// asAdmin=true で is_admin_reply=true で insert。
// 呼び出し側 (admin 画面 / user 画面) で適切な flag を渡す。
export async function sendMessage(
  threadId: string,
  content: string,
  opts?: { asAdmin?: boolean },
): Promise<SupportMessage> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');

  const body = content.trim().slice(0, 2000);
  if (!body) throw new Error('本文を入力してください');

  const { data, error } = await withApiTimeout(
    supabase
      .from('support_messages')
      .insert({
        thread_id: threadId,
        author_id: user.id,
        is_admin_reply: opts?.asAdmin ?? false,
        content: body,
      })
      .select('id, thread_id, author_id, is_admin_reply, content, created_at')
      .single(),
    'support.sendMessage',
    8000,
  );
  if (error || !data) {
    console.warn('[support] sendMessage failed:', error?.message);
    throw error ?? new Error('メッセージの送信に失敗しました');
  }
  return data as SupportMessage;
}

// ============================================================
// 既読化 (counter リセット)
// ============================================================
// asAdmin=true なら unread_count_for_admin=0 / false なら unread_count_for_user=0。
// RLS により本人 or admin だけが更新可能。
export async function markRead(threadId: string, asAdmin: boolean): Promise<void> {
  const payload = asAdmin
    ? { unread_count_for_admin: 0 }
    : { unread_count_for_user: 0 };
  const { error } = await withApiTimeout(
    supabase.from('support_threads').update(payload).eq('id', threadId),
    'support.markRead',
    8000,
  );
  if (error) {
    console.warn('[support] markRead failed:', error.message);
    // 既読化失敗は致命的ではない (UX 上 badge が残るだけ) → caller には伝えない
    // ※ ただし呼び出し側で何度も叩く可能性があるので silent fail に
  }
}

// ============================================================
// archive / reopen (admin 専用)
// ============================================================
export async function archiveThread(threadId: string): Promise<void> {
  const { error } = await withApiTimeout(
    supabase
      .from('support_threads')
      .update({ state: 'archived' as SupportThreadState })
      .eq('id', threadId),
    'support.archiveThread',
    8000,
  );
  if (error) throw error;
}

export async function reopenThread(threadId: string): Promise<void> {
  const { error } = await withApiTimeout(
    supabase
      .from('support_threads')
      .update({ state: 'in_progress' as SupportThreadState })
      .eq('id', threadId),
    'support.reopenThread',
    8000,
  );
  if (error) throw error;
}
