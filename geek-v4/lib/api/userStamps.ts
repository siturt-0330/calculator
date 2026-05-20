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

// 公開されている人気スタンプ + 自分の作ったスタンプ
export async function fetchUserStamps(): Promise<UserStamp[]> {
  const { data, error } = await supabase
    .from('user_stamps')
    .select('id, creator_id, text, category, use_count, is_public, created_at')
    .order('use_count', { ascending: false })
    .limit(100);
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
    if (String(error.message).includes('duplicate')) throw new Error('そのスタンプは既に作成済みです');
    throw error;
  }
  return data as UserStamp;
}

export async function deleteUserStamp(id: string): Promise<void> {
  await supabase.from('user_stamps').delete().eq('id', id);
}
