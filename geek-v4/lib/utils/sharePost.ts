import { Share, Linking, Platform } from 'react-native';

let Clipboard: { setString: (text: string) => void } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Clipboard = require('@react-native-clipboard/clipboard').default;
} catch {
  // Clipboard not available; copyPostLink will return false
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
  return `${BASE_URL}/post/${postId}`;
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
 * Opens the native OS share sheet with the post URL and a short text snippet.
 * On iOS/Android the system sheet allows forwarding to any installed app.
 * On web this is a no-op (web Share API would require a separate path).
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
    // AbortError = user dismissed share sheet — not a real error
    if (err instanceof Error && err.message === 'User did not share') return;
    throw err;
  }
}

/**
 * Opens X (Twitter) web intent in the default browser so the user can tweet the post.
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
 * Copies the post's deep-link URL to the system clipboard.
 * Returns true on success, false if Clipboard is unavailable or an error occurs.
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
 * Returns an HTML iframe snippet that can be pasted into external websites
 * to embed this post.
 */
export function getEmbedCode(post: ShareablePost): string {
  const src = getEmbedPreviewUrl(post.id);
  return `<iframe src="${src}" width="100%" height="400" frameborder="0" allowfullscreen loading="lazy" title="Geek 埋め込み投稿"></iframe>`;
}

/**
 * Returns the URL of the embeddable post preview page.
 */
export function getEmbedPreviewUrl(postId: string): string {
  return `${BASE_URL}/embed/post/${postId}`;
}
