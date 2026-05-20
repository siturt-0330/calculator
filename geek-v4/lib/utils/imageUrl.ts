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
export function thumbedUrl(url: string | null | undefined, width = 720): string {
  if (!url) return '';
  // Supabase Storage public URL のみ対象 (path が `/storage/v1/object/public/`)
  if (!url.includes(SUPABASE_PUBLIC_OBJECT)) return url;
  // 既に render endpoint なら追記しない (width クエリだけ無ければ足す)
  // ただし通常は `getPublicUrl` 由来なので /object/public/ で入ってくる
  const rendered = url.replace(SUPABASE_PUBLIC_OBJECT, SUPABASE_PUBLIC_RENDER);
  // 既に width が付いていれば触らない
  if (/[?&]width=/.test(rendered)) return rendered;
  const sep = rendered.includes('?') ? '&' : '?';
  return `${rendered}${sep}width=${width}&quality=75&resize=cover`;
}
