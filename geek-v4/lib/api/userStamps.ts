import { supabase } from '../supabase';

export type UserStamp = {
  id: string;
  creator_id: string;
  text: string;
  category: string;
  use_count: number;
  is_public: boolean;
  created_at: string;
};

// PostgreSQL の error code を明示判定するための定数。
// 文字列 message へのキーワード matching は locale / pg バージョン依存で fragile。
const PG_UNIQUE_VIOLATION = '23505';
const PG_RLS_VIOLATION = '42501';

// 公開されている人気スタンプ + 自分の作ったスタンプ。
// RLS は同等条件で filter してくれるが、API レイヤーでも explicit に絞る
// (defense-in-depth: RLS policy が将来変わっても picker に他人の非公開が漏れない)。
export async function fetchUserStamps(): Promise<UserStamp[]> {
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  let q = supabase
    .from('user_stamps')
    .select('id, creator_id, text, category, use_count, is_public, created_at')
    .order('use_count', { ascending: false })
    .limit(100);
  q = userId
    ? q.or(`is_public.eq.true,creator_id.eq.${userId}`)
    : q.eq('is_public', true);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as UserStamp[];
}

export async function createUserStamp(text: string, category = 'カスタム', isPublic = true): Promise<UserStamp | null> {
  const t = text.trim();
  if (!t || t.length > 40) throw new Error('1-40文字で入力してください');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です');
  const { data, error } = await supabase
    .from('user_stamps')
    .insert({ creator_id: user.id, text: t, category, is_public: isPublic })
    .select('id, creator_id, text, category, use_count, is_public, created_at')
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) throw new Error('そのスタンプは既に作成済みです');
    if (error.code === PG_RLS_VIOLATION) throw new Error('スタンプを作成する権限がありません');
    throw new Error(error.message || 'スタンプの作成に失敗しました');
  }
  return data as UserStamp;
}

export async function deleteUserStamp(id: string): Promise<void> {
  const { error } = await supabase.from('user_stamps').delete().eq('id', id);
  if (error) {
    if (error.code === PG_RLS_VIOLATION) throw new Error('このスタンプを削除する権限がありません');
    throw new Error(error.message || 'スタンプの削除に失敗しました');
  }
}
