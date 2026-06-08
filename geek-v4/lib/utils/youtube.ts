// ============================================================
// youtube — YouTube URL から video id を抽出する純関数ユーティリティ
// ------------------------------------------------------------
// 用途: 投稿本文 / source_url に貼られた YouTube リンクを検出し、
//       サムネイル表示・埋め込み再生・oEmbed タイトル取得に使う。
// 方針:
//   - React / react-native / supabase などに一切依存しない純関数のみ。
//     (jest が連鎖 import で落ちないよう、ロジックはここで完結させる)
//   - 対応 URL 形態:
//       youtube.com/watch?v=<id>      (クエリ順不同 / ?si= ?t= 等の付随パラメータ可)
//       youtu.be/<id>                 (短縮リンク)
//       youtube.com/shorts/<id>       (Shorts)
//       youtube.com/embed/<id>        (埋め込み)
//       youtube.com/v/<id>            (旧式埋め込み)
//       youtube.com/live/<id>         (ライブ恒久 URL)
//       m.youtube.com / music.youtube.com / 任意サブドメイン
//       www. の有無・http/https・末尾スラッシュ・フラグメント(#t=) を許容
//   - video id は厳密に [A-Za-z0-9_-]{11} (11 桁固定)。
//     これに合致しなければ (= YouTube でなければ) null を返す。
// 参考スタイル: lib/utils/extractUrl.ts (依存ゼロの純関数モジュール)
// ============================================================

/** YouTube の video id 形式: 11 桁の URL-safe Base64 風文字種 */
const VIDEO_ID_RE = '[A-Za-z0-9_-]{11}';

/**
 * youtube.com / youtu.be 系ホストにマッチするか判定する正規表現。
 * 任意サブドメイン (www. / m. / music. など) を許容し、
 * youtube.com / youtu.be のどちらかで終わるホストのみ通す。
 * (例: "notyoutube.com" や "youtube.com.evil.com" は弾く)
 */
const YT_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be)$/i;

/**
 * パスベース (/shorts/<id>, /embed/<id>, /v/<id>, /live/<id>, youtu.be/<id>) から
 * 11 桁 id を直接拾うための正規表現。
 * - youtu.be はホスト直下が id (youtu.be/<id>)。
 * - youtube.com 系は /shorts/ /embed/ /v/ /live/ の直後が id。
 */
const PATH_ID_RE = new RegExp(
  `(?:youtu\\.be/|/(?:shorts|embed|v|live)/)(${VIDEO_ID_RE})`,
  'i',
);

/** 文字列全体が 11 桁 video id か (前後に余分な文字が無いか) を確認 */
const EXACT_ID_RE = new RegExp(`^${VIDEO_ID_RE}$`, 'i');

/**
 * URL から YouTube の video id を抽出する。
 *
 * watch?v= / youtu.be / shorts / embed / v / live、クエリ付き (?si=...&t=...)、
 * m. / music. などのサブドメインを網羅して 11 桁の video id を取り出す。
 * YouTube でなければ (または id が 11 桁でなければ) null を返す。
 *
 * @param url 解析対象の URL 文字列
 * @returns `{ videoId }` もしくは null
 */
export function parseYouTube(url: string): { videoId: string } | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // スキームが無い裸 URL (例: "youtu.be/dQw4w9WgXcQ") も解釈できるよう補う。
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  // http / https 以外 (mailto: など) は対象外。
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname;
  if (!YT_HOST_RE.test(host)) return null;

  const isShortHost = /(?:^|\.)youtu\.be$/i.test(host);

  // 1) watch?v=<id> (youtube.com 系のみ。順不同・付随パラメータ可)
  if (!isShortHost) {
    const v = parsed.searchParams.get('v');
    if (v && EXACT_ID_RE.test(v)) return { videoId: v };
  }

  // 2) パスベース (youtu.be/<id>, /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>)
  const pathSource = `${host}${parsed.pathname}`;
  const m = PATH_ID_RE.exec(pathSource);
  if (m && m[1]) return { videoId: m[1] };

  // 3) youtu.be 直下が素の id のみのケース (上の正規表現でカバー済みだが念のため)
  if (isShortHost) {
    const seg = parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    if (EXACT_ID_RE.test(seg)) return { videoId: seg };
  }

  return null;
}

/**
 * video id からサムネイル画像 URL を返す。
 * hqdefault.jpg はどの動画にも必ず存在する無難なサイズを採用。
 *
 * @param videoId 11 桁の video id
 * @returns `https://i.ytimg.com/vi/<id>/hqdefault.jpg`
 */
export function youTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * video id から正規の watch URL を返す。
 *
 * @param videoId 11 桁の video id
 * @returns `https://www.youtube.com/watch?v=<id>`
 */
export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * 任意の YouTube URL から oEmbed エンドポイント URL を返す (タイトル取得用)。
 *
 * @param url 元の YouTube URL (エンコードして埋め込む)
 * @returns `https://www.youtube.com/oembed?url=<encoded>&format=json`
 */
export function youTubeOEmbedUrl(url: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
}
