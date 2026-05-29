// ============================================================
// extractFirstUrl — テキストから最初の http(s) URL を 1 つ抽出
// ------------------------------------------------------------
// 用途: 投稿本文に貼られた URL を OG リンクプレビュー (LinkPreviewCard)
//       のカード対象として拾う。source_url が無い投稿でも本文中の URL を
//       自動でカード化するために使う。
// 方針:
//   - http:// または https:// で始まる連続文字列を 1 つだけ取る (先頭優先)。
//   - 日本語文中では URL 直後に句読点が続きやすいので、末尾の代表的な
//     文末記号・全角閉じ記号は URL から除外する。
//   - URL を半角括弧 () で囲んだ場合に末尾 ')' を巻き込まないよう、
//     閉じ括弧が開き括弧より多いときだけ末尾 ')' を 1 つ落とす
//     (Wikipedia の "..._(disambiguation)" のような正当な ')' は残す)。
// ============================================================

// 空白・山括弧・引用符・バッククォート以外を URL 本体とみなす
const URL_RE = /https?:\/\/[^\s<>"'`]+/i;

// URL 末尾に紛れ込みやすい文末記号 (URL の一部でない可能性が高い)
const TRAILING_PUNCT_RE = /[.,;:!?。、！？〕）】」』］]+$/u;

export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = URL_RE.exec(text);
  if (!m) return null;
  let url = m[0].replace(TRAILING_PUNCT_RE, '');
  while (
    url.endsWith(')') &&
    url.split(')').length - 1 > url.split('(').length - 1
  ) {
    url = url.slice(0, -1).replace(TRAILING_PUNCT_RE, '');
  }
  return url.length > 0 ? url : null;
}
