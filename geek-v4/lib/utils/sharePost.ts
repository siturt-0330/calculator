import { Share, Linking, Platform } from 'react-native';

let Clipboard: { setString: (text: string) => void } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Clipboard = require('@react-native-clipboard/clipboard').default;
} catch {
  // @react-native-clipboard/clipboard が存在しない環境では null のまま
  Clipboard = null;
}

const BASE_URL = 'https://geek-app.netlify.app';

export interface ShareablePost {
  id: string;
  title?: string | null;
  content?: string | null;
  tags?: string[] | null;
}

function buildPostUrl(postId: string): string {
  return `${BASE_URL}/post/${encodeURIComponent(postId)}`;
}

function buildShareText(post: ShareablePost): string {
  const raw = post.title?.trim() || post.content?.trim() || '';
  const body = raw.length > 100 ? raw.slice(0, 100) + '…' : raw;
  const tagLine =
    post.tags && post.tags.length > 0
      ? ' ' + post.tags.map((t) => `#${t}`).join(' ')
      : '';
  return `Geek で見る${body ? ': ' + body : ''}${tagLine}`;
}

/**
 * ネイティブ OS のシェアシートを開き、投稿 URL と短いテキストをシェアする。
 * iOS/Android ではシステムシートから任意のアプリへ転送できる。
 * Web では Web Share API を使い、未対応ブラウザでは URL を直接開く。
 *
 * @param post シェア対象の投稿情報
 */
export async function sharePost(post: ShareablePost): Promise<void> {
  const url = buildPostUrl(post.id);
  const message = buildShareText(post);

  try {
    if (Platform.OS === 'web') {
      // Web Share API (best-effort)
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: post.title ?? 'Geek', text: message, url });
      } else {
        await Linking.openURL(url);
      }
      return;
    }

    await Share.share(
      {
        message: Platform.OS === 'android' ? `${message}\n${url}` : message,
        url, // iOS only; Android ignores this field
        title: post.title ?? 'Geek の投稿',
      },
      {
        dialogTitle: '投稿をシェア',
        subject: post.title ?? 'Geek の投稿',
      },
    );
  } catch (err) {
    // AbortError / DOMException (Web Share) もしくは "User did not share" (RN iOS)
    // のいずれもユーザーがキャンセルしただけ — 呼び出し側に伝えない
    if (err instanceof Error) {
      const name = err.name; // AbortError, NotAllowedError
      const msg = err.message;
      if (
        name === 'AbortError' ||
        name === 'NotAllowedError' ||
        msg === 'User did not share' ||
        msg === 'Share was cancelled'
      ) {
        return;
      }
    }
    throw err;
  }
}

/**
 * X (Twitter) の Web Intent をデフォルトブラウザで開き、投稿をツイートできるようにする。
 *
 * @param post シェア対象の投稿情報
 * @throws ブラウザで URL を開けない場合
 */
export async function shareToX(post: ShareablePost): Promise<void> {
  const url = buildPostUrl(post.id);
  const text = buildShareText(post);

  const params = new URLSearchParams({ text, url });
  const intentUrl = `https://twitter.com/intent/tweet?${params.toString()}`;

  const canOpen = await Linking.canOpenURL(intentUrl);
  if (!canOpen) {
    throw new Error('X (Twitter) を開けませんでした。ブラウザを確認してください。');
  }
  await Linking.openURL(intentUrl);
}

/**
 * LINE の URL スキームを使って投稿リンクを LINE でシェアする。
 * LINE アプリがインストールされていない場合は LINE の Web シェアページを開く。
 *
 * @param post シェア対象の投稿情報
 * @throws URL を開けない場合
 */
export async function shareToLINE(post: ShareablePost): Promise<void> {
  const url = buildPostUrl(post.id);
  const text = buildShareText(post);
  const shareText = `${text}\n${url}`;

  // LINE アプリ用 URL スキーム
  const lineAppUrl = `line://msg/text/${encodeURIComponent(shareText)}`;
  // LINE Web シェア (アプリ未導入時のフォールバック)
  const lineWebUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

  const canOpenApp = await Linking.canOpenURL(lineAppUrl);
  if (canOpenApp) {
    await Linking.openURL(lineAppUrl);
  } else {
    await Linking.openURL(lineWebUrl);
  }
}

/**
 * 投稿のディープリンク URL をシステムクリップボードにコピーする。
 * Clipboard モジュールが利用できない場合またはエラー時は false を返す。
 *
 * @param post コピー対象の投稿情報
 * @returns コピー成功時 true / Clipboard 未対応またはエラー時 false
 */
export function copyPostLink(post: ShareablePost): boolean {
  if (!Clipboard) return false;
  try {
    const url = buildPostUrl(post.id);
    Clipboard.setString(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * 外部サイトに貼り付けられる HTML の iframe 埋め込みコードを返す。
 *
 * @param post 埋め込み対象の投稿情報
 * @returns iframe HTML 文字列
 */
export function getEmbedCode(post: ShareablePost): string {
  const src = getEmbedPreviewUrl(post.id);
  return `<iframe src="${src}" width="100%" height="400" frameborder="0" allowfullscreen loading="lazy" title="Geek 埋め込み投稿"></iframe>`;
}

/**
 * 埋め込み用プレビューページの URL を返す。
 *
 * @param postId 投稿 ID
 * @returns 埋め込みプレビュー URL
 */
export function getEmbedPreviewUrl(postId: string): string {
  return `${BASE_URL}/embed/post/${encodeURIComponent(postId)}`;
}
