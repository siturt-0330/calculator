// ============================================================
// lib/api/adminFlags.ts — Admin Console「機能フラグ」画面の API
// ------------------------------------------------------------
// feature_flags の管理操作 (admin 専用)。
// 書き込みは migration 0148 の RLS (ff_admin_write using is_admin()) で守られる。
// 一般ユーザーが叩いても RLS で 0 行更新になるだけ (clientガードは admin/_layout)。
//
// フラグ変更は useUserChannel の realtime (.on feature_flags) 経由で
// 全クライアントの ['feature-flags'] cache が即 invalidate される =
// 「ブラウザでトグル → アプリ全端末に再デプロイなしで反映」(WordPress 的レバー)。
// ============================================================
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

export type AdminFeatureFlag = {
  name: string;
  description: string | null;
  enabled: boolean;
  percentage: number; // 0..100
  updated_at: string;
};

export async function fetchAdminFeatureFlags(): Promise<AdminFeatureFlag[]> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('feature_flags')
      .select('name, description, enabled, percentage, updated_at')
      .order('name', { ascending: true }),
    'adminFlags.list',
    8000,
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminFeatureFlag[];
}

export async function updateFeatureFlag(
  name: string,
  patch: { enabled?: boolean; percentage?: number; description?: string },
): Promise<void> {
  const { error } = await withApiTimeout(
    supabase.from('feature_flags').update(patch).eq('name', name),
    'adminFlags.update',
    8000,
  );
  if (error) throw new Error(error.message);
}

export async function createFeatureFlag(input: {
  name: string;
  description: string;
  enabled: boolean;
}): Promise<void> {
  // name は識別子なので snake_case の英数字に正規化 (DICT キーや useFeatureFlag('...') と揃える)
  const name = input.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  if (name.length < 3) throw new Error('フラグ名は英数字3文字以上にしてください');
  const { error } = await withApiTimeout(
    supabase.from('feature_flags').insert({
      name,
      description: input.description.trim() || null,
      enabled: input.enabled,
      percentage: 100,
    }),
    'adminFlags.create',
    8000,
  );
  if (error) {
    if (error.message.includes('duplicate')) throw new Error('同名のフラグが既にあります');
    throw new Error(error.message);
  }
}
