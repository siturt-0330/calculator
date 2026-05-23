// ============================================================
// communities/core.ts — コミュニティ自体の CRUD
// ============================================================
// fetch (自分の所属 / 個別取得) + 作成 / 更新 / アイコン upload。
// 「コミュニティそのもの」を作る・編集・参照する関数群。
// ============================================================
import { supabase } from '../../supabase';
import { sanitizeText } from '../../sanitize';
import { mapJoinError } from './_helpers';
import {
  UUID_RE,
  type Community,
  type CommunityWithMembership,
  type MemberRole,
  type Visibility,
} from './types';

// ============================================================
// 自分の所属コミュニティを取得 (TopBar 用)
// ============================================================
export async function fetchMyCommunities(): Promise<Community[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // community_members 経由で join — joined_at desc
  const { data, error } = await supabase
    .from('community_members')
    .select('community_id, communities!inner(*)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false });

  if (error) {
    console.warn('[communities] fetchMyCommunities failed:', error.message);
    return [];
  }
  // Supabase embed の型 narrowing が one-to-many と判定するので unknown 経由で正規化
  const rows = (data ?? []) as unknown as Array<{ community_id: string; communities: Community | Community[] | null }>;
  const out: Community[] = [];
  for (const r of rows) {
    if (!r.communities) continue;
    if (Array.isArray(r.communities)) {
      const first = r.communities[0];
      if (first) out.push(first);
    } else {
      out.push(r.communities);
    }
  }
  return out;
}

// ============================================================
// コミュニティ作成 (タグも同時に登録)
// ============================================================
export async function createCommunity(input: {
  name: string;
  description: string;
  icon_emoji: string;
  icon_color: string;
  icon_url?: string | null;
  visibility: Visibility;
  tags: string[];
}): Promise<{ data: Community | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'ログインしてください' };
  // セッションが古いと auth.uid() が PostgREST 側で null になる事故を防ぐ
  await supabase.auth.refreshSession().catch(() => {});

  // 名前 / 説明を sanitize (HTML / script / onerror= / javascript: / 制御文字を除去)
  // 監査修正: コミュ name/description は <Text> でしか表示しないため、
  // sanitizeContent (= trim / on..=削除 / 連続改行圧縮) は副作用が大きすぎる。
  // sanitizeText の "ゆるい" sanitizer で書式を保ったまま危険タグだけ除去。
  const safeName = sanitizeText(input.name, { maxLength: 40 });
  const safeDesc = sanitizeText(input.description, { maxLength: 500 });
  if (safeName.length < 2) {
    return { data: null, error: 'コミュニティ名は 2 文字以上にしてください' };
  }

  const { data, error } = await supabase
    .from('communities')
    .insert({
      name: safeName,
      description: safeDesc,
      icon_emoji: input.icon_emoji,
      icon_color: input.icon_color,
      icon_url: input.icon_url ?? null,
      visibility: input.visibility,
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !data) {
    const msg = error?.message ?? '';
    if (msg.includes('row-level security') || msg.includes('行レベル')) {
      return { data: null, error: 'ログイン状態が古くなっています。一度ログアウトして入り直すか、しばらく経ってから再試行してください。' };
    }
    return { data: null, error: msg || 'コミュニティ作成に失敗しました' };
  }

  // タグを登録 (失敗しても community 自体は出来ているのでログだけ)
  if (input.tags.length > 0) {
    const cleanTags = input.tags
      .map((t) => t.trim().replace(/^#/, ''))
      .filter((t) => t.length > 0 && t.length <= 40)
      .slice(0, 10);
    if (cleanTags.length > 0) {
      const rows = cleanTags.map((tag) => ({ community_id: data.id, tag }));
      const { error: tagErr } = await supabase.from('community_tags').insert(rows);
      if (tagErr) console.warn('[communities] tag insert failed:', tagErr.message);
    }
  }

  return { data, error: null };
}

// ============================================================
// コミュニティ更新 (owner / admin のみ - icon/name/desc/visibility)
// ============================================================
// 監査指摘: 旧実装は patch を直接 update に投げており、内部 column (member_count
// / created_by / official_*) も書き換え可能だった。RLS / trigger が後段で守るが
// defense-in-depth として API レイヤでもホワイトリスト化。
const COMMUNITY_UPDATE_ALLOWED = [
  'name', 'description', 'icon_emoji', 'icon_color', 'icon_url', 'visibility',
] as const;

export async function updateCommunity(
  id: string,
  patch: Partial<Pick<Community, 'name' | 'description' | 'icon_emoji' | 'icon_color' | 'icon_url' | 'visibility'>>,
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: '不正なコミュニティ ID です' };

  // ホワイトリスト経由でだけ patch を構築
  const safePatch: Record<string, unknown> = {};
  for (const key of COMMUNITY_UPDATE_ALLOWED) {
    if (key in patch && patch[key] !== undefined) {
      safePatch[key] = patch[key];
    }
  }
  if (Object.keys(safePatch).length === 0) {
    return { error: null }; // no-op
  }

  // name / description は sanitize
  if (typeof safePatch.name === 'string') {
    safePatch.name = sanitizeText(safePatch.name, { maxLength: 40 });
    if ((safePatch.name as string).length < 2) {
      return { error: 'コミュニティ名は 2 文字以上にしてください' };
    }
  }
  if (typeof safePatch.description === 'string') {
    safePatch.description = sanitizeText(safePatch.description, { maxLength: 500 });
  }
  // visibility は ENUM 値のみ
  if (typeof safePatch.visibility === 'string'
      && !['open', 'request', 'invite'].includes(safePatch.visibility as string)) {
    return { error: '不正な公開設定です' };
  }

  const { error } = await supabase.from('communities').update(safePatch).eq('id', id);
  if (error) return { error: mapJoinError(error.message) };
  return { error: null };
}

// ============================================================
// コミュニティ詳細を取得 (自分のメンバーシップ含む + タグ)
// ============================================================
export async function fetchCommunity(id: string): Promise<CommunityWithMembership | null> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: comm, error } = await supabase
    .from('communities')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !comm) return null;

  const [tagRes, membRes] = await Promise.all([
    supabase.from('community_tags').select('tag').eq('community_id', id),
    user
      ? supabase
          .from('community_members')
          .select('role')
          .eq('community_id', id)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tags = (tagRes.data ?? []).map((r) => r.tag);
  const role = (membRes.data as { role: MemberRole } | null)?.role ?? null;

  return {
    ...comm,
    tags,
    is_member: role !== null,
    role,
  };
}

// ============================================================
// コミュニティアイコン画像のアップロード
// path 規約: '<community_id>/<timestamp>.<ext>'
// (Storage RLS でこの community_id のメンバーだけ書き込めるよう制限してある)
// 仮の community_id (作成前) を渡したい場合は createCommunity 成功後にもう一度
// updateCommunity({ icon_url }) を呼ぶ必要がある — そのため tmp uploads は
// 自前の bucket folder 'pending/<user_id>/...' を使うパターンも検討余地あり。
// ============================================================
// body は Web では Blob、Native では FormData (file uri 含む) を受け付ける。
// 監査指摘 + 実機 NG 報告反映:
//   - 旧版 1: Blob 専用 → Native では Blob.slice/arrayBuffer が動かず失敗
//   - 旧版 2: Uint8Array → Supabase SDK が fetch(body: uint8array) を呼ぶが、
//             Android okhttp で確実に serialize されない → 失敗
//   - 新版  : Native は FormData with file uri (RN 標準の multipart 経路)
//             Supabase SDK は FormData を直接 multipart として送るので確実に動く
export async function uploadCommunityIcon(
  community_id: string,
  body: Blob | FormData | Uint8Array | ArrayBuffer,
  contentType = 'image/jpeg',
): Promise<{ url: string | null; error: string | null }> {
  // 防御: community_id を UUID 検証 (Storage RLS の foldername と整合)
  if (!UUID_RE.test(community_id)) {
    return { url: null, error: '不正なコミュニティ ID です' };
  }
  // 防御: contentType を allowed mime に絞る (path traversal / 不正拡張子防止)
  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const safeContentType = ALLOWED.has(contentType) ? contentType : 'image/jpeg';
  const ext = safeContentType.split('/')[1] ?? 'jpg';
  const path = `${community_id}/${Date.now()}.${ext}`;

  // Supabase SDK 内部: FormData → そのまま multipart 送信 (cacheControl 追加)
  //                   Blob     → FormData にラップして multipart 送信
  //                   その他   → body そのまま + content-type header
  try {
    const { error: upErr } = await supabase.storage.from('community-icons').upload(
      path,
      // SDK の型シグネチャは Blob | File | FormData | ArrayBuffer | ArrayBufferView |
      // NodeJS.ReadableStream | ReadableStream | URLSearchParams | string の union。
      // FormData / Blob どちらも受け付けるが、TS が複雑になるので unknown 経由でキャスト。
      body as unknown as Blob,
      {
        contentType: safeContentType,
        upsert: true,
        cacheControl: '3600',
      },
    );
    if (upErr) {
      // 詳細を返してデバッグを容易に
      console.warn('[uploadCommunityIcon] storage upload failed:', upErr);
      return { url: null, error: `アップロード失敗: ${upErr.message}` };
    }
  } catch (e) {
    // ネットワークエラー等
    console.warn('[uploadCommunityIcon] threw:', e);
    return { url: null, error: `アップロード中にエラーが発生しました: ${e instanceof Error ? e.message : String(e)}` };
  }

  const { data: pub } = supabase.storage.from('community-icons').getPublicUrl(path);
  return { url: pub.publicUrl, error: null };
}
