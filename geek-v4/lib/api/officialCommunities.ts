import { supabase } from '../supabase';
import type { Community } from './communities';

export type OfficialFeature = 'qna' | 'calendar' | 'map';

// ----------------------------------------------------------------
// 自分が official_admin として管理している公式コミュニティ一覧
// ----------------------------------------------------------------
export async function fetchMyOfficialCommunities(): Promise<Community[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .eq('is_official', true)
    .eq('official_admin_user_id', user.id)
    .order('last_post_at', { ascending: false, nullsFirst: false })
    .limit(200); // 防御的上限 (admin/curated データ、現状少件数)
  if (error) {
    console.warn('[officialCommunities] fetchMyOfficialCommunities failed:', error.message);
    return [];
  }
  return (data ?? []) as Community[];
}

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'failed';
export type VerificationMethod = 'well-known' | 'meta-tag' | 'dns-txt';

export type OfficialApplication = {
  id: string;
  community_id: string;
  applicant_user_id: string;
  applicant_real_name: string;
  applicant_organization: string;
  applicant_email: string | null;
  applicant_url: string | null;
  purpose: string;
  requested_features: OfficialFeature[];
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string;
  created_at: string;
  verification_token?: string;
  verification_status?: VerificationStatus;
  verification_method?: VerificationMethod | null;
  verification_attempted_at?: string | null;
};

export type AdminPendingApp = {
  id: string;
  community_id: string;
  community_name: string;
  icon_emoji: string;
  icon_color: string;
  member_count: number;
  post_count: number;
  applicant_user_id: string;
  applicant_real_name: string;
  applicant_organization: string;
  applicant_email: string | null;
  applicant_url: string | null;
  purpose: string;
  requested_features: OfficialFeature[];
  created_at: string;
  verification_token?: string;
  verification_status?: VerificationStatus;
  verification_method?: VerificationMethod | null;
  verification_attempted_at?: string | null;
};

// ----------------------------------------------------------------
// 申請 (community owner only)
// ----------------------------------------------------------------
export async function applyForOfficialCommunity(args: {
  communityId: string;
  realName: string;
  organization: string;
  email?: string;
  url?: string;
  purpose: string;
  requestedFeatures: OfficialFeature[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('apply_for_official_community', {
    p_community_id: args.communityId,
    p_real_name: args.realName,
    p_organization: args.organization,
    p_email: args.email ?? null,
    p_url: args.url ?? null,
    p_purpose: args.purpose,
    p_requested_features: args.requestedFeatures,
  });
  if (error) {
    const msg = error.message || '';
    if (msg.includes('NOT_COMMUNITY_OWNER')) throw new Error('コミュニティのオーナーのみが申請できます');
    if (msg.includes('ALREADY_OFFICIAL')) throw new Error('既に公式コミュニティです');
    if (msg.includes('PENDING_APPLICATION_EXISTS')) throw new Error('既に審査待ちの申請があります');
    if (msg.includes('AUTH_REQUIRED')) throw new Error('ログインが必要です');
    throw new Error(msg || '申請に失敗しました');
  }
  return data as string;
}

// 自分のコミュニティの申請履歴を取得
export async function fetchMyApplications(communityId: string): Promise<OfficialApplication[]> {
  const { data, error } = await supabase
    .from('official_community_applications')
    .select('*')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
    .limit(200); // 防御的上限 (admin/curated データ、現状少件数)
  if (error) throw error;
  return (data ?? []) as OfficialApplication[];
}

// 単一の申請を取得 (RLS により本人 or admin のみ)
export async function fetchApplication(applicationId: string): Promise<OfficialApplication | null> {
  const { data, error } = await supabase
    .from('official_community_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw error;
  return (data as OfficialApplication) ?? null;
}

// verifyOfficialUrl は廃止 (2026-05):
// verify-official-url Edge Function ごと撤去、公式申請機能を廃止したため。
// Geek 公式 (migration 0033 で seed) のみが is_official=true を持つ。

// ----------------------------------------------------------------
// admin 用 — pending 一覧
// ----------------------------------------------------------------
export async function fetchPendingOfficialApps(): Promise<AdminPendingApp[]> {
  const { data, error } = await supabase
    .from('admin_pending_official_apps_v')
    .select('*')
    .limit(200); // 防御的上限 (admin/curated データ、現状少件数)
  if (error) throw error;
  return (data ?? []) as AdminPendingApp[];
}

export async function approveOfficialApplication(applicationId: string, notes = ''): Promise<void> {
  const { error } = await supabase.rpc('approve_official_community_application', {
    p_application_id: applicationId,
    p_notes: notes,
  });
  if (error) throw new Error(error.message || '承認に失敗しました');
}

export async function rejectOfficialApplication(applicationId: string, reason: string): Promise<void> {
  if (!reason || reason.trim().length < 5) {
    throw new Error('却下理由は5文字以上必要です');
  }
  const { error } = await supabase.rpc('reject_official_community_application', {
    p_application_id: applicationId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message || '却下に失敗しました');
}

// ----------------------------------------------------------------
// QnA documents (knowledge base)
// ----------------------------------------------------------------
export type QnaDocument = {
  id: string;
  community_id: string;
  title: string;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export async function fetchQnaDocuments(communityId: string): Promise<QnaDocument[]> {
  const { data, error } = await supabase
    .from('community_qna_documents')
    .select('*')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
    .limit(200); // 防御的上限 (admin/curated データ、現状少件数)
  if (error) throw error;
  return (data ?? []) as QnaDocument[];
}

export async function createQnaDocument(args: {
  communityId: string;
  title: string;
  content: string;
}): Promise<QnaDocument> {
  const { data, error } = await supabase
    .from('community_qna_documents')
    .insert({
      community_id: args.communityId,
      title: args.title,
      content: args.content,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as QnaDocument;
}

export async function deleteQnaDocument(id: string): Promise<void> {
  const { error } = await supabase.from('community_qna_documents').delete().eq('id', id);
  if (error) throw error;
}

// ----------------------------------------------------------------
// QnA questions
// ----------------------------------------------------------------
export type QnaQuestion = {
  id: string;
  community_id: string;
  question: string;
  answer: string | null;
  source_doc_ids: string[];
  asked_by: string;
  asked_at: string;
  answered_at: string | null;
  status: 'pending' | 'answered' | 'no_source' | 'error';
};

// NotebookLM 風: ナレッジドキュメントから関連箇所だけを引いて、
// 一致するものを抜粋して回答する。LLM を使う場合は edge function を経由するが、
// 現状はキーワード検索ベースで「該当ドキュメントの該当箇所」を answer に返す。
// (将来 OpenAI / Gemini を呼びたければ supabase/functions/qna_ask に置き換える)
export async function askQna(args: {
  communityId: string;
  question: string;
}): Promise<QnaQuestion> {
  // 1) 質問を保存
  const { data: qRow, error: insErr } = await supabase
    .from('community_qna_questions')
    .insert({
      community_id: args.communityId,
      question: args.question,
    })
    .select('*')
    .single();
  if (insErr) throw insErr;

  // 2) ナレッジ検索
  const { data: docs, error: searchErr } = await supabase.rpc('qna_search_documents', {
    p_community_id: args.communityId,
    p_query: args.question,
    p_limit: 3,
  });
  if (searchErr) throw searchErr;

  type Hit = { id: string; title: string; content: string; rank: number };
  const hits = (docs ?? []) as Hit[];

  let answer: string;
  let status: 'answered' | 'no_source';
  let sourceIds: string[];

  if (hits.length === 0) {
    // ソースから答えられない場合は NotebookLM 風に「分かりません」と返す
    answer = '申し訳ありません。このコミュニティに登録された情報からは回答できません。\n\n'
           + '管理者がナレッジを追加すると、その内容に基づいて回答できるようになります。';
    status = 'no_source';
    sourceIds = [];
  } else {
    // 答え = 最も関連するドキュメントから抜粋を作る
    // (LLM 化はあとで edge function に差し替え可能なように、構造化された出力にする)
    const parts: string[] = [];
    for (const h of hits) {
      const snippet = excerptAround(h.content, args.question, 280);
      parts.push(`【${h.title}】より:\n${snippet}`);
    }
    answer = parts.join('\n\n---\n\n');
    status = 'answered';
    sourceIds = hits.map((h) => h.id);
  }

  // 3) 回答を保存
  const { data: updated, error: upErr } = await supabase
    .from('community_qna_questions')
    .update({
      answer,
      source_doc_ids: sourceIds,
      answered_at: new Date().toISOString(),
      status,
    })
    .eq('id', qRow.id)
    .select('*')
    .single();
  if (upErr) throw upErr;
  return updated as QnaQuestion;
}

export async function fetchQnaHistory(communityId: string, limit = 30): Promise<QnaQuestion[]> {
  const { data, error } = await supabase
    .from('community_qna_questions')
    .select('*')
    .eq('community_id', communityId)
    .order('asked_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as QnaQuestion[];
}

// クエリ語を含む位置の前後を抜粋する小さなヘルパー
function excerptAround(content: string, query: string, span: number): string {
  if (!query) return content.slice(0, span);
  const q = query.trim().toLowerCase();
  const c = content.toLowerCase();
  // 一致語のうち最も早い位置を探す
  const tokens = q.split(/\s+/).filter(Boolean);
  let pos = -1;
  for (const t of tokens) {
    const i = c.indexOf(t);
    if (i >= 0 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos < 0) return content.slice(0, span);
  const start = Math.max(0, pos - Math.floor(span / 3));
  return (start > 0 ? '…' : '') + content.slice(start, start + span) + (start + span < content.length ? '…' : '');
}

// ----------------------------------------------------------------
// Calendar
// ----------------------------------------------------------------
export type CalendarEvent = {
  id: string;
  community_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  url: string | null;
  created_by: string;
  created_at: string;
};

export async function fetchCalendarEvents(communityId: string, opts?: { upcoming?: boolean }): Promise<CalendarEvent[]> {
  let q = supabase
    .from('community_calendar_events')
    .select('*')
    .eq('community_id', communityId)
    .order('starts_at', { ascending: true })
    .limit(200); // 防御的上限 (admin/curated データ、現状少件数)
  if (opts?.upcoming) {
    q = q.gte('starts_at', new Date().toISOString());
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

export async function createCalendarEvent(input: Omit<CalendarEvent, 'id' | 'created_by' | 'created_at'>): Promise<CalendarEvent> {
  const { data, error } = await supabase
    .from('community_calendar_events')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as CalendarEvent;
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const { error } = await supabase.from('community_calendar_events').delete().eq('id', id);
  if (error) throw error;
}

// ----------------------------------------------------------------
// Map locations
// ----------------------------------------------------------------
export type MapLocation = {
  id: string;
  community_id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  address: string;
  image_url: string | null;
  category: 'spot' | 'shop' | 'food' | 'lodging' | 'event' | 'other';
  created_by: string;
  created_at: string;
};

export async function fetchMapLocations(communityId: string): Promise<MapLocation[]> {
  const { data, error } = await supabase
    .from('community_map_locations')
    .select('*')
    .eq('community_id', communityId)
    .limit(200); // 防御的上限 (admin/curated データ、現状少件数)
  if (error) throw error;
  return (data ?? []) as MapLocation[];
}

export async function createMapLocation(input: Omit<MapLocation, 'id' | 'created_by' | 'created_at'>): Promise<MapLocation> {
  const { data, error } = await supabase
    .from('community_map_locations')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as MapLocation;
}

export async function deleteMapLocation(id: string): Promise<void> {
  const { error } = await supabase.from('community_map_locations').delete().eq('id', id);
  if (error) throw error;
}
