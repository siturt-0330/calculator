import { supabase } from '../supabase';

export type SavedSearch = {
  id: string;
  user_id: string;
  query: string;
  label: string | null;
  notify_new_results: boolean;
  last_seen_at: string;
  created_at: string;
};

export async function fetchSavedSearches(): Promise<SavedSearch[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from('saved_searches')
    .select('id, user_id, query, label, notify_new_results, last_seen_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as SavedSearch[];
}

export async function createSavedSearch(query: string, label?: string, notify = false): Promise<SavedSearch | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('saved_searches')
    .insert({ user_id: userId, query: query.trim(), label: label ?? null, notify_new_results: notify })
    .select('id, user_id, query, label, notify_new_results, last_seen_at, created_at')
    .single();
  if (error) {
    if (String(error.message).includes('duplicate')) throw new Error('既に保存済みのクエリです');
    throw error;
  }
  return data as SavedSearch;
}

export async function updateSavedSearch(id: string, updates: Partial<SavedSearch>): Promise<void> {
  const { error } = await supabase.from('saved_searches').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const { error } = await supabase.from('saved_searches').delete().eq('id', id);
  if (error) throw error;
}
