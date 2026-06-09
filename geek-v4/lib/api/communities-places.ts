// ============================================================
// lib/api/communities-places.ts — 聖地 / イベント API
// ------------------------------------------------------------
// communities.ts から分割。地図ベースの聖地 (spots) とカレンダーイベントに
// 特化した関数群:
//   - fetchMyUpcomingEvents     : 参加コミュ全体の直近イベント横串
//   - fetchCommunitySpots       : 聖地一覧
//   - fetchSpotById             : 聖地 1 件取得
//   - createSpot / updateSpot / deleteSpot
//   - toggleSpotCertified       : 公認フラグ toggle (公式管理者のみ)
//   - fetchCommunityEvents      : イベント一覧
//   - createEvent / updateEvent / deleteEvent
//   - fetchEventsBySpot         : 1 聖地に紐付くイベント
//
// SpotCategory の re-export もここで行う。
// ============================================================

import { supabase } from '../supabase';
import { sanitizeText } from '../sanitize';
import { SELECTABLE_SPOT_CATEGORIES, type SpotCategory } from './spotCategory';
import type { Community } from './communities-core';

// SpotCategory 関連は此のモジュールから re-export する
export {
  SPOT_CATEGORY_META,
  SELECTABLE_SPOT_CATEGORIES,
} from './spotCategory';
export type { SpotCategory } from './spotCategory';

// 共通 UUID 形式チェック
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// 型定義
// ============================================================

// ============================================================
// 聖地 (community_spots) — 地図ベース・スポット
// ------------------------------------------------------------
// migration 0045 で category + photo_urls を追加 (wiki 編集解放含む)
// カテゴリ定義は lib/api/spotCategory.ts (RN チェーン非依存 pure module)
// ============================================================
export type CommunitySpot = {
  id: string;
  community_id: string;
  name: string;
  description: string;
  lat: number;
  lon: number;
  // migration 0045 で追加。旧 photo_url (単数) は後方互換のため残す。
  // 表示時は photo_urls.length > 0 ? photo_urls : (photo_url ? [photo_url] : [])
  category: SpotCategory;
  photo_urls: string[];
  photo_url: string | null;
  created_by: string;
  created_at: string;
  is_certified?: boolean;
};

// ============================================================
// カレンダー (community_events) — オフ会 / イベント
// ============================================================
export type CommunityEvent = {
  id: string;
  community_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  photo_url: string | null;
  created_by: string;
  created_at: string;
  // migration 0046 で追加。会場 spot との 1:N リンク (1 spot で複数イベント可)。
  // null の場合は location_text のみで運用 (既存イベント互換)。
  spot_id?: string | null;
};

// ============================================================
// 自分が参加している全コミュニティの直近イベントを横串で取得
// (マイページ集約カレンダー用 — opt-out はクライアント側で行う想定)
// ============================================================
// 返り値は starts_at 昇順。1 ユーザーで参加コミュ数 × 直近イベントを取るので
// 最大件数を絞る (limit 500 ≒ コミュ数 50 × 各 10 件相当)。
/**
 * 自分が参加している全コミュニティの直近イベントを昇順で返す。
 * マイページの集約カレンダー用。
 * @param opts.limit              最大件数 (default 200, max 500)
 * @param opts.excludeCommunityIds opt-out したいコミュニティ ID のリスト
 */
export async function fetchMyUpcomingEvents(opts: {
  limit?: number;
  /** 除外したい community_id (マイページ opt-out 用) */
  excludeCommunityIds?: string[];
} = {}): Promise<Array<CommunityEvent & { community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url'> }>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberRows, error: memErr } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', user.id);
  if (memErr || !memberRows || memberRows.length === 0) return [];

  const exclude = new Set(opts.excludeCommunityIds ?? []);
  const myCommunityIds = memberRows
    .map((r) => r.community_id as string)
    .filter((id) => !exclude.has(id));
  if (myCommunityIds.length === 0) return [];

  const limit = Math.max(1, Math.min(opts.limit ?? 200, 500));
  const { data, error } = await supabase
    .from('community_events')
    .select('*, communities!inner(id, name, icon_emoji, icon_color, icon_url)')
    .in('community_id', myCommunityIds)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.warn('[communities] fetchMyUpcomingEvents failed:', error.message);
    return [];
  }

  // Supabase embed の型 narrowing が one-to-many と判定するので unknown 経由
  type Raw = CommunityEvent & {
    communities?: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url'> | Array<Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url'>> | null;
  };
  const rows = (data ?? []) as unknown as Raw[];
  const out: Array<CommunityEvent & { community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url'> }> = [];
  for (const r of rows) {
    if (!r.communities) continue;
    const community = Array.isArray(r.communities) ? r.communities[0] : r.communities;
    if (!community) continue;
    // communities フィールドを外して community で正規化
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { communities: _communities, ...rest } = r;
    out.push({ ...(rest as CommunityEvent), community });
  }
  return out;
}

// ============================================================
// 聖地 (community_spots) API
// ============================================================

/**
 * 聖地一覧を新しい順で返す (RLS で open/member だけが見える)。
 * @param community_id  対象コミュニティ ID
 */
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

/**
 * 1 件の聖地を取得する (編集 / 詳細画面で使用)。
 * @param spot_id  スポット ID
 */
export async function fetchSpotById(spot_id: string): Promise<CommunitySpot | null> {
  if (!UUID_RE.test(spot_id)) return null;
  const { data, error } = await supabase
    .from('community_spots')
    .select('*')
    .eq('id', spot_id)
    .single();
  if (error) {
    console.warn('[communities] fetchSpotById failed:', error.message);
    return null;
  }
  return data as CommunitySpot;
}

// 聖地作成 (メンバーのみ — RLS で担保)
// migration 0045 で category 必須 + photo_urls (複数) 追加
/**
 * 聖地を作成する (メンバーのみ)。
 * @param input.photo_url  @deprecated 新規は photo_urls を使う
 */
export async function createSpot(input: {
  community_id: string;
  name: string;
  description?: string;
  lat: number;
  lon: number;
  category: SpotCategory;
  photo_urls?: string[];
  /** @deprecated 旧版互換。新規は photo_urls を使う */
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

  // category は allowlist 外なら fail-safe で 'other'
  const safeCategory: SpotCategory = SELECTABLE_SPOT_CATEGORIES.includes(input.category)
    ? input.category
    : 'other';

  // 写真は最大 4 枚 (DB CHECK 制約も二重に守る)
  const safePhotos = (input.photo_urls ?? []).slice(0, 4).filter((u) => !!u);

  const { data, error } = await supabase
    .from('community_spots')
    .insert({
      community_id: input.community_id,
      name: safeName,
      description: safeDesc,
      lat: input.lat,
      lon: input.lon,
      category: safeCategory,
      photo_urls: safePhotos,
      photo_url: input.photo_url ?? null,
      created_by: user.id,
    })
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? '聖地登録に失敗しました' };
  return { data: data as CommunitySpot, error: null };
}

// 聖地更新 (migration 0045 で community member 全員に編集権を開放: wiki 型)
/**
 * 聖地情報を更新する (wiki 型 — メンバー全員が編集可)。
 * @param spot_id  更新対象のスポット ID
 * @param patch    更新する列のみ含む部分オブジェクト
 */
export async function updateSpot(
  spot_id: string,
  patch: Partial<{
    name: string;
    description: string;
    lat: number;
    lon: number;
    category: SpotCategory;
    photo_urls: string[];
  }>,
): Promise<{ data: CommunitySpot | null; error: string | null }> {
  // ホワイトリスト化 — 想定外の column 書き換えを防ぐ
  const allowed: Partial<Pick<CommunitySpot, 'name' | 'description' | 'lat' | 'lon' | 'category' | 'photo_urls'>> = {};
  if (patch.name !== undefined) {
    const s = sanitizeText(patch.name, { maxLength: 80 }).trim();
    if (s.length < 1) return { data: null, error: '名前は 1 文字以上必要です' };
    allowed.name = s;
  }
  if (patch.description !== undefined) {
    allowed.description = sanitizeText(patch.description, { maxLength: 500 });
  }
  if (patch.lat !== undefined) {
    if (patch.lat < -90 || patch.lat > 90) return { data: null, error: '緯度が範囲外です' };
    allowed.lat = patch.lat;
  }
  if (patch.lon !== undefined) {
    if (patch.lon < -180 || patch.lon > 180) return { data: null, error: '経度が範囲外です' };
    allowed.lon = patch.lon;
  }
  if (patch.category !== undefined) {
    allowed.category = SELECTABLE_SPOT_CATEGORIES.includes(patch.category) ? patch.category : 'other';
  }
  if (patch.photo_urls !== undefined) {
    allowed.photo_urls = patch.photo_urls.slice(0, 4).filter((u) => !!u);
  }

  const { data, error } = await supabase
    .from('community_spots')
    .update(allowed)
    .eq('id', spot_id)
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? '聖地の更新に失敗しました' };
  return { data: data as CommunitySpot, error: null };
}

// 聖地削除 (migration 0045 で community member 全員に削除権を開放: wiki 型)
/**
 * 聖地を削除する (wiki 型 — メンバー全員が削除可)。
 */
export async function deleteSpot(spot_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('community_spots').delete().eq('id', spot_id);
  if (error) return { error: error.message };
  return { error: null };
}

// 公認フラグの toggle (公式コミュニティの official_admin だけが操作可)
/**
 * 聖地の公認フラグを切り替える (公式コミュニティの official_admin のみ操作可)。
 * @param spotId    操作対象のスポット ID
 * @param certified true にすると公認、false で解除
 * @throws 権限不足 / 聖地未存在 / その他エラー
 */
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
    // mapJoinError をインライン化 (import cycle 防止のため membership module には依存しない)
    throw new Error(msg || '公認設定に失敗しました');
  }
}

// ============================================================
// カレンダー (community_events) API
// ============================================================

/**
 * コミュニティのイベント一覧を取得する。
 * @param community_id   対象コミュニティ ID
 * @param opts.upcomingOnly  true にすると starts_at >= now() のみ返す
 */
export async function fetchCommunityEvents(
  community_id: string,
  opts: { upcomingOnly?: boolean } = {},
): Promise<CommunityEvent[]> {
  if (!UUID_RE.test(community_id)) return [];
  let query = supabase
    .from('community_events')
    .select('*')
    .eq('community_id', community_id)
    .order('starts_at', { ascending: true })
    .limit(500); // 1 コミュニティの直近イベント上限 (現実的には十分)

  if (opts.upcomingOnly) {
    query = query.gte('starts_at', new Date().toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[communities] fetchCommunityEvents failed:', error.message);
    return [];
  }
  return (data ?? []) as CommunityEvent[];
}

// イベント作成 (メンバーのみ — RLS で担保)
/**
 * イベントを作成する (メンバーのみ)。
 * @param input.spot_id  migration 0046 で追加。会場スポットとのリンク (任意)。
 */
export async function createEvent(input: {
  community_id: string;
  title: string;
  description?: string;
  starts_at: string;       // ISO 8601
  ends_at?: string;        // ISO 8601 — null 許容
  location_text?: string;
  photo_url?: string;
  // migration 0046: 会場 spot を指定 (任意)。指定時はサーバ側 trigger で
  // spot.community_id == event.community_id を検証 (SPOT_COMMUNITY_MISMATCH)。
  spot_id?: string | null;
}): Promise<{ data: CommunityEvent | null; error: string | null }> {
  if (!UUID_RE.test(input.community_id)) {
    return { data: null, error: '不正なコミュニティ ID です' };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };

  // sanitizeText = trim/on..=削除しない緩い版 (title だけ trim() で minLen 判定)
  const safeTitle = sanitizeText(input.title, { maxLength: 100 }).trim();
  const safeDesc = sanitizeText(input.description ?? '', { maxLength: 1000 });
  const safeLocation = input.location_text
    ? sanitizeText(input.location_text, { maxLength: 200 })
    : null;
  if (safeTitle.length < 1) return { data: null, error: 'タイトルを入力してください' };

  // ISO 8601 形式チェック (壊れた日付で 500 を防ぐ)
  const startsAt = new Date(input.starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    return { data: null, error: '開始日時が不正です' };
  }
  let endsAt: string | null = null;
  if (input.ends_at) {
    const e = new Date(input.ends_at);
    if (Number.isNaN(e.getTime())) return { data: null, error: '終了日時が不正です' };
    // 監査指摘: 旧版は `<` で「同時刻」を許容、フロント (event/create.tsx) は `>` を要求していて
    // 不一致だった。最小 1 分のスパンを要求して 0 分イベントも排除。
    if (e.getTime() <= startsAt.getTime()) {
      return { data: null, error: '終了日時は開始日時より後にしてください' };
    }
    endsAt = e.toISOString();
  }

  // spot_id は UUID チェックだけ、存在検証は trigger 側 (RLS と二重防御)
  const safeSpotId: string | null = input.spot_id && UUID_RE.test(input.spot_id) ? input.spot_id : null;

  const { data, error } = await supabase
    .from('community_events')
    .insert({
      community_id: input.community_id,
      title: safeTitle,
      description: safeDesc,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt,
      location_text: safeLocation,
      photo_url: input.photo_url ?? null,
      spot_id: safeSpotId,
      created_by: user.id,
    })
    .select()
    .single();
  if (error || !data) {
    const msg = error?.message ?? 'イベント作成に失敗しました';
    if (msg.includes('SPOT_COMMUNITY_MISMATCH')) {
      return { data: null, error: '指定した聖地が別コミュニティのものです' };
    }
    if (msg.includes('SPOT_NOT_FOUND')) {
      return { data: null, error: '指定した聖地が見つかりません' };
    }
    return { data: null, error: msg };
  }
  return { data: data as CommunityEvent, error: null };
}

// イベント更新 (作成者 or community owner — RLS で担保)
// migration 0046: spot_id の付け替え対応
/**
 * イベントを更新する (作成者 or community owner)。
 * @param event_id  更新対象のイベント ID
 * @param patch     更新する列のみ含む部分オブジェクト
 */
export async function updateEvent(
  event_id: string,
  patch: Partial<{
    title: string;
    description: string;
    starts_at: string;
    ends_at: string | null;
    location_text: string | null;
    photo_url: string | null;
    spot_id: string | null;
  }>,
): Promise<{ data: CommunityEvent | null; error: string | null }> {
  const allowed: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const s = sanitizeText(patch.title, { maxLength: 100 }).trim();
    if (s.length < 1) return { data: null, error: 'タイトルは 1 文字以上必要です' };
    allowed.title = s;
  }
  if (patch.description !== undefined) {
    allowed.description = sanitizeText(patch.description, { maxLength: 1000 });
  }
  if (patch.starts_at !== undefined) {
    const d = new Date(patch.starts_at);
    if (Number.isNaN(d.getTime())) return { data: null, error: '開始日時が不正です' };
    allowed.starts_at = d.toISOString();
  }
  if (patch.ends_at !== undefined) {
    if (patch.ends_at === null) {
      allowed.ends_at = null;
    } else {
      const d = new Date(patch.ends_at);
      if (Number.isNaN(d.getTime())) return { data: null, error: '終了日時が不正です' };
      allowed.ends_at = d.toISOString();
    }
  }
  if (patch.location_text !== undefined) {
    allowed.location_text = patch.location_text
      ? sanitizeText(patch.location_text, { maxLength: 200 })
      : null;
  }
  if (patch.photo_url !== undefined) allowed.photo_url = patch.photo_url;
  if (patch.spot_id !== undefined) {
    allowed.spot_id = patch.spot_id && UUID_RE.test(patch.spot_id) ? patch.spot_id : null;
  }

  const { data, error } = await supabase
    .from('community_events')
    .update(allowed)
    .eq('id', event_id)
    .select()
    .single();
  if (error || !data) {
    const msg = error?.message ?? 'イベント更新に失敗しました';
    if (msg.includes('SPOT_COMMUNITY_MISMATCH')) {
      return { data: null, error: '指定した聖地が別コミュニティのものです' };
    }
    return { data: null, error: msg };
  }
  return { data: data as CommunityEvent, error: null };
}

// イベント削除 (作成者 or community owner — RLS で担保)
/**
 * イベントを削除する (作成者 or community owner)。
 */
export async function deleteEvent(event_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('community_events').delete().eq('id', event_id);
  if (error) return { error: error.message };
  return { error: null };
}

// 1 spot に紐付く upcoming イベントを取得 (spot 詳細 / spot map で使う)
// migration 0046 で community_events.spot_id を追加
/**
 * 1 聖地に紐付く upcoming イベントを取得する。
 * @param spot_id            スポット ID
 * @param opts.upcomingOnly  false にすると過去も含める (default: true)
 * @param opts.limit         最大件数 (default 20, max 100)
 */
export async function fetchEventsBySpot(
  spot_id: string,
  opts: { upcomingOnly?: boolean; limit?: number } = {},
): Promise<CommunityEvent[]> {
  if (!UUID_RE.test(spot_id)) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  let query = supabase
    .from('community_events')
    .select('*')
    .eq('spot_id', spot_id)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (opts.upcomingOnly !== false) {
    query = query.gte('starts_at', new Date().toISOString());
  }
  const { data, error } = await query;
  if (error) {
    console.warn('[communities] fetchEventsBySpot failed:', error.message);
    return [];
  }
  return (data ?? []) as CommunityEvent[];
}
