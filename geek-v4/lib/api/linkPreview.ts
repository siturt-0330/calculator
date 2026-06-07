import { supabase } from '../supabase';

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  fetched_at: string;
};

// DB キャッシュから OG プレビューを取得
export async function fetchCachedPreview(url: string): Promise<LinkPreview | null> {
  const { data, error } = await supabase
    .from('post_link_previews')
    .select('url, title, description, image_url, site_name, fetched_at')
    .eq('url', url)
    .maybeSingle();
  if (error) return null;
  return data as LinkPreview | null;
}

// ------------------------------------------------------------
// edge function 'og-fetch' のレスポンス型 (server 側で truncate / cache 済)
// ------------------------------------------------------------
type OgFetchResponse = {
  url?: string;
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  site_name?: string | null;
  fetched_at?: string | null;
};

// edge function 経由でサーバーサイド取得 (PRIMARY path)。
// title か image_url のどちらかが取れたときのみ LinkPreview を返す。
// 取得できなければ null (= caller 側で fallback へ)。
async function fetchViaEdge(url: string): Promise<LinkPreview | null> {
  try {
    const { data, error } = await supabase.functions.invoke('og-fetch', {
      body: { url },
    });
    if (error || !data || typeof data !== 'object') return null;
    const d = data as OgFetchResponse;
    const title = d.title ?? null;
    const imageUrl = d.image_url ?? null;
    // 最低でも title か image が無ければ「取得失敗」扱いにして fallback させる
    if (!title && !imageUrl) return null;
    return {
      url,
      title,
      description: d.description ?? null,
      image_url: imageUrl,
      site_name: d.site_name ?? null,
      fetched_at: d.fetched_at ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function fetchAndCachePreview(url: string): Promise<LinkPreview | null> {
  if (!/^https?:\/\//.test(url)) return null;
  // キャッシュ確認
  const cached = await fetchCachedPreview(url);
  if (cached) {
    const fetchedAt = new Date(cached.fetched_at).getTime();
    const ageDays = (Date.now() - fetchedAt) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) return cached;
  }

  // 唯一の取得経路: GEEK サーバー (Edge Function 'og-fetch') がページを fetch して
  // OG メタを返す。og-fetch が service_role で post_link_previews に upsert 済みなので
  // client からの upsert はしない (0036 の rate-limit trigger に当たる & 冗長)。
  // ★ 第三者プロキシ (microlink 等) は使わない — ページ URL を外部に渡さず、
  //   生 image URL も受け取らない (= 閲覧者IP漏れ経路を作らない / deep-research 結論)。
  const fromEdge = await fetchViaEdge(url);
  if (fromEdge) return fromEdge;

  // og-fetch が未 deploy / エラー / メタ空 のとき: 期限切れでも cache があれば返す
  // (壊れたカードよりマシ)。cache も無ければ null → LinkPreviewCard は出典バーのみ表示。
  return cached;
}
