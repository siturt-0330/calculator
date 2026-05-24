// ============================================================
// video validate (logic mirror)
// ============================================================
// lib/media.ts は supabase / react-native の連鎖 import で jest が落ちるため、
// validateVideoSource と同じロジックをローカルに mirror して logic 検証する。
// 実装変更時は両方を併せて update すること。
// ============================================================

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
]);
const VIDEO_EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
};

type ValidationResult =
  | { ok: true; mime: string; ext: string; size: number }
  | { ok: false; reason: string };

function validate(asset: { uri: string; fileSize?: number | null; mimeType?: string | null }): ValidationResult {
  if (!asset.uri) return { ok: false, reason: '動画 URI が空です' };
  if (asset.fileSize != null && asset.fileSize > MAX_VIDEO_BYTES) {
    const mb = (asset.fileSize / 1024 / 1024).toFixed(1);
    return { ok: false, reason: `動画サイズが大きすぎます (${mb}MB)。100MB 以下にしてください。` };
  }
  let mime = asset.mimeType?.toLowerCase() ?? '';
  if (!mime) {
    const lower = asset.uri.toLowerCase();
    if (lower.endsWith('.mp4')) mime = 'video/mp4';
    else if (lower.endsWith('.mov')) mime = 'video/quicktime';
    else if (lower.endsWith('.webm')) mime = 'video/webm';
    else if (lower.endsWith('.m4v')) mime = 'video/x-m4v';
  }
  if (!ALLOWED_VIDEO_MIMES.has(mime)) {
    return { ok: false, reason: `この動画形式は未対応です (${mime || '不明'})。MP4 / MOV / WebM のいずれかを選んでください。` };
  }
  const ext = VIDEO_EXT_BY_MIME[mime] ?? 'mp4';
  return { ok: true, mime, ext, size: asset.fileSize ?? 0 };
}

describe('validateVideoSource (logic mirror)', () => {
  it('mp4 (mimeType 明示) を accept', () => {
    const r = validate({ uri: 'file:///a.mp4', mimeType: 'video/mp4', fileSize: 1024 * 1024 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ext).toBe('mp4');
  });

  it('mov (URI 拡張子から推定) を accept', () => {
    const r = validate({ uri: 'file:///recorded.MOV', mimeType: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mime).toBe('video/quicktime');
  });

  it('webm を accept', () => {
    const r = validate({ uri: 'blob:webm', mimeType: 'video/webm' });
    expect(r.ok).toBe(true);
  });

  it('avi / mkv 等は reject', () => {
    const r = validate({ uri: 'file:///x.avi', mimeType: 'video/x-msvideo' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/未対応|MP4|MOV|WebM/);
  });

  it('100MB 超は reject', () => {
    const r = validate({ uri: 'file:///big.mp4', mimeType: 'video/mp4', fileSize: 150 * 1024 * 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/大きすぎ|100MB/);
  });

  it('100MB ちょうどは accept', () => {
    const r = validate({ uri: 'file:///edge.mp4', mimeType: 'video/mp4', fileSize: 100 * 1024 * 1024 });
    expect(r.ok).toBe(true);
  });

  it('URI 空は reject', () => {
    const r = validate({ uri: '', mimeType: 'video/mp4' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/URI/);
  });

  it('mimeType も拡張子も不明は reject', () => {
    const r = validate({ uri: 'file:///mystery_file', mimeType: null });
    expect(r.ok).toBe(false);
  });

  it('image/* mime を reject (動画 picker 経由で誤って画像が来た場合)', () => {
    const r = validate({ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' });
    expect(r.ok).toBe(false);
  });
});
