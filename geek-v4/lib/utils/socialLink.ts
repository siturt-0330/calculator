// ============================================================
// socialLink — Instagram / Facebook の URL を判定する純関数ユーティリティ
// ------------------------------------------------------------
// 用途: 投稿本文 / source_url に貼られた IG/FB リンクを検出し、
//       「ブランドカード」(アイコン＋プラットフォーム名＋タップで開く＋URL非表示)
//       に使う。YouTube (youtube.ts) と同じ「メタ取得が失敗してもカード化できる」方針。
//
// ★調査結果(重要): Meta は IG/FB のサムネ取得をほぼ全面ブロックしている。
//   - 2020/10 で tokenless oEmbed 廃止、2025/11 でトークン版 oEmbed も
//     thumbnail/title を返さなくなった (Meta 自身が「OGP をスクレイプしろ」と案内)。
//   - instagram.com / facebook.com は非ブラウザ UA や datacenter IP に login 壁を返す。
//     Supabase Edge(Deno Deploy) は datacenter IP のため og:image 取得は基本失敗する。
//   - Signal / Telegram / Discord ですらサムネを出せていない。
//   → よって本モジュールは「サムネは取れたら出す・通常は出ない」前提で、
//      最低限ブランドカードを成立させる情報 (platform / canonicalUrl / kind) を返す。
//
// 方針:
//   - React / RN / supabase に一切依存しない純関数のみ (jest 連鎖 import 対策)。
//   - host はサフィックス固定の正規表現で lookalike (instagram.com.evil.com 等) を弾く。
//   - canonicalUrl は tracking param を落として再構築 (openUrl 用)。
//   - 判定できなければ null (= 通常の OGP/フォールバック経路に流す)。
// 参考: lib/utils/youtube.ts
// ============================================================

/** カードに渡す判定結果。サムネ非依存でカードを成立させるのに必要な最小情報。 */
export type SocialPlatform = 'instagram' | 'facebook';

export type SocialLinkKind =
  | 'post'
  | 'reel'
  | 'tv'
  | 'video'
  | 'photo'
  | 'story'
  | 'profile'
  | 'share'
  | 'link';

export type SocialLink = {
  platform: SocialPlatform;
  kind: SocialLinkKind;
  /** タップで開く正規 URL (tracking 除去済) */
  canonicalUrl: string;
  /** OG title 未取得時にカードへ出すブランド名 ('Instagram' / 'Facebook') */
  label: string;
  /** 動画系 (▶ オーバーレイ対象) か */
  isVideo: boolean;
};

// host: 任意サブドメイン (www. / m. / web. / mbasic.) を許容しつつ末尾固定。
const IG_HOST_RE = /^(?:[a-z0-9-]+\.)*instagram\.com$/i;
const FB_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:facebook\.com|fb\.watch|fb\.me)$/i;

// IG shortcode は URL-safe な文字種 (長さは可変 — YouTube の 11 桁固定とは違う)。
const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;

// 単一セグメントでもプロフィール扱いしない予約パス。
const IG_RESERVED = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct',
  'directs', 'about', 'developer', 'legal', 'web', 'emails', 'session',
]);

/** スキーム補完 + http(s) 限定で URL を作る。失敗時 null。(youtube.ts と同方針) */
function toUrl(url: string): URL | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed;
}

/** pathname を "/" 区切りで空要素を除いた配列に。 */
function segments(pathname: string): string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

/**
 * Instagram の URL を判定する。
 * 対応: /p/<code>/, /reel|reels/<code>/, /tv/<code>/, /stories/<user>/<id>,
 *       /<username>/ (プロフィール)。host が instagram.com 系ならパス不明でも
 *       (ブランドカードを出すため) kind:'link' で返す。非 IG は null。
 */
export function parseInstagram(url: string): SocialLink | null {
  const u = toUrl(url);
  if (!u || !IG_HOST_RE.test(u.hostname)) return null;

  const segs = segments(u.pathname);
  const first = segs[0]?.toLowerCase();

  // /p/<code>/ , /reel|reels/<code>/ , /tv/<code>/
  if (first === 'p' || first === 'reel' || first === 'reels' || first === 'tv') {
    const code = segs[1];
    if (code && SHORTCODE_RE.test(code)) {
      const kind: SocialLinkKind =
        first === 'tv' ? 'tv' : first === 'p' ? 'post' : 'reel';
      const pathSeg = first === 'reels' ? 'reel' : first;
      return {
        platform: 'instagram',
        kind,
        canonicalUrl: `https://www.instagram.com/${pathSeg}/${code}/`,
        label: 'Instagram',
        isVideo: kind === 'reel' || kind === 'tv',
      };
    }
  }

  // /stories/<username>/<id>
  if (first === 'stories' && segs[1]) {
    const user = segs[1];
    const sid = segs[2];
    return {
      platform: 'instagram',
      kind: 'story',
      canonicalUrl: sid
        ? `https://www.instagram.com/stories/${user}/${sid}/`
        : `https://www.instagram.com/stories/${user}/`,
      label: 'Instagram',
      isVideo: false,
    };
  }

  // /<username>/ プロフィール (予約語でない単一セグメント)
  const profile = segs[0];
  if (profile && segs.length === 1 && !IG_RESERVED.has(profile.toLowerCase())) {
    return {
      platform: 'instagram',
      kind: 'profile',
      canonicalUrl: `https://www.instagram.com/${profile}/`,
      label: 'Instagram',
      isVideo: false,
    };
  }

  // host は IG だがパス不明 → IG と分かるのでブランドカードは出す。
  return {
    platform: 'instagram',
    kind: 'link',
    canonicalUrl: `https://www.instagram.com${u.pathname}`,
    label: 'Instagram',
    isVideo: false,
  };
}

/**
 * Facebook の URL を判定する。
 * 対応: /watch/?v=, /reel/<id>, /<page>/posts/<id>, /<page>/videos/<id>,
 *       /photo.php?fbid=, /photo/?fbid=, /story.php|permalink.php?story_fbid=&id=,
 *       /share/(p|r|v)/<token>/, fb.watch/<code>, fb.me/<code>。
 *       host が facebook 系ならパス不明でも kind:'link' で返す。非 FB は null。
 */
export function parseFacebook(url: string): SocialLink | null {
  const u = toUrl(url);
  if (!u || !FB_HOST_RE.test(u.hostname)) return null;

  const host = u.hostname.toLowerCase();
  const base = 'https://www.facebook.com';

  // fb.watch/<code> / fb.me/<code> — 短縮(クライアントでは解決不可)。ブランドカードのみ。
  if (/(?:^|\.)fb\.watch$/i.test(host) || /(?:^|\.)fb\.me$/i.test(host)) {
    return {
      platform: 'facebook',
      kind: 'link',
      canonicalUrl: `${u.origin}${u.pathname}`,
      label: 'Facebook',
      isVideo: /fb\.watch$/i.test(host),
    };
  }

  const segs = segments(u.pathname);
  const first = segs[0]?.toLowerCase();

  // /watch/?v= or /watch?v=
  if (first === 'watch') {
    const v = u.searchParams.get('v');
    return {
      platform: 'facebook',
      kind: 'video',
      canonicalUrl: v ? `${base}/watch/?v=${encodeURIComponent(v)}` : `${base}/watch/`,
      label: 'Facebook',
      isVideo: true,
    };
  }

  // /reel/<id>
  if (first === 'reel' && segs[1]) {
    return {
      platform: 'facebook',
      kind: 'reel',
      canonicalUrl: `${base}/reel/${segs[1]}/`,
      label: 'Facebook',
      isVideo: true,
    };
  }

  // /share/(p|r|v)/<token>/
  if (first === 'share') {
    return {
      platform: 'facebook',
      kind: 'share',
      canonicalUrl: `${base}${u.pathname}`,
      label: 'Facebook',
      isVideo: segs[1]?.toLowerCase() === 'v',
    };
  }

  // /photo.php?fbid= , /photo/?fbid=
  if (first === 'photo.php' || first === 'photo') {
    const fbid = u.searchParams.get('fbid');
    return {
      platform: 'facebook',
      kind: 'photo',
      canonicalUrl: fbid ? `${base}/photo/?fbid=${encodeURIComponent(fbid)}` : `${base}${u.pathname}`,
      label: 'Facebook',
      isVideo: false,
    };
  }

  // /story.php , /permalink.php ?story_fbid=&id=
  if (first === 'story.php' || first === 'permalink.php') {
    const sfb = u.searchParams.get('story_fbid');
    const id = u.searchParams.get('id');
    const q = sfb && id
      ? `?story_fbid=${encodeURIComponent(sfb)}&id=${encodeURIComponent(id)}`
      : '';
    return {
      platform: 'facebook',
      kind: 'post',
      canonicalUrl: `${base}/${first}${q}`,
      label: 'Facebook',
      isVideo: false,
    };
  }

  // /<page>/videos/<id> , /<page>/posts/<id> , /groups/<gid>/posts|permalink/<id>
  if (segs.includes('videos')) {
    return { platform: 'facebook', kind: 'video', canonicalUrl: `${base}${u.pathname}`, label: 'Facebook', isVideo: true };
  }
  if (segs.includes('posts') || segs.includes('permalink')) {
    return { platform: 'facebook', kind: 'post', canonicalUrl: `${base}${u.pathname}`, label: 'Facebook', isVideo: false };
  }

  // host は FB だがパス不明 → FB と分かるのでブランドカードは出す。
  return {
    platform: 'facebook',
    kind: 'link',
    canonicalUrl: `${base}${u.pathname}`,
    label: 'Facebook',
    isVideo: false,
  };
}

/**
 * IG → FB の順で判定する dispatcher。YouTube やその他のドメインは null。
 * LinkPreviewCard はこの 1 個を呼べば良い。
 */
export function parseSocialLink(url: string): SocialLink | null {
  return parseInstagram(url) ?? parseFacebook(url);
}
