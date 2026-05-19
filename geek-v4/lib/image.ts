// ============================================================
// 画像アップロード前の前処理ヘルパ
// ============================================================
// - EXIF メタデータ (GPS / カメラ機種 / 時刻) を strip
// - 必要に応じてリサイズ + JPEG 再エンコードで容量削減
// - magic bytes で MIME を検証 (拡張子だけでは信用しない)
// ============================================================

import * as ImageManipulator from 'expo-image-manipulator';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

// magic byte 検査 (URL 経由で Blob 取得後に呼ぶ)
export async function detectImageType(blob: Blob): Promise<'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null> {
  // 先頭 12 バイトを読む
  const slice = blob.slice(0, 12);
  const buf = new Uint8Array(await slice.arrayBuffer());
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

// uri → Blob (sanitize + validate 込みの一括ヘルパ)
export async function prepareImageUpload(
  uri: string,
  opts: { maxSizeBytes?: number; maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<{ blob: Blob; mime: string; ext: string }> {
  const { maxSizeBytes = 5 * 1024 * 1024, ...rest } = opts;
  // 1. リサイズ + JPEG 化 で EXIF 除去
  const { uri: cleanUri } = await stripExifAndResize(uri, rest);
  // 2. blob として取得
  const res = await fetch(cleanUri);
  const blob = await res.blob();
  // 3. サイズ check
  if (blob.size > maxSizeBytes) {
    throw new Error(`画像が大きすぎます (${Math.round(blob.size / 1024)}KB / 上限 ${Math.round(maxSizeBytes / 1024)}KB)`);
  }
  // 4. magic bytes で MIME validate
  const detected = await detectImageType(blob);
  if (!detected) {
    throw new Error('画像形式を判定できませんでした');
  }
  return { blob, mime: detected, ext: safeExtension(detected) };
}
