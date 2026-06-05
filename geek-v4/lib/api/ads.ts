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
import { withApiTimeout } from '../withApiTimeout';
import { swallow } from '../swallow';

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

// 広告ソースの抽象化 (migration 0119)。外部調査(GAM priority体系)に基づく:
//   sponsorship(直販/保証) > standard相当 > network(外部ネットワーク) > house(自社/フォールバック)
export type AdSourceType = 'house' | 'network' | 'sponsorship';

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
  // 0119 で追加。未適用環境では undefined (optional)。
  source_type?: AdSourceType;
  priority?: number;                  // 小さいほど優先 (House=16 が既定/フォールバック)
  target_traffic_sources?: string[];  // 空=全流入元、非空=一致時のみ配信
  network_code?: string | null;       // 外部ネットワーク識別 (admob 等)
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
// fetchTargetedAdsV2 — 流入元(traffic_source)別 + priority を考慮した配信 (0119)
// ----------------------------------------------------------------
// ads_select_active policy で全 authed user が active 広告を直読できるため、
// クライアント側でターゲティング/優先度を解決する (RPC 拡張不要)。
//   - 閲覧者の traffic_source は user_acquisition から引く(本人 select 可)
//   - ad.target_traffic_sources が空なら全員、非空なら一致時のみ
//   - priority 昇順(小さいほど優先) → タグ交差スコア降順
// ★ 0119 未適用(新列が無い)・RLS 等で失敗したら、既存 fetchTargetedAds(タグ RPC)に
//   自動フォールバックする。
export async function fetchTargetedAdsV2(
  interestTags: string[],
  excludeTags: string[] = [],
  limit = 3,
): Promise<Ad[]> {
  // 1) 閲覧者の流入元
  let trafficSource: string | null = null;
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (uid) {
      const { data } = await withApiTimeout(
        supabase
          .from('user_acquisition')
          .select('traffic_source')
          .eq('user_id', uid)
          .maybeSingle(),
        'ads.trafficSource',
        8000,
      );
      trafficSource = (data as { traffic_source?: string | null } | null)?.traffic_source ?? null;
    }
  } catch (e) {
    // 流入元が引けなくても配信は続行 (= 全員向けのみ)
    swallow('ads.trafficSource', e);
  }

  // 2) active 広告を直読 (新列込み)。列が無い/タイムアウト/RLS 等で失敗したら v1 にフォールバック。
  type Row = {
    id: string; advertiser_name: string; headline: string; body: string;
    image_url: string | null; click_url: string; cta_label: string;
    target_tags: string[] | null; exclude_tags: string[] | null;
    source_type: string | null; priority: number | null;
    target_traffic_sources: string[] | null;
    starts_at: string | null; ends_at: string | null;
  };
  let rows: Row[];
  try {
    const { data, error } = await withApiTimeout(
      supabase
        .from('ads')
        .select(
          'id, advertiser_name, headline, body, image_url, click_url, cta_label, target_tags, exclude_tags, source_type, priority, target_traffic_sources, starts_at, ends_at',
        )
        .eq('status', 'active'),
      'ads.fetchActiveV2',
      8000,
    );
    if (error || !data) throw error ?? new Error('no ads data');
    rows = data as Row[];
  } catch (e) {
    // priority/流入元ターゲティングが効かない時の切り分け用 (0119 未適用 or 失敗で v1 へ)
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[ads] fetchTargetedAdsV2 fell back to v1:', e instanceof Error ? e.message : String(e));
    }
    return fetchTargetedAds(interestTags, excludeTags, limit);
  }
  const now = Date.now();
  const interest = new Set(interestTags);
  const exclude = new Set(excludeTags);

  const scored = rows
    .filter((a) => {
      // 配信期間
      if (a.starts_at && new Date(a.starts_at).getTime() > now) return false;
      if (a.ends_at && new Date(a.ends_at).getTime() < now) return false;
      // 流入元ターゲティング: 空=全員 / 非空=trafficSource 一致時のみ
      const tts = a.target_traffic_sources ?? [];
      if (tts.length > 0 && (!trafficSource || !tts.includes(trafficSource))) return false;
      // 除外: 広告の exclude_tags ∩ 興味、呼び出し側 excludeTags ∩ 広告の target_tags
      if ((a.exclude_tags ?? []).some((t) => interest.has(t))) return false;
      if ((a.target_tags ?? []).some((t) => exclude.has(t))) return false;
      return true;
    })
    .map((a) => {
      const score = (a.target_tags ?? []).reduce((acc, t) => acc + (interest.has(t) ? 1 : 0), 0);
      return { a, score, priority: a.priority ?? 16 };
    })
    // priority 昇順(小=優先) → 同 priority はタグ交差スコア降順
    .sort((x, y) => x.priority - y.priority || y.score - x.score)
    .slice(0, Math.max(1, limit));

  return scored.map(({ a, score }) => ({
    id: a.id,
    advertiser_name: a.advertiser_name,
    headline: a.headline,
    body: a.body,
    image_url: a.image_url,
    click_url: a.click_url,
    cta_label: a.cta_label,
    target_tags: a.target_tags ?? [],
    match_score: score,
  }));
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
  } catch (e) {
    // 意図的に握りつぶす — 広告のロギング失敗で UX を止めてはいけない
    swallow('ads.logEvent', e);
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
  const { data, error } = await withApiTimeout(q, 'ads.fetchAll', 8000);
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
  // 0119 で追加 (optional)。undefined のフィールドは insert に送られないので、
  // 0119 未適用環境でも UI で設定しなければエラーにならない。
  source_type?: AdSourceType;
  priority?: number;
  target_traffic_sources?: string[];
  network_code?: string | null;
};

export async function createAd(input: CreateAdInput): Promise<AdminAd> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('ログインが必要です');
  const { data, error } = await withApiTimeout(
    supabase
      .from('ads')
      .insert({ ...input, created_by: user.id })
      .select('*')
      .single(),
    'ads.create',
    8000,
  );
  if (error) throw new Error(error.message || '広告の作成に失敗しました');
  return data as AdminAd;
}

export async function updateAd(id: string, patch: Partial<CreateAdInput>): Promise<AdminAd> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('ads')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single(),
    'ads.update',
    8000,
  );
  if (error) throw new Error(error.message || '広告の更新に失敗しました');
  return data as AdminAd;
}

export async function deleteAd(id: string): Promise<void> {
  const { error } = await withApiTimeout(
    supabase.from('ads').delete().eq('id', id),
    'ads.delete',
    8000,
  );
  if (error) throw new Error(error.message || '広告の削除に失敗しました');
}

// ----------------------------------------------------------------
// 個別広告の直近 7 日の impression/click 数を集計
// ----------------------------------------------------------------
export async function fetchAdStats(adId: string, days = 7): Promise<AdStats> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [imp, clk] = await Promise.all([
    withApiTimeout(
      supabase
        .from('ad_events')
        .select('id', { count: 'exact', head: true })
        .eq('ad_id', adId)
        .eq('event_type', 'impression')
        .gte('created_at', since),
      'ads.stats.impression',
      8000,
    ),
    withApiTimeout(
      supabase
        .from('ad_events')
        .select('id', { count: 'exact', head: true })
        .eq('ad_id', adId)
        .eq('event_type', 'click')
        .gte('created_at', since),
      'ads.stats.click',
      8000,
    ),
  ]);
  return {
    impressions: imp.count ?? 0,
    clicks: clk.count ?? 0,
  };
}
