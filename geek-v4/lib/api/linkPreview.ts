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

// Public な無料 OG プロキシ経由でメタを取得 + DB にキャッシュ
// (Supabase Edge Function 等を立てる前の暫定対応)
const META_PROXY = 'https://api.microlink.io';

export async function fetchAndCachePreview(url: string): Promise<LinkPreview | null> {
  if (!/^https?:\/\//.test(url)) return null;
  // キャッシュ確認
  const cached = await fetchCachedPreview(url);
  if (cached) {
    const fetchedAt = new Date(cached.fetched_at).getTime();
    const ageDays = (Date.now() - fetchedAt) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) return cached;
  }

  // microlink.io で取得 (匿名で月50req/secのフリー枠)
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
