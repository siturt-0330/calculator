// ============================================================
// Supabase Storage 画像 URL → Transformation endpoint 変換
// ============================================================
// Supabase の Storage には `/render/image/public/` という
// 画像変換エンドポイントがあり、`width` / `quality` / `resize`
// クエリで動的にサムネイル化できる。
//
// オリジナル投稿画像は最大 1600x1600 / JPEG 85% で保存される
// (lib/image.ts:stripExifAndResize 参照) ため 1MB 超ザラ。
// フィードでは ~400-500px 幅で表示するので、720px もあれば
// retina 端末でも綺麗に出る + 帯域は 1/4 以下に。
//
// 注意: Supabase Storage URL 以外 (e.g. 外部 CDN) はそのまま返す。
// ============================================================

const SUPABASE_PUBLIC_OBJECT = '/storage/v1/object/public/';
const SUPABASE_PUBLIC_RENDER = '/storage/v1/render/image/public/';

/**
 * 元の Storage public URL を image transformation endpoint に変換する。
 *
 * 例:
 *   https://xxx.supabase.co/storage/v1/object/public/post-images/abc.jpg
 *   → https://xxx.supabase.co/storage/v1/render/image/public/post-images/abc.jpg?width=720&quality=75&resize=cover
 *
 * 既に render endpoint や width クエリが付いている、または Supabase 以外の URL は
 * そのまま返す (二重変換 / 壊れた URL 防止)。
 */
export function thumbedUrl(
  url: string | null | undefined,
  width = 720,
  opts: { quality?: number; format?: 'webp' | 'avif' | 'origin' } = {},
): string {
  if (!url) return '';
  if (!url.includes(SUPABASE_PUBLIC_OBJECT)) return url;
  const rendered = url.replace(SUPABASE_PUBLIC_OBJECT, SUPABASE_PUBLIC_RENDER);
  if (/[?&]width=/.test(rendered)) return rendered;
  const quality = opts.quality ?? 75;
  const format = opts.format ?? 'webp';   // ★ デフォルトを WebP に (JPEG 比 25-30% 軽量)
  const sep = rendered.includes('?') ? '&' : '?';
  return `${rendered}${sep}width=${width}&quality=${quality}&resize=cover&format=${format}`;
}

/**
 * Web responsive image 用の srcset/sizes を生成。
 * Instagram 並みの帯域最適化: 端末 DPR / viewport に応じて Supabase が適サイズを返す。
 */
export function thumbedSrcSet(
  url: string | null | undefined,
  widths: readonly number[] = [320, 480, 720, 1080],
): { srcSet: string; sizes: string } | null {
  if (!url) return null;
  if (!url.includes(SUPABASE_PUBLIC_OBJECT)) return null;
  const srcSet = widths.map((w) => `${thumbedUrl(url, w)} ${w}w`).join(', ');
  // 「画面幅以下なら viewport 100%、それ以上は最大 720px」
  const sizes = '(max-width: 720px) 100vw, 720px';
  return { srcSet, sizes };
}
