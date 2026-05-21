// ============================================================
// Tag-targeted ads (プライバシー保護: 個人追跡なし)
// ============================================================
// migration 0035 で定義された ads / ad_events を読み書きする API ラッパー。
//
// 設計上のキモ:
//   - 配信側はサーバーの fetch_targeted_ads RPC が
//     ユーザーの興味タグと広告の target_tags の交差数でランキングして返す。
//   - 広告主には「タグの集計値」しか渡らない。個人 id は ad_events に
//     ローカル集計のためだけに保存され、外部に出さない。
//   - event ログは fire-and-forget — UX を絶対に止めない。
// ============================================================
import { supabase } from '../supabase';

export type Ad = {
  id: string;
  advertiser_name: string;
  headline: string;
  body: string;
  image_url: string | null;
  click_url: string;
  cta_label: string;
  target_tags: string[];
  match_score: number;
};

export type AdStatus = 'draft' | 'active' | 'paused' | 'ended';

export type AdminAd = {
  id: string;
  advertiser_name: string;
  headline: string;
  body: string;
  image_url: string | null;
  click_url: string;
  cta_label: string;
  target_tags: string[];
  exclude_tags: string[];
  status: AdStatus;
  starts_at: string | null;
  ends_at: string | null;
  daily_budget_yen: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AdEventType = 'impression' | 'click' | 'dismiss';

export type AdStats = {
  impressions: number;
  clicks: number;
};

// ----------------------------------------------------------------
// フィード組み立て用 — 興味タグから配信候補を 1-N 件取得
// ----------------------------------------------------------------
export async function fetchTargetedAds(
  interestTags: string[],
  excludeTags: string[] = [],
  limit = 3,
): Promise<Ad[]> {
  const { data, error } = await supabase.rpc('fetch_targeted_ads', {
    p_interest_tags: interestTags,
    p_exclude_tags: excludeTags,
    p_limit: limit,
  });
  if (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[ads] fetchTargetedAds failed:', error.message);
    }
    return [];
  }
  return ((data ?? []) as Ad[]);
}

// ----------------------------------------------------------------
// event ログ — fire-and-forget (UX を絶対に止めない)
// ----------------------------------------------------------------
async function logAdEvent(
  adId: string,
  eventType: AdEventType,
  extra?: { feed_position?: number; matched_tags?: string[] },
): Promise<void> {
  try {
    const user = (await supabase.auth.getUser()).data.user;
    await supabase.from('ad_events').insert({
      ad_id: adId,
      event_type: eventType,
      user_id: user?.id ?? null,
      feed_position: extra?.feed_position ?? null,
      matched_tags: extra?.matched_tags ?? [],
    });
  } catch {
    // 意図的に握りつぶす — 広告のロギング失敗で UX を止めてはいけない
  }
}

export async function logAdImpression(
  adId: string,
  position: number,
  matchedTags: string[],
): Promise<void> {
  return logAdEvent(adId, 'impression', { feed_position: position, matched_tags: matchedTags });
}

export async function logAdClick(adId: string): Promise<void> {
  return logAdEvent(adId, 'click');
}

export async function logAdDismiss(adId: string): Promise<void> {
  return logAdEvent(adId, 'dismiss');
}

// ============================================================
// admin 用 API
// ============================================================

export async function fetchAllAds(status?: AdStatus): Promise<AdminAd[]> {
  let q = supabase.from('ads').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message || '広告の取得に失敗しました');
  return (data ?? []) as AdminAd[];
}

export type CreateAdInput = {
  advertiser_name: string;
  headline: string;
  body: string;
  image_url: string | null;
  click_url: string;
  cta_label: string;
  target_tags: string[];
  exclude_tags: string[];
  status: AdStatus;
  starts_at: string | null;
  ends_at: string | null;
  daily_budget_yen: number;
};

export async function createAd(input: CreateAdInput): Promise<AdminAd> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('ログインが必要です');
  const { data, error } = await supabase
    .from('ads')
    .insert({ ...input, created_by: user.id })
    .select('*')
    .single();
  if (error) throw new Error(error.message || '広告の作成に失敗しました');
  return data as AdminAd;
}

export async function updateAd(id: string, patch: Partial<CreateAdInput>): Promise<AdminAd> {
  const { data, error } = await supabase
    .from('ads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message || '広告の更新に失敗しました');
  return data as AdminAd;
}

export async function deleteAd(id: string): Promise<void> {
  const { error } = await supabase.from('ads').delete().eq('id', id);
  if (error) throw new Error(error.message || '広告の削除に失敗しました');
}

// ----------------------------------------------------------------
// 個別広告の直近 7 日の impression/click 数を集計
// ----------------------------------------------------------------
export async function fetchAdStats(adId: string, days = 7): Promise<AdStats> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [imp, clk] = await Promise.all([
    supabase
      .from('ad_events')
      .select('id', { count: 'exact', head: true })
      .eq('ad_id', adId)
      .eq('event_type', 'impression')
      .gte('created_at', since),
    supabase
      .from('ad_events')
      .select('id', { count: 'exact', head: true })
      .eq('ad_id', adId)
      .eq('event_type', 'click')
      .gte('created_at', since),
  ]);
  return {
    impressions: imp.count ?? 0,
    clicks: clk.count ?? 0,
  };
}
