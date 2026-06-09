// ============================================================
// lib/api/communities-core.ts — コミュニティ 型定義 + コア CRUD API
// ------------------------------------------------------------
// communities.ts から分割。他のモジュールが依存する型と基本 CRUD:
//   型: Visibility, MemberRole, CommunityGenre, Community,
//       CommunityWithMembership, CommunityPost, CommunityPostWithCommunity
//   UUID_RE 定数 (上部に移動 — 旧 communities.ts は 571 行目で temporal dead zone 違反)
//   CRUD: createCommunity, updateCommunity, replaceCommunityTags, fetchCommunity,
//         uploadCommunityIcon, subscribeToMyCommunityChanges (deprecated no-op)
// ============================================================

import { supabase } from '../supabase';
import { sanitizeText } from '../sanitize';
import { withApiTimeout } from '../withApiTimeout';

// ============================================================
// 共通定数 (モジュール先頭に配置 — temporal dead zone を防ぐ)
// ============================================================

/** UUID v4 形式チェック用正規表現 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// 型定義
// ============================================================

export type Visibility = 'open' | 'request' | 'invite';
export type MemberRole = 'owner' | 'admin' | 'member';

// ============================================================
// コミュニティ ジャンル (migration 0044) — 機能撤去済み
// ------------------------------------------------------------
// 当初はジャンルごとに詳細画面のタブ構成を切替える設計だったが、
// ジャンル別タブ / 作成時のジャンル選択 UI は撤去 (ユーザー要望)。
// DB column communities.genre は migration 0044 で追加済み・
// default 'legacy' で残置 (既存データ保持のため drop はしない)。
// 型は Community.genre が DB を反映するためだけに保持する。
// ============================================================
export type CommunityGenre =
  | 'oshi'
  | 'creative'
  | 'experience'
  | 'discussion'
  | 'legacy';

export type Community = {
  id: string;
  name: string;
  description: string;
  icon_emoji: string;
  icon_color: string;
  icon_url: string | null;
  visibility: Visibility;
  // migration 0044 で追加。default 'legacy' で既存 community も値あり。
  // 表記ゆれで undefined が来ても困らないよう、UI 側でも || 'legacy' で fallback。
  genre: CommunityGenre;
  member_count: number;
  post_count: number;
  last_post_at: string | null;
  created_by: string;
  created_at: string;
  // 公式コミュニティ (migration 0032)
  is_official?: boolean;
  official_admin_user_id?: string | null;
  official_admin_display_name?: string | null;
  official_organization?: string | null;
  official_features?: Array<'qna' | 'calendar' | 'map'>;
};

export type CommunityWithMembership = Community & {
  is_member: boolean;
  role: MemberRole | null;
  /** request 制コミュで、自分の保留中(pending)申請があるか (fetchCommunity が判定) */
  has_pending_request?: boolean;
  tags: string[];
};

export type CommunityPost = {
  id: string;
  community_id: string;
  author_id: string;
  body: string;
  image_url: string | null;
  created_at: string;
};

export type CommunityPostWithCommunity = CommunityPost & {
  community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url' | 'is_official'>;
  author_nickname?: string;
  // 公式コミュ管理者投稿の de-anonymize 用 (匿名ニックネームではなく実名 · 所属を表示)
  official_author?: { name: string; organization: string } | null;
};

// ============================================================
// updateCommunity で許可するカラム一覧 (ホワイトリスト)
// ============================================================
// 監査指摘: 旧実装は patch を直接 update に投げており、内部 column (member_count
// / created_by / official_*) も書き換え可能だった。RLS / trigger が後段で守るが
// defense-in-depth として API レイヤでもホワイトリスト化。
const COMMUNITY_UPDATE_ALLOWED = [
  'name', 'description', 'icon_emoji', 'icon_color', 'icon_url', 'visibility',
] as const;

// ============================================================
// コミュニティ作成 (タグも同時に登録)
// ============================================================
/**
 * コミュニティを新規作成し、タグも同時に登録する。
 * セッションが古いと auth.uid() が PostgREST 側で null になる事故を防ぐため
 * 先に refreshSession を呼ぶ。
 * @returns data: 作成された Community、error: エラーメッセージ (null = 成功)
 */
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
  // genre は insert payload に含めない (ジャンル機能撤去)。DB column は
  // default 'legacy' なので未指定でも NOT NULL 制約を満たす。
  const basePayload = {
    name: safeName,
    description: safeDesc,
    icon_emoji: input.icon_emoji,
    icon_color: input.icon_color,
    icon_url: input.icon_url ?? null,
    visibility: input.visibility,
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from('communities')
    .insert(basePayload)
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
/**
 * コミュニティの基本情報を更新する (owner / admin のみ)。
 * ホワイトリスト化により内部カラム (member_count / official_* 等) の書き換えを防ぐ。
 * @param id    更新対象のコミュニティ ID
 * @param patch 更新する列のみ含む部分オブジェクト
 */
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
  if (error) return { error: error.message };
  return { error: null };
}

// ============================================================
// コミュニティタグの一括更新 (wiki edit 用)
// ------------------------------------------------------------
// 既存タグを全削除 → 新タグを insert する単純実装。
// migration 0048 で member 全員が community_tags の INSERT/DELETE 可 (元から)。
//
// 同時編集時の race:
//   - 2 人が同時に変更 → 後勝ち (最後の insert が残る)
//   - Wiki 思想なので許容。将来 audit log + revert で対応。
// ============================================================
/**
 * コミュニティタグを全件置き換える (wiki 型 — メンバー全員が編集可)。
 * DELETE → INSERT の 2 ステップ。INSERT 失敗時は空タグ状態になる点に注意。
 * @param community_id  対象コミュニティ ID
 * @param tags          新しいタグ一覧 (最大 10 件、各最大 40 文字)
 */
export async function replaceCommunityTags(
  community_id: string,
  tags: string[],
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(community_id)) return { error: '不正なコミュニティ ID です' };

  // sanitize (createCommunity と同じルール)
  const cleanTags = tags
    .map((t) => t.trim().replace(/^#/, ''))
    .filter((t) => t.length > 0 && t.length <= 40)
    .slice(0, 10);
  // 重複除外 (PK は (community_id, tag) なので insert で conflict する前に dedupe)
  const uniqueTags = Array.from(new Set(cleanTags));

  // 既存を全削除
  const { error: delErr } = await supabase
    .from('community_tags')
    .delete()
    .eq('community_id', community_id);
  if (delErr) return { error: delErr.message };

  if (uniqueTags.length === 0) return { error: null };

  // 新規 insert
  const rows = uniqueTags.map((tag) => ({ community_id, tag }));
  const { error: insErr } = await supabase.from('community_tags').insert(rows);
  if (insErr) return { error: insErr.message };
  return { error: null };
}

// ============================================================
// コミュニティ詳細を取得 (自分のメンバーシップ含む + タグ)
// ============================================================
/**
 * コミュニティの詳細をメンバーシップ・タグ付きで取得する。
 * 未ログインの場合も公開情報は返す (is_member = false)。
 * @param id  コミュニティ ID
 */
export async function fetchCommunity(id: string): Promise<CommunityWithMembership | null> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: comm, error } = await supabase
    .from('communities')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !comm) return null;

  const [tagRes, membRes, reqRes] = await Promise.all([
    supabase.from('community_tags').select('tag').eq('community_id', id),
    user
      ? supabase
          .from('community_members')
          .select('role')
          .eq('community_id', id)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // request 制コミュのときだけ、自分の保留中(pending)申請を確認する。
    // RLS (0017) で本人の join_request 行は読めるので、これで「申請中」を反映できる。
    // (旧: members しか見ておらず、申請してもボタンが「申請」のまま=反映されない不具合)
    user && comm.visibility === 'request'
      ? supabase
          .from('community_join_requests')
          .select('status')
          .eq('community_id', id)
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tags = (tagRes.data ?? []).map((r) => r.tag);
  const role = (membRes.data as { role: MemberRole } | null)?.role ?? null;
  const hasPendingRequest = !!(reqRes.data as { status?: string } | null);

  return {
    ...comm,
    tags,
    is_member: role !== null,
    role,
    has_pending_request: hasPendingRequest,
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
/**
 * コミュニティアイコン画像をアップロードし、公開 URL を返す。
 * @param community_id  コミュニティ ID (Storage パスのプレフィックスに使用)
 * @param body          アップロードする画像データ
 * @param contentType   MIME タイプ (許可: jpeg/png/webp/gif、それ以外は jpeg に fallback)
 */
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

// ============================================================
// realtime: 自分の community_members 変更を購読 (deprecated no-op)
// ============================================================
// ★ Audit E#5 (2026-05-28):
//   旧版は `my-communities:userId` channel で community_members を subscribe して
//   いたが、community_members は **supabase_realtime publication に未登録**
//   (migrations 確認: 0008/0009/0010/0013/0039/0040/0050/0051/0052 いずれにも無い)。
//   CLAUDE.md § 5.3「publication 未登録 table を subscribe しない」に違反する
//   ghost 購読で、CHANNEL_ERROR を立てるだけで実際は何も配信されていなかった。
//
//   → realtime を撤去 (no-op deprecated)。caller (app/(tabs)/community/index.tsx)
//     は `useFocusEffect` での invalidate で鮮度を保つ:
//     - 自分の join/leave は joinCommunity / leaveCommunity の onSuccess で
//       invalidate される
//     - 別端末や別画面での参加変動は focus 復帰時に refetch される
//
//   API signature は維持して call site の修正を最小化。
// ============================================================
/**
 * @deprecated Use useFocusEffect + invalidateQueries instead. See CLAUDE.md §5.3.
 *   この関数は no-op です。community_members は realtime publication 未登録のため
 *   subscription は CHANNEL_ERROR になるだけで実際には何も配信されません。
 */
export function subscribeToMyCommunityChanges(
  _userId: string,
  _onChange: () => void,
): { unsubscribe: () => void } {
  return {
    unsubscribe: () => {
      /* no-op (deprecated — see comment above) */
    },
  };
}

// ============================================================
// fetchCommunityMeta — BBS スレッドのコミュニティバッジ表示用
// ------------------------------------------------------------
// BBS スレッド一覧に表示する community_id → { name, icon_emoji } の
// 一括 lookup。CLAUDE.md §14: component から supabase.from() を直叩きしない。
// useCommunityMeta フックの queryFn として使う。
// ============================================================

/** BBS スレッドのコミュニティバッジ表示に必要な最小フィールド */
export type CommunityMeta = { name: string; icon_emoji: string };

/**
 * 複数 community_id に対して { name, icon_emoji } を一括 fetch する。
 * 結果は `id → CommunityMeta` の Record 形式で返す。
 * ids が空の場合は fetch せず空オブジェクトを即返却する。
 *
 * @param ids - lookup 対象の community_id 配列 (空配列 OK)
 */
export async function fetchCommunityMeta(
  ids: string[],
): Promise<Record<string, CommunityMeta>> {
  if (ids.length === 0) return {};
  const { data, error } = await withApiTimeout(
    supabase
      .from('communities')
      .select('id, name, icon_emoji')
      .in('id', ids),
    'communities.fetchCommunityMeta',
    8000,
  );
  if (error) {
    console.warn('[fetchCommunityMeta] community meta fetch failed:', error.message);
    return {};
  }
  const map: Record<string, CommunityMeta> = {};
  for (const row of (data ?? []) as Array<{ id: string; name: string; icon_emoji: string }>) {
    map[row.id] = { name: row.name, icon_emoji: row.icon_emoji };
  }
  return map;
}
