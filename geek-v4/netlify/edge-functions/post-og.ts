// ============================================================
// post-og — 投稿 URL の共有プレビュー (OG メタ) を bot にだけ配信する Edge Function
// ============================================================
// 課題: GEEK は SPA なので /post/<id> も index.html を返す。LINE / X / iMessage /
//   Discord 等のリンクプレビュークローラは JS を実行しないため、共有された投稿が
//   「ただのサイト名」にしかならず、何の投稿か受信側で分からなかった (ユーザー要望)。
//
// 動作:
//   1. /post/<uuid> への リクエストのうち、UA がプレビュークローラのものだけ処理
//      (人間のブラウザは context.next() で従来どおり SPA へ)
//   2. Supabase REST (anon key) で該当投稿の title / content / media_urls を取得
//      — RLS が可視性を裁くので、非公開投稿は 0 行 = プレビュー無し (情報漏れなし)
//      — author 系の列は一切 select しない (匿名 SNS: 共有プレビューに作者情報を出さない)
//   3. og:title / og:description / og:image 入りの最小 HTML を返す
//
// fail-secure: id が UUID でない (/post/create 等) / fetch 失敗 / 投稿なし → context.next()
// ============================================================

// EXPO_PUBLIC_* は Netlify dashboard に設定済み (netlify.toml 冒頭コメント参照)。
// 万一 env が無くても壊れないよう public-safe な値を fallback として固定する
// (anon key はクライアント bundle にも inline される公開値)。
const SUPABASE_URL =
  Deno.env.get('EXPO_PUBLIC_SUPABASE_URL') ?? 'https://migpiwdlpwpvehzvdjyh.supabase.co';
const SUPABASE_ANON_KEY =
  Deno.env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') ??
  'sb_publishable_qUe9WLya6BdSnBWjHQGMWw_hgp7FP67';

// リンクプレビュー専用クローラの UA。
// ※ facebookexternalhit は LINE (line-poker) と iMessage も名乗る事実上の標準。
// ※ 汎用 "bot" では Googlebot まで巻き込み cloaking 扱いのリスクがあるため、
//   プレビュー用途のものだけを列挙する。
const PREVIEW_BOT_RE =
  /facebookexternalhit|facebot|twitterbot|line-poker|linespider|slackbot|discordbot|telegrambot|whatsapp|skypeuripreview|pinterestbot|vkshare|redditbot|embedly|iframely|linkedinbot/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 改行/連続空白を畳んで n 文字に丸める */
function excerpt(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}

type PostRow = {
  id: string;
  title: string | null;
  content: string | null;
  media_urls: string[] | null;
};

export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const ua = request.headers.get('user-agent') ?? '';
  if (!PREVIEW_BOT_RE.test(ua)) return context.next();

  const url = new URL(request.url);
  // /post/<id> の <id> 部分。 /post/create や /post/comment は UUID でないので素通し。
  const id = url.pathname.split('/').filter(Boolean)[1] ?? '';
  if (!UUID_RE.test(id)) return context.next();

  let post: PostRow | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?select=id,title,content,media_urls&id=eq.${id}&limit=1`,
      {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (res.ok) {
      const rows = (await res.json()) as PostRow[];
      post = rows[0] ?? null;
    }
  } catch {
    /* fail-secure: SPA へ素通し */
  }
  if (!post) return context.next();

  const rawTitle = post.title?.trim() || excerpt(post.content ?? '', 48) || 'GEEK の投稿';
  const rawDesc = excerpt(post.content ?? '', 140) || 'GEEK で共有された投稿';
  const image = Array.isArray(post.media_urls) ? post.media_urls.find((u) => /^https:\/\//.test(u)) : undefined;

  const title = escapeHtml(rawTitle);
  const desc = escapeHtml(rawDesc);
  const canonical = escapeHtml(`${url.origin}/post/${id}`);

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${title} | GEEK</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="GEEK">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
<meta name="description" content="${desc}">
</head>
<body>
<p><a href="${canonical}">${title} — GEEK で見る</a></p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // クローラ向けは 5 分 / CDN 10 分キャッシュ (編集の反映を速めに)
      'cache-control': 'public, max-age=300, s-maxage=600',
    },
  });
};
