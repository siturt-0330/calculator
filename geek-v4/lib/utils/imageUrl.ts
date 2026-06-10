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
 *
 * 注意 (2026-05 修正): `resize=cover` で **正方形** に center-crop したい場合は
 *   `opts.height` を `width` と同じ値で指定する (squareThumbedUrl 参照)。
 *
 * ★★ 重大バグ修正 (2026-06): height を省いて width だけ + resize=cover を渡すと、
 *   Supabase render endpoint は **幅だけを要求値に縮小して高さは元のまま** 返す。
 *   例: 元 1179x866 (横長) に width=480&resize=cover → 480x866 (aspect 0.55 に
 *   水平つぶれ)。さらに width=240 なら 240x866 (aspect 0.28 の激細)。これが
 *   - フィード写真が「縦長/細い」セルで表示される (getSize が 0.28 を測る)
 *   - 表示画像そのものが水平方向に潰れる (ProgressiveImage が潰れた bitmap を取得)
 *   の両方の真因だった。EXIF とは無関係 (元画像の EXIF は既に strip 済み)。
 *   resize=contain なら width だけでも比率を維持して比例縮小する
 *   (480x866→480x353 / 240→240x176)。よって **height 未指定なら contain を既定**
 *   にする。height 指定時 (正方形 avatar/icon) は従来どおり呼出側の resize を尊重。
 *   表示側の crop/fit は expo-image の contentFit が担うので contain ソースで問題ない。
 */
export function thumbedUrl(
  url: string | null | undefined,
  width = 720,
  opts: {
    quality?: number;
    format?: 'webp' | 'avif' | 'origin';
    height?: number;
    /** crop=cover / 全体を収める=contain。既定は height 有→cover, height 無→contain。 */
    resize?: 'cover' | 'contain';
  } = {},
): string {
  if (!url) return '';
  if (!url.includes(SUPABASE_PUBLIC_OBJECT)) return url;
  const rendered = url.replace(SUPABASE_PUBLIC_OBJECT, SUPABASE_PUBLIC_RENDER);
  if (/[?&]width=/.test(rendered)) return rendered;
  const quality = opts.quality ?? 75;
  const format = opts.format ?? 'webp';   // ★ デフォルトを WebP に (JPEG 比 25-30% 軽量)
  // ★ height 無しで cover を渡すと Supabase が高さを元のまま残し画像が潰れる (上記コメント)。
  //   height 指定 (正方形サムネ) のときだけ cover が正しく box を埋める。
  const resize = opts.resize ?? (opts.height ? 'cover' : 'contain');
  const sep = rendered.includes('?') ? '&' : '?';
  const heightPart = opts.height ? `&height=${opts.height}` : '';
  return `${rendered}${sep}width=${width}${heightPart}&quality=${quality}&resize=${resize}&format=${format}`;
}

/**
 * 円形 avatar (community icon / user avatar) 用に **正方形** に center-crop した
 * サムネ URL を返す。width = height = size で Supabase render endpoint に投げる。
 *
 * これを使うと、ソース画像が横長 (集合写真など) でも、サーバ側で正方形に
 * 切り出された画像が降ってくるので、円形 ViewBox での「異常な拡大」が消える。
 */
export function squareThumbedUrl(
  url: string | null | undefined,
  size: number,
  opts: { quality?: number; format?: 'webp' | 'avif' | 'origin' } = {},
): string {
  return thumbedUrl(url, size, { ...opts, height: size });
}

/**
 * コミュニティアイコン用の **正方形 contain** サムネ URL。
 *
 * squareThumbedUrl (=resize=cover) はロゴを中央 crop して「拡大されて切れる」原因に
 * なる。アイコンはロゴ全体が見えるべきなので resize=contain にし、円形 ViewBox 側でも
 * contentFit="contain" で表示する (components/ui/CommunityIcon.tsx)。
 * 余白にはアイコンの地色 (icon_color) が出るので「収めた」見た目が自然。
 */
export function iconThumbedUrl(
  url: string | null | undefined,
  size: number,
  opts: { quality?: number; format?: 'webp' | 'avif' | 'origin' } = {},
): string {
  return thumbedUrl(url, size, { ...opts, height: size, resize: 'contain' });
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
