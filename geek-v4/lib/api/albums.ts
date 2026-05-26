// ============================================================
// lib/api/albums.ts — 写真アルバム + 写真 (migration 0052)
// ============================================================
// docs/MYPAGE_ALBUMS_SPEC.md § 4.2 を参照。
// - albums と album_photos は別テーブル。photo は album に属さなくても良い (album_id null)。
// - visibility は 'private' / 'shared' の二択。'shared' なら shared_with_user_ids[] が効く。
// - 画像は必ず prepareImageUpload を経由 (EXIF strip + magic-byte + JPEG 再エンコード)。
// - 全 supabase 呼び出しは withApiTimeout でラップ (CLAUDE.md § 5.1)。
// ============================================================

import { Platform } from 'react-native';
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import { prepareImageUpload, safeExtension } from '../image';
import { swallow } from '../swallow';
import type { Album, AlbumPhoto, PhotoVisibility } from '../../types/models';

const ALBUM_BUCKET = 'albums';

// ============================================================
// 内部ユーティリティ
// ============================================================

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // フォールバック (古い RN 等) — path 接頭辞に user_id があるので衝突許容
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// album_photos の public URL から bucket-relative な path を逆算する。
// 例: https://xxx.supabase.co/storage/v1/object/public/albums/<user>/<uuid>.jpg
//   → <user>/<uuid>.jpg
// 失敗時 (URL 構造が違う) は null を返す → caller は fire-and-forget で握りつぶす。
function imageUrlToStoragePath(url: string): string | null {
  if (!url) return null;
  const marker = `/object/public/${ALBUM_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const path = url.slice(idx + marker.length);
  // query string が付いていれば落とす
  const q = path.indexOf('?');
  return q >= 0 ? path.slice(0, q) : path;
}

// album_photos の最初の 1 枚を cover に転用する用の minimal type
type CoverPhotoRow = { album_id: string | null; image_url: string };

// album 一覧に cover_url を充填するヘルパ。
// 戦略:
//   1. albums.cover_photo_id が指定されている album だけ ID を集めて 1 回 SELECT
//   2. 残り (cover 未指定) は album_photos から「各 album_id の最も古い photo」を
//      雑に取って先勝ち (DESC ではなく position ASC → created_at ASC を擬似的に再現)
// 失敗しても cover_url 抜きで返す。
async function attachCoverUrls(albums: Album[]): Promise<Album[]> {
  if (albums.length === 0) return albums;

  const withCover = albums.filter((a) => !!a.cover_photo_id);
  const withoutCover = albums.filter((a) => !a.cover_photo_id);

  // 1) 明示指定 cover_photo_id の取得
  const coverPhotoMap = new Map<string, string>(); // photo_id → image_url
  if (withCover.length > 0) {
    const ids = withCover.map((a) => a.cover_photo_id).filter((id): id is string => !!id);
    if (ids.length > 0) {
      const { data, error } = await withApiTimeout(
        supabase.from('album_photos').select('id, image_url').in('id', ids),
        'albums.attachCoverUrls.byId',
        8000,
      );
      if (!error && data) {
        for (const row of data as Array<{ id: string; image_url: string }>) {
          coverPhotoMap.set(row.id, row.image_url);
        }
      }
    }
  }

  // 2) cover 未指定 album の代表 photo を 1 クエリで取得
  const fallbackByAlbum = new Map<string, string>(); // album_id → image_url
  if (withoutCover.length > 0) {
    const albumIds = withoutCover.map((a) => a.id);
    const { data, error } = await withApiTimeout(
      supabase
        .from('album_photos')
        .select('album_id, image_url, position, created_at')
        .in('album_id', albumIds)
        .eq('is_hidden', false)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
      'albums.attachCoverUrls.fallback',
      8000,
    );
    if (!error && data) {
      for (const row of data as CoverPhotoRow[]) {
        if (row.album_id && !fallbackByAlbum.has(row.album_id)) {
          fallbackByAlbum.set(row.album_id, row.image_url);
        }
      }
    }
  }

  return albums.map((a) => {
    let url: string | null = null;
    if (a.cover_photo_id) url = coverPhotoMap.get(a.cover_photo_id) ?? null;
    if (!url) url = fallbackByAlbum.get(a.id) ?? null;
    return { ...a, cover_url: url };
  });
}

// ============================================================
// アルバム CRUD
// ============================================================

const ALBUM_SELECT_COLS =
  'id, owner_id, title, description, cover_photo_id, visibility, shared_with_user_ids, photo_count, created_at, updated_at';

export async function fetchMyAlbums(): Promise<Album[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await withApiTimeout(
    supabase
      .from('albums')
      .select(ALBUM_SELECT_COLS)
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false }),
    'albums.fetchMyAlbums',
    8000,
  );
  if (error) {
    console.warn('[albums] fetchMyAlbums failed:', error.message);
    return [];
  }
  const albums = (data ?? []) as Album[];
  return attachCoverUrls(albums);
}

// 共有されているアルバム = 自分が owner ではなく、shared_with_user_ids に自分の id が含まれるもの。
// RLS が select policy で同じ条件を効かせるので、クエリ自体は owner_id != self だけで足りる。
export async function fetchSharedAlbums(): Promise<Album[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const selfId = user.id;

  const { data, error } = await withApiTimeout(
    supabase
      .from('albums')
      .select(ALBUM_SELECT_COLS)
      .eq('visibility', 'shared')
      .neq('owner_id', selfId)
      .contains('shared_with_user_ids', [selfId])
      .order('updated_at', { ascending: false }),
    'albums.fetchSharedAlbums',
    8000,
  );
  if (error) {
    console.warn('[albums] fetchSharedAlbums failed:', error.message);
    return [];
  }
  const albums = (data ?? []) as Album[];
  return attachCoverUrls(albums);
}

export async function fetchAlbum(id: string): Promise<Album> {
  const { data, error } = await withApiTimeout(
    supabase.from('albums').select(ALBUM_SELECT_COLS).eq('id', id).single(),
    'albums.fetchAlbum',
    8000,
  );
  if (error || !data) {
    throw new Error(`アルバム取得に失敗しました: ${error?.message ?? 'not found'}`);
  }
  const [withCover] = await attachCoverUrls([data as Album]);
  // attachCoverUrls は最低 1 件返すが、TS の narrowing に明示 fallback
  return withCover ?? (data as Album);
}

export async function createAlbum(input: {
  title: string;
  description?: string;
  visibility?: PhotoVisibility;
  shared_with_user_ids?: string[];
}): Promise<Album> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインしてください');

  const title = (input.title ?? '').trim();
  if (title.length < 1 || title.length > 60) {
    throw new Error('アルバム名は 1〜60 文字で入力してください');
  }
  const description = input.description?.trim() ?? null;
  if (description && description.length > 200) {
    throw new Error('説明は 200 文字以内で入力してください');
  }
  const visibility: PhotoVisibility = input.visibility ?? 'private';
  // shared_with は重複削除 + self を除外 (RLS 評価で self は別経路で見られる)
  const shared = Array.from(new Set(input.shared_with_user_ids ?? [])).filter((id) => id !== user.id);

  const { data, error } = await withApiTimeout(
    supabase
      .from('albums')
      .insert({
        owner_id: user.id,
        title,
        description,
        visibility,
        shared_with_user_ids: shared,
      })
      .select(ALBUM_SELECT_COLS)
      .single(),
    'albums.createAlbum',
    8000,
  );
  if (error || !data) {
    throw new Error(`アルバム作成に失敗しました: ${error?.message ?? 'unknown'}`);
  }
  return data as Album;
}

// 更新は ホワイトリスト経由のみ。空 patch は no-op で返す。
const ALBUM_UPDATE_ALLOWED = [
  'title',
  'description',
  'visibility',
  'shared_with_user_ids',
  'cover_photo_id',
] as const;

export async function updateAlbum(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    visibility: PhotoVisibility;
    shared_with_user_ids: string[];
    cover_photo_id: string;
  }>,
): Promise<Album> {
  const safe: Record<string, unknown> = {};
  for (const key of ALBUM_UPDATE_ALLOWED) {
    if (key in patch && patch[key] !== undefined) {
      safe[key] = patch[key];
    }
  }
  if (typeof safe.title === 'string') {
    const t = safe.title.trim();
    if (t.length < 1 || t.length > 60) {
      throw new Error('アルバム名は 1〜60 文字で入力してください');
    }
    safe.title = t;
  }
  if (typeof safe.description === 'string') {
    if (safe.description.length > 200) {
      throw new Error('説明は 200 文字以内で入力してください');
    }
  }
  if (typeof safe.visibility === 'string'
      && safe.visibility !== 'private' && safe.visibility !== 'shared') {
    throw new Error('不正な公開設定です');
  }
  if (Array.isArray(safe.shared_with_user_ids)) {
    safe.shared_with_user_ids = Array.from(new Set(safe.shared_with_user_ids as string[]));
  }
  // updated_at は server-side trigger / 手動で打つ。明示更新で確実に最新化。
  safe.updated_at = new Date().toISOString();

  const { data, error } = await withApiTimeout(
    supabase.from('albums').update(safe).eq('id', id).select(ALBUM_SELECT_COLS).single(),
    'albums.updateAlbum',
    8000,
  );
  if (error || !data) {
    throw new Error(`アルバム更新に失敗しました: ${error?.message ?? 'unknown'}`);
  }
  return data as Album;
}

export async function deleteAlbum(id: string): Promise<void> {
  const { error } = await withApiTimeout(
    supabase.from('albums').delete().eq('id', id),
    'albums.deleteAlbum',
    8000,
  );
  if (error) throw new Error(`アルバム削除に失敗しました: ${error.message}`);
}

// ============================================================
// 写真 (album_photos)
// ============================================================

const PHOTO_SELECT_COLS =
  'id, owner_id, album_id, image_url, caption, visibility, shared_with_user_ids, is_hidden, width, height, blurhash, position, created_at';

// album 内の写真一覧 (is_hidden=false のみ — owner 視点で全部見たい時は fetchMyPhotos を使う)
export async function fetchAlbumPhotos(albumId: string): Promise<AlbumPhoto[]> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('album_photos')
      .select(PHOTO_SELECT_COLS)
      .eq('album_id', albumId)
      .eq('is_hidden', false)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    'albums.fetchAlbumPhotos',
    8000,
  );
  if (error) {
    console.warn('[albums] fetchAlbumPhotos failed:', error.message);
    return [];
  }
  return (data ?? []) as AlbumPhoto[];
}

// 1 件取得 — 写真詳細画面 (/mypage/photo/[id]) 用
export async function fetchPhoto(id: string): Promise<AlbumPhoto> {
  const { data, error } = await withApiTimeout(
    supabase.from('album_photos').select(PHOTO_SELECT_COLS).eq('id', id).single(),
    'albums.fetchPhoto',
    8000,
  );
  if (error || !data) {
    throw new Error(`写真の取得に失敗しました: ${error?.message ?? 'not found'}`);
  }
  return data as AlbumPhoto;
}

// 自分視点の photo 一覧 (mine = private only / shared = shared only / all = 両方)
// owner_id = self の全件を取り、scope で絞る (RLS で owner_id=self は無条件可)
export async function fetchMyPhotos(scope: 'all' | 'mine' | 'shared'): Promise<AlbumPhoto[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from('album_photos')
    .select(PHOTO_SELECT_COLS)
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (scope === 'mine') {
    query = query.eq('visibility', 'private');
  } else if (scope === 'shared') {
    query = query.eq('visibility', 'shared');
  }

  const { data, error } = await withApiTimeout(query, `albums.fetchMyPhotos.${scope}`, 8000);
  if (error) {
    console.warn('[albums] fetchMyPhotos failed:', error.message);
    return [];
  }
  return (data ?? []) as AlbumPhoto[];
}

// ============================================================
// 写真アップロード
// ============================================================
// docs/MYPAGE_ALBUMS_SPEC.md § 4 の手順を厳密に守る:
//   1. prepareImageUpload(uri, { maxWidth: 1600, maxHeight: 1600, quality: 0.85 })
//   2. supabase.storage.from('albums').upload(`${userId}/${uuid}.${ext}`, blob, ...)
//   3. supabase.storage.from('albums').getPublicUrl(path) → image_url
//   4. INSERT into album_photos
// ============================================================
export async function uploadAlbumPhoto(uri: string, opts: {
  albumId?: string;
  caption?: string;
  visibility: PhotoVisibility;
  sharedWith?: string[];
}): Promise<AlbumPhoto> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインしてください');

  // (1) 画像を sanitize + リサイズ
  const prepared = await prepareImageUpload(uri, {
    maxSizeBytes: 10 * 1024 * 1024, // 10MB (bucket の file_size_limit と一致)
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.85,
  });
  const ext = safeExtension(prepared.mime);
  const path = `${user.id}/${uuid()}.${ext}`;

  // (2) Storage upload
  const upload = supabase.storage.from(ALBUM_BUCKET).upload(path, prepared.blob, {
    contentType: prepared.mime,
    cacheControl: '31536000', // 1y — immutable な命名
    upsert: false,
  });
  const { error: upErr } = await withApiTimeout(upload, 'albums.upload.storage', 30_000);
  if (upErr) {
    throw new Error(`写真のアップロードに失敗しました: ${upErr.message}`);
  }

  // (3) public URL を取得
  const { data: pub } = supabase.storage.from(ALBUM_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    throw new Error('写真 URL の取得に失敗しました');
  }
  const imageUrl = pub.publicUrl;

  // (4) DB INSERT
  // caption length check (DB CHECK は 500 文字)
  const safeCaption = opts.caption?.trim() ?? null;
  if (safeCaption && safeCaption.length > 500) {
    throw new Error('キャプションは 500 文字以内で入力してください');
  }
  const sharedRaw = opts.sharedWith ?? [];
  const shared = Array.from(new Set(sharedRaw)).filter((id) => id !== user.id);

  const { data, error } = await withApiTimeout(
    supabase
      .from('album_photos')
      .insert({
        owner_id: user.id,
        album_id: opts.albumId ?? null,
        image_url: imageUrl,
        caption: safeCaption,
        visibility: opts.visibility,
        shared_with_user_ids: shared,
      })
      .select(PHOTO_SELECT_COLS)
      .single(),
    'albums.uploadAlbumPhoto.insert',
    8000,
  );
  if (error || !data) {
    // INSERT 失敗時は orphan ファイルを掃除 (fire-and-forget)
    try {
      await supabase.storage.from(ALBUM_BUCKET).remove([path]);
    } catch (e) {
      swallow('albums.upload.cleanup', e);
    }
    throw new Error(`写真の登録に失敗しました: ${error?.message ?? 'unknown'}`);
  }
  // Platform 参照で babel 警告対策 (web 専用の preview 関数を未使用にしない為の no-op)
  // 実害なし — tree shake で消える
  void Platform.OS;
  return data as AlbumPhoto;
}

// ============================================================
// 写真の更新 / 削除
// ============================================================

const PHOTO_UPDATE_ALLOWED = [
  'caption',
  'is_hidden',
  'album_id',
  'visibility',
  'shared_with_user_ids',
] as const;

export async function updatePhoto(
  id: string,
  patch: Partial<{
    caption: string;
    is_hidden: boolean;
    album_id: string | null;
    visibility: PhotoVisibility;
    shared_with_user_ids: string[];
  }>,
): Promise<AlbumPhoto> {
  const safe: Record<string, unknown> = {};
  for (const key of PHOTO_UPDATE_ALLOWED) {
    if (key in patch && patch[key] !== undefined) {
      safe[key] = patch[key];
    }
  }
  if (typeof safe.caption === 'string') {
    const c = safe.caption.trim();
    if (c.length > 500) throw new Error('キャプションは 500 文字以内で入力してください');
    safe.caption = c.length === 0 ? null : c;
  }
  if (typeof safe.visibility === 'string'
      && safe.visibility !== 'private' && safe.visibility !== 'shared') {
    throw new Error('不正な公開設定です');
  }
  if (Array.isArray(safe.shared_with_user_ids)) {
    safe.shared_with_user_ids = Array.from(new Set(safe.shared_with_user_ids as string[]));
  }

  const { data, error } = await withApiTimeout(
    supabase
      .from('album_photos')
      .update(safe)
      .eq('id', id)
      .select(PHOTO_SELECT_COLS)
      .single(),
    'albums.updatePhoto',
    8000,
  );
  if (error || !data) {
    throw new Error(`写真の更新に失敗しました: ${error?.message ?? 'unknown'}`);
  }
  return data as AlbumPhoto;
}

// 写真削除 — DB を先に消し、storage は fire-and-forget で掃除する。
// storage 削除が失敗しても DB 上の参照は消えているので画面には表示されない。
export async function deletePhoto(id: string): Promise<void> {
  // 削除前に image_url を取得 (storage path 算出のため)
  const { data: row } = await withApiTimeout(
    supabase.from('album_photos').select('image_url').eq('id', id).maybeSingle(),
    'albums.deletePhoto.lookup',
    8000,
  );
  const imageUrl = (row as { image_url?: string } | null)?.image_url ?? null;

  const { error } = await withApiTimeout(
    supabase.from('album_photos').delete().eq('id', id),
    'albums.deletePhoto.delete',
    8000,
  );
  if (error) throw new Error(`写真の削除に失敗しました: ${error.message}`);

  // storage は fire-and-forget (失敗しても無視)
  if (imageUrl) {
    const path = imageUrlToStoragePath(imageUrl);
    if (path) {
      try {
        await supabase.storage.from(ALBUM_BUCKET).remove([path]);
      } catch (e) {
        swallow('albums.deletePhoto.storage', e);
      }
    }
  }
}
