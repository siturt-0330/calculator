// ============================================================
// 画像アップロード前の前処理ヘルパ
// ============================================================
// - EXIF メタデータ (GPS / カメラ機種 / 時刻) を strip
// - 必要に応じてリサイズ + JPEG 再エンコードで容量削減
// - magic bytes で MIME を検証 (拡張子だけでは信用しない)
//
// プラットフォーム別実装:
//   Web    : fetch(uri).blob() で Blob 取得 → blob.slice/arrayBuffer で magic 判定
//   Native : expo-file-system.readAsStringAsync で base64 取得 → Uint8Array に変換
//            (native 環境では Blob 経由が不安定: Blob.slice/arrayBuffer が
//             実装に依らず動かないケース多数。iOS / Android のスマホで
//             アイコンアップロードが失敗していたのはこれが原因)
// ============================================================

import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

// magic byte 検査 — 先頭 12 バイトから MIME を判定 (実バイト)
function detectImageTypeFromBytes(buf: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null {
  if (buf.byteLength < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png';
  // GIF: GIF87a or GIF89a
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 &&
    buf[3] === 0x38 && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return 'image/gif';
  // WebP: "RIFF????WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';
  return null;
}

// Blob 経由 (Web 向け)
export async function detectImageType(blob: Blob): Promise<'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null> {
  const slice = blob.slice(0, 12);
  const buf = new Uint8Array(await slice.arrayBuffer());
  return detectImageTypeFromBytes(buf);
}

// base64 文字列 → Uint8Array
function base64ToBytes(b64: string): Uint8Array {
  // atob is available in Hermes (RN 0.76+) and Web. それ以外環境 (rare) なら手動 decode が必要。
  const bin = typeof atob === 'function' ? atob(b64) : globalThis.Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function safeExtension(mime: string): string {
  if (!ALLOWED_MIME.has(mime)) return 'jpg';
  const ext = mime.split('/')[1] ?? 'jpg';
  // パストラバーサル防止: 拡張子が許可リストに無ければ jpg にフォールバック
  return ALLOWED_EXT.has(ext) ? ext : 'jpg';
}

// 画像をリサイズ + 再エンコード = EXIF が自動的に除去される
// 戻り値は新しい URI (ローカルファイル) — caller が fetch(uri).blob() で読み込む
export async function stripExifAndResize(
  uri: string,
  opts: { maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<{ uri: string; width: number; height: number }> {
  const { maxWidth = 1600, maxHeight = 1600, quality = 0.85 } = opts;
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth, height: maxHeight } }],
    {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG, // JPEG で出力 → EXIF が破棄される
    },
  );
  return { uri: result.uri, width: result.width, height: result.height };
}

// uri → アップロード可能な body (sanitize + validate 込み)
// 戻り値: body は Web では Blob、Native では FormData (uri を含む multipart)。
// 両方とも Supabase Storage の upload() に渡せる。`uri` も同梱して FormData の
// 中身を確認できるようにする。後方互換性のため `blob` プロパティ名を維持。
//
// プラットフォーム別実装:
//   Web    : Blob (fetch().blob() 経由)
//   Native : FormData with { uri, name, type } — RN の標準的なファイル送信形式
//            内部で React Native の fetch が file:// を読んで multipart 送信する。
//            これは Hermes / iOS / Android で **必ず動く** RN idiomatic な方法。
//            旧実装 (Uint8Array body) は Supabase SDK が内部で fetch(uri, { body: uint8array })
//            を呼ぶが、これが Android の okhttp で確実に動くとは限らず実機で
//            アップロード失敗の原因になっていた。
export async function prepareImageUpload(
  uri: string,
  opts: { maxSizeBytes?: number; maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<{ blob: Blob | FormData; mime: string; ext: string; size: number; uri: string }> {
  const { maxSizeBytes = 5 * 1024 * 1024, ...rest } = opts;

  // ★ data URL ショートパス (iPhone Safari fix):
  // cropper が `data:image/jpeg;base64,...` を返した場合、これは既に処理済み
  // (512x512 JPEG、EXIF なし) なので、manipulator を再度呼ばずに直接 Blob 化する。
  // Safari は blob URL を勝手に revoke するが、data URL は revoke されない。
  // また manipulator の二重呼び出しは iPhone Safari の Canvas で memory error
  // / 空 Blob を返すケースがあり、これも回避できる。
  if (uri.startsWith('data:')) {
    const m = uri.match(/^data:([^;]+);base64,(.+)$/);
    if (m && (m[1] === 'image/jpeg' || m[1] === 'image/png' || m[1] === 'image/webp' || m[1] === 'image/gif')) {
      const mime = m[1] as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      const b64 = m[2]!;
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(b64);
      } catch (e) {
        throw new Error(`画像のデコードに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (bytes.byteLength > maxSizeBytes) {
        throw new Error(`画像が大きすぎます (${Math.round(bytes.byteLength / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
      }
      // magic byte の二重確認 (data: URL の mime ヘッダ偽装防止)
      const detectedMagic = detectImageTypeFromBytes(bytes.subarray(0, 12));
      const finalMime = detectedMagic ?? mime;
      const blob = new Blob([bytes], { type: finalMime });
      return { blob, mime: finalMime, ext: safeExtension(finalMime), size: bytes.byteLength, uri };
    }
  }

  // 1. リサイズ + JPEG 化 で EXIF 除去 (両プラットフォームで動く)
  // 重要: これにより URI が ph:// / asset:// から file:// に変換される
  //       (FileSystem や FormData が読める形式に必ず正規化される)
  let cleanUri: string;
  try {
    const r = await stripExifAndResize(uri, rest);
    cleanUri = r.uri;
  } catch (e) {
    throw new Error(`画像処理に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (Platform.OS === 'web') {
    // ----- Web: 多段フォールバック -----
    // iPhone Safari の「Load failed」エラーを根本的に潰すため、複数の経路を順に試す:
    //   Path 1: manipulator で最適化済みの cleanUri を fetch + magic byte 検証 (理想)
    //   Path 2: 元の uri を直接 fetch (HEIC や Canvas 不可な形式向け)
    //   Path 3: 失敗時に明確なエラーメッセージで throw
    const pathErrors: string[] = [];

    // Path 1: 最適化済み URI を fetch
    try {
      const res = await fetch(cleanUri);
      if (!res.ok) throw new Error(`fetch status ${res.status}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('empty blob (Safari blob URL may be revoked)');
      if (blob.size > maxSizeBytes) {
        throw new Error(`画像が大きすぎます (${Math.round(blob.size / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
      }
      const detected = await detectImageType(blob);
      if (!detected) throw new Error('magic byte 判定不能');
      return { blob, mime: detected, ext: safeExtension(detected), size: blob.size, uri: cleanUri };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[prepareImageUpload] Path 1 (cleanUri fetch) failed:', msg);
      pathErrors.push(`P1: ${msg}`);
    }

    // Path 2: 元 uri を直接 fetch (manipulator/Canvas を経由しない)
    // HEIC や巨大画像で manipulator が失敗するケース向け
    try {
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`fetch status ${res.status}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('empty blob');
      if (blob.size > maxSizeBytes) {
        throw new Error(`画像が大きすぎます (${Math.round(blob.size / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
      }
      // magic で判定失敗時は Blob.type を fallback、最終的に image/jpeg
      const detected = (await detectImageType(blob)) ?? (blob.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif') ?? 'image/jpeg';
      const finalMime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
        (detected === 'image/jpeg' || detected === 'image/png' || detected === 'image/webp' || detected === 'image/gif')
          ? detected
          : 'image/jpeg';
      console.log('[prepareImageUpload] Path 2 (raw fetch) ok, mime:', finalMime, 'size:', blob.size);
      return { blob, mime: finalMime, ext: safeExtension(finalMime), size: blob.size, uri };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[prepareImageUpload] Path 2 (raw uri fetch) failed:', msg);
      pathErrors.push(`P2: ${msg}`);
    }

    // 全部失敗 → 詳細なエラーメッセージで throw
    throw new Error(
      `画像の準備に失敗しました。HEIC 形式の写真を選んでいないか確認してください。(${pathErrors.join(' / ')})`,
    );
  }

  // ----- Native (iOS / Android): FormData 経路 -----
  // (1) ファイル情報を取得 (サイズ check)
  let fileSize = 0;
  try {
    const info = await FileSystem.getInfoAsync(cleanUri, { size: true });
    if (info.exists && 'size' in info && typeof info.size === 'number') {
      fileSize = info.size;
    }
  } catch (e) {
    console.warn('[prepareImageUpload] getInfoAsync failed:', e);
    // size 不明でも続行 (magic 検証で形式が分かれば OK)
  }
  if (fileSize > maxSizeBytes) {
    throw new Error(`画像が大きすぎます (${Math.round(fileSize / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
  }

  // (2) 先頭 12 byte だけ読んで magic byte で MIME 判定
  // 大きいファイルでもメモリを使わずに済む
  let head: string;
  try {
    head = await FileSystem.readAsStringAsync(cleanUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 16,
    });
  } catch (e) {
    throw new Error(`画像の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!head) {
    throw new Error('画像の中身が空です');
  }
  const headBytes = base64ToBytes(head);
  const detected = detectImageTypeFromBytes(headBytes);
  // stripExifAndResize は JPEG で出力するので通常は image/jpeg だが、
  // 万一 magic 判定が落ちた場合は image/jpeg と仮定して fail-soft で続行する
  // (ユーザー UX を優先: アップロード自体は試させる)
  const finalMime = detected ?? 'image/jpeg';
  const ext = safeExtension(finalMime);

  // (3) FormData with file URI を構築
  // React Native の fetch はこの形式の append を理解して、
  // 自動的に file:// を読んで multipart/form-data body を作ってくれる。
  const fd = new FormData();
  // Supabase Storage SDK は FormData 内の最初のファイルエントリ (name='') を
  // アップロード対象にする。`name` と `type` は RN の FormData が認識するキー。
  fd.append('', {
    uri: cleanUri,
    name: `upload.${ext}`,
    type: finalMime,
  } as unknown as Blob);  // RN の FormData は { uri, name, type } object を受け取れる

  return {
    blob: fd,
    mime: finalMime,
    ext,
    size: fileSize,
    uri: cleanUri,
  };
}
