// ============================================================
// communities/spots.ts — 聖地 (community_spots) API
// ============================================================
// 地図ベースのスポット (アニメの聖地巡礼想定)。
// - fetch / create / delete: メンバーのみ (RLS で担保)
// - toggleCertified: 公式コミュの official_admin だけ (RPC で server-side 検証)
// ============================================================
import { supabase } from '../../supabase';
import { sanitizeText } from '../../sanitize';
import { mapJoinError } from './_helpers';
import { UUID_RE, type CommunitySpot } from './types';

// 聖地一覧取得 (新しい順) — RLS で open/member だけが見える
export async function fetchCommunitySpots(community_id: string): Promise<CommunitySpot[]> {
  if (!UUID_RE.test(community_id)) return [];
  const { data, error } = await supabase
    .from('community_spots')
    .select('*')
    .eq('community_id', community_id)
    .order('created_at', { ascending: false })
    .limit(500); // DoS / OOM 防止: 1 コミュニティで 500 を超える聖地は viewport クエリ側で
  if (error) {
    console.warn('[communities] fetchCommunitySpots failed:', error.message);
    return [];
  }
  return (data ?? []) as CommunitySpot[];
}

// 聖地作成 (メンバーのみ — RLS で担保)
export async function createSpot(input: {
  community_id: string;
  name: string;
  description?: string;
  lat: number;
  lon: number;
  photo_url?: string;
}): Promise<{ data: CommunitySpot | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  // 名前 / 説明 sanitize (sanitizeText = trim/on..=削除しない緩い版)
  const safeName = sanitizeText(input.name, { maxLength: 80 }).trim();
  const safeDesc = sanitizeText(input.description ?? '', { maxLength: 500 });
  if (safeName.length < 1) return { data: null, error: '名前を入力してください' };

  // lat/lon の範囲チェック (DB の CHECK 制約も二重に守る)
  if (input.lat < -90 || input.lat > 90 || input.lon < -180 || input.lon > 180) {
    return { data: null, error: '緯度・経度が範囲外です' };
  }

  const { data, error } = await supabase
    .from('community_spots')
    .insert({
      community_id: input.community_id,
      name: safeName,
      description: safeDesc,
      lat: input.lat,
      lon: input.lon,
      photo_url: input.photo_url ?? null,
      created_by: user.id,
    })
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? '聖地登録に失敗しました' };
  return { data: data as CommunitySpot, error: null };
}

// 聖地削除 (作成者 or community owner — RLS で担保)
export async function deleteSpot(spot_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('community_spots').delete().eq('id', spot_id);
  if (error) return { error: error.message };
  return { error: null };
}

// 公認フラグの toggle (公式コミュニティの official_admin だけが操作可)
export async function toggleSpotCertified(spotId: string, certified: boolean): Promise<void> {
  const { error } = await supabase.rpc('toggle_spot_certified', {
    p_spot_id: spotId,
    p_certified: certified,
  });
  if (error) {
    // 監査指摘: 旧版は error.message の string match だけで脆い。
    // PostgreSQL の error code (PGRST 経由) も判定対象に。
    const msg = error.message || '';
    const code = (error as { code?: string }).code ?? '';
    if (msg.includes('NOT_OFFICIAL_ADMIN') || code === '42501') {
      throw new Error('公式管理者のみ操作できます');
    }
    if (msg.includes('SPOT_NOT_FOUND') || msg.includes('not found')) {
      throw new Error('聖地が見つかりません');
    }
    throw new Error(mapJoinError(msg) || '公認設定に失敗しました');
  }
}
