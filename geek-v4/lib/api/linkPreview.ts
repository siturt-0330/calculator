import { supabase } from '../supabase';

// ------------------------------------------------------------
// 画像プロキシ (og-image Edge Function) — 匿名性保護の要
// ------------------------------------------------------------
// OG/サムネ画像を GEEK サーバー経由で配信し、閲覧者の IP/UA/Referer を相手ホスト
// (YouTube 等) に一切渡さない。og-image 未 deploy / 失敗時は 1x1 透明PNG が返るため、
// クライアントは「画像なし」として安全に degrade する (リーク無し)。
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export function ogImageProxyUrl(raw: string | null | undefined): string | null {
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  if (!SUPABASE_URL) return raw; // 構成不備時はそのまま (劣化動作)
  if (raw.includes('/functions/v1/og-image')) return raw; // 二重プロキシ防止
  return `${SUPABASE_URL}/functions/v1/og-image?url=${encodeURIComponent(raw)}`;
}

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

// Public な無料 OG プロキシ経由でメタを取得 (Edge Function 未 deploy 時の fallback)
// (Supabase Edge Function 'og-fetch' が deploy されればそちらが優先)
const META_PROXY = 'https://api.microlink.io';

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

  // PRIMARY: GEEK サーバー (Edge Function) がページを fetch して OG メタを返す。
  // edge function 側で post_link_previews に upsert 済みなので、ここでは upsert しない。
  const fromEdge = await fetchViaEdge(url);
  if (fromEdge) return fromEdge;

  // FALLBACK: edge function が未 deploy / エラー / 空のとき。
  // microlink.io で取得 (匿名で月50req/secのフリー枠) + client から upsert。
  try {
    const r = await fetch(`${META_PROXY}/?url=${encodeURIComponent(url)}`);
    if (!r.ok) return cached;
    const j = await r.json() as {
      status?: string;
      data?: {
        title?: string;
        description?: string;
        image?: { url?: string };
        publisher?: string;
      };
    };
    if (j.status !== 'success' || !j.data) return cached;
    const preview: LinkPreview = {
      url,
      title: j.data.title ?? null,
      description: j.data.description ?? null,
      image_url: j.data.image?.url ?? null,
      site_name: j.data.publisher ?? null,
      fetched_at: new Date().toISOString(),
    };
    // DB upsert (失敗しても無視)
    await supabase.from('post_link_previews').upsert({
      url,
      title: preview.title,
      description: preview.description,
      image_url: preview.image_url,
      site_name: preview.site_name,
      fetched_at: preview.fetched_at,
    }).select();
    return preview;
  } catch {
    return cached;
  }
}
