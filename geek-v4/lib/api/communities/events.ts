// ============================================================
// communities/events.ts — カレンダー (community_events) API
// ============================================================
// オフ会 / イベントの作成・削除・一覧。
// upcomingOnly フラグで「これから」のイベントだけ取得。
// ============================================================
import { supabase } from '../../supabase';
import { sanitizeText } from '../../sanitize';
import { UUID_RE, type CommunityEvent } from './types';

// イベント一覧取得 — upcomingOnly=true で starts_at >= now() のみ返す
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
export async function createEvent(input: {
  community_id: string;
  title: string;
  description?: string;
  starts_at: string;       // ISO 8601
  ends_at?: string;        // ISO 8601 — null 許容
  location_text?: string;
  photo_url?: string;
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
      created_by: user.id,
    })
    .select()
    .single();
  if (error || !data) return { data: null, error: error?.message ?? 'イベント作成に失敗しました' };
  return { data: data as CommunityEvent, error: null };
}

// イベント削除 (作成者 or community owner — RLS で担保)
export async function deleteEvent(event_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('community_events').delete().eq('id', event_id);
  if (error) return { error: error.message };
  return { error: null };
}
