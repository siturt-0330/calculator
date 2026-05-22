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
// 戻り値: body は Web では Blob、Native では Uint8Array。両方とも Supabase Storage の
// upload() に渡せる。後方互換性のため `blob` プロパティ名を維持。
export async function prepareImageUpload(
  uri: string,
  opts: { maxSizeBytes?: number; maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<{ blob: Blob | Uint8Array; mime: string; ext: string; size: number }> {
  const { maxSizeBytes = 5 * 1024 * 1024, ...rest } = opts;
  // 1. リサイズ + JPEG 化 で EXIF 除去 (両プラットフォームで動く)
  const { uri: cleanUri } = await stripExifAndResize(uri, rest);

  if (Platform.OS === 'web') {
    // ----- Web: fetch + Blob 経路 -----
    const res = await fetch(cleanUri);
    const blob = await res.blob();
    if (blob.size > maxSizeBytes) {
      throw new Error(`画像が大きすぎます (${Math.round(blob.size / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
    }
    const detected = await detectImageType(blob);
    if (!detected) throw new Error('画像形式を判定できませんでした');
    return { blob, mime: detected, ext: safeExtension(detected), size: blob.size };
  }

  // ----- Native (iOS / Android): expo-file-system 経由 -----
  // 旧実装は fetch(file://uri).blob() で Blob を作っていたが、
  // RN の Blob は slice() / arrayBuffer() が確実に動かないケースがあり、
  // detectImageType が null を返してアップロード失敗 → 「画像形式を判定
  // できませんでした」エラーが iOS / Android で頻発していた。
  // FileSystem.readAsStringAsync(base64) は両プラットフォームで安定。
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(cleanUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e) {
    throw new Error(`画像の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!base64) throw new Error('画像の中身が空です');

  // base64 文字列のサイズ → 実バイトサイズ概算 (base64 は 4/3 に膨張)
  // 厳密にはパディングを引くべきだが、上限チェックには十分。
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > maxSizeBytes) {
    throw new Error(`画像が大きすぎます (${Math.round(approxBytes / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
  }

  const bytes = base64ToBytes(base64);
  const detected = detectImageTypeFromBytes(bytes.subarray(0, 12));
  if (!detected) throw new Error('画像形式を判定できませんでした');

  return { blob: bytes, mime: detected, ext: safeExtension(detected), size: bytes.byteLength };
}
