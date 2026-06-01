// ============================================================
// lib/media.ts — 投稿用メディアの Supabase Storage アップロード
// ============================================================
// 既存実装の重大バグ: app/post/create.tsx は picker から受け取った
// ローカル URI (file://... / blob:...) を直接 createPost に渡し、
// それが media_urls 列に文字列としてそのまま保存されていた。
// → 投稿者本人にしか画像が見えない (URI が他デバイスでは解決できない)。
//
// この module はそれを **必ず** 直す唯一の入口:
//   - 画像: prepareImageUpload で EXIF strip + resize + MIME 検証 → upload
//   - 動画: validate (size / MIME) のみ → upload (transcoding はしない)
//   - どちらも posts-media bucket の `<user_id>/<uuid>.<ext>` path に置く
//   - 戻り値は getPublicUrl() で得た HTTPS の長期 URL
//
// 失敗時は throw して呼び出し側 (createPost flow) に伝える。
// 部分成功 (1 枚目アップロード成功 / 2 枚目失敗) は呼び出し側で「ここで止める」
// 判断する。本 module は 1 ファイル単位の責務。
// ============================================================

import { Platform } from 'react-native';
import { supabase } from './supabase';
import { prepareImageUpload, safeExtension } from './image';
import { withApiTimeout } from './withApiTimeout';

const BUCKET = 'posts-media';

// 動画: 100MB 上限 (Storage bucket の file_size_limit と一致させる)
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',  // .mov (iOS デフォルト)
  'video/webm',
  'video/x-m4v',
]);
const VIDEO_EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
};

function uuid(): string {
  // crypto.randomUUID は modern RN (Hermes 0.76+) と modern Web で利用可
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // フォールバック: 衝突確率は十分低い (Math.random ベース)
  // path には user_id 接頭辞があるので衝突しても被害は最小
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ============================================================
// uploadPostImage — 1 枚の画像を posts-media に upload して公開 URL を返す
// ============================================================
export async function uploadPostImage(uri: string, userId: string): Promise<string> {
  if (!userId) throw new Error('uploadPostImage: userId is required');
  if (!uri) throw new Error('uploadPostImage: uri is required');

  // prepareImageUpload が MIME / size / EXIF / resize を全部やる。
  // 戻り値の blob は Web では Blob, Native では FormData。
  const prepared = await prepareImageUpload(uri, {
    maxSizeBytes: 5 * 1024 * 1024, // 画像は 5MB に抑える (動画と違って多用される)
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.85,
  });

  const ext = safeExtension(prepared.mime);
  const path = `${userId}/${uuid()}.${ext}`;

  // upload 自体に 30 秒の timeout を被せる (mobile で詰まったら表示)
  const upload = supabase.storage.from(BUCKET).upload(path, prepared.blob, {
    contentType: prepared.mime,
    cacheControl: '31536000',  // 1y — bucket は immutable な命名なので長期 cache OK
    upsert: false,
  });
  const { error } = await withApiTimeout(upload, 'media.upload.image', 30_000);
  if (error) {
    // RLS / 容量 / ネットワーク等
    throw new Error(`画像アップロード失敗: ${error.message}`);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    throw new Error('画像 URL の取得に失敗しました');
  }
  return pub.publicUrl;
}

// ============================================================
// validateVideoSource — picker 直後に呼んで「これは投稿可能か」を返す
// upload 前のチェックなので、ファイルサイズが大きい時に早期 reject できる
// ============================================================
export type VideoValidationResult =
  | { ok: true; mime: string; ext: string; size: number }
  | { ok: false; reason: string };

export async function validateVideoSource(asset: {
  uri: string;
  fileSize?: number | null;
  mimeType?: string | null;
}): Promise<VideoValidationResult> {
  if (!asset.uri) return { ok: false, reason: '動画 URI が空です' };

  // ImagePicker の fileSize は asset.fileSize で来る (バイト)。
  // 取れない場合は HEAD 取得して確認するか、upload 時の自然失敗に任せる。
  if (asset.fileSize != null && asset.fileSize > MAX_VIDEO_BYTES) {
    const mb = (asset.fileSize / 1024 / 1024).toFixed(1);
    return { ok: false, reason: `動画サイズが大きすぎます (${mb}MB)。100MB 以下にしてください。` };
  }

  // MIME 推定: picker が返す mimeType が一番信頼できる。無い時は URI 拡張子から推定。
  let mime = asset.mimeType?.toLowerCase() ?? '';
  if (!mime) {
    const lower = asset.uri.toLowerCase();
    if (lower.endsWith('.mp4')) mime = 'video/mp4';
    else if (lower.endsWith('.mov')) mime = 'video/quicktime';
    else if (lower.endsWith('.webm')) mime = 'video/webm';
    else if (lower.endsWith('.m4v')) mime = 'video/x-m4v';
  }

  if (!ALLOWED_VIDEO_MIMES.has(mime)) {
    return {
      ok: false,
      reason: `この動画形式は未対応です (${mime || '不明'})。MP4 / MOV / WebM のいずれかを選んでください。`,
    };
  }

  const ext = VIDEO_EXT_BY_MIME[mime] ?? 'mp4';
  return { ok: true, mime, ext, size: asset.fileSize ?? 0 };
}

// ============================================================
// uploadPostVideo — 1 件の動画を posts-media に upload して公開 URL を返す
// ============================================================
export async function uploadPostVideo(
  uri: string,
  userId: string,
  validated: { mime: string; ext: string },
): Promise<string> {
  if (!userId) throw new Error('uploadPostVideo: userId is required');
  if (!uri) throw new Error('uploadPostVideo: uri is required');

  const { mime, ext } = validated;
  const path = `${userId}/${uuid()}.${ext}`;

  // 動画ファイル body の作り方は image と同じ pattern が安全:
  //   Web: fetch(uri).blob()
  //   Native: FormData with { uri, name, type } (RN の標準 multipart)
  let body: Blob | FormData;
  if (Platform.OS === 'web') {
    try {
      const r = await fetch(uri);
      if (!r.ok) throw new Error(`fetch video failed (${r.status})`);
      const raw = await r.blob();
      // サイズ後検証 (fileSize が picker から無かったケースの最後の砦)
      if (raw.size > MAX_VIDEO_BYTES) {
        throw new Error('動画サイズが 100MB を超えています');
      }
      // ★ storage-js は Blob の .type を multipart の content-type に採用する
      //   (options.contentType は Blob 経路では無視される)。blob: URL 由来の Blob は
      //   .type が空 / application/octet-stream になりがちで、bucket の video MIME
      //   許可に弾かれて upload が落ちる。検証済み mime で包み直して固定する。
      body = raw.type === mime ? raw : new Blob([raw], { type: mime });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`動画読み込みに失敗: ${msg}`);
    }
  } else {
    // Native: FormData に { uri, name, type } を append (RN fetch が multipart 送信)。
    // ★ フィールド名は必ず '' (空文字)。Supabase storage-js は FormData をそのまま内部
    //   fetch に渡すため、サーバが取り出すのは name='' の最初のファイルエントリ。
    //   'file' 等にすると取り出せず upload が失敗する (画像 lib/image.ts:430 と同じ規約)。
    const fd = new FormData();
    (fd as unknown as {
      append: (k: string, v: { uri: string; name: string; type: string }) => void;
    }).append('', { uri, name: `video.${ext}`, type: mime });
    body = fd;
  }

  // 動画は大きいので timeout は 5 分まで許す
  const upload = supabase.storage.from(BUCKET).upload(path, body, {
    contentType: mime,
    cacheControl: '31536000',
    upsert: false,
  });
  const { error } = await withApiTimeout(upload, 'media.upload.video', 5 * 60_000);
  if (error) {
    throw new Error(`動画アップロード失敗: ${error.message}`);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    throw new Error('動画 URL の取得に失敗しました');
  }
  return pub.publicUrl;
}
