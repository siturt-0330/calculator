import { Linking, Platform } from 'react-native';
import { useToastStore } from '../stores/toastStore';

// ============================================================
// safeOpenUrl
// ============================================================
// アプリ内のあらゆる Linking.openURL 呼び出しの共通入口。
// 旧コード ( `.catch(() => {})` 直書き) は失敗を握りつぶしていたので、
// ユーザーが「タップしたのに何も起きない」という最悪の体感になっていた。
//
// この helper では:
//   1. http(s) / mailto / tel / app:// 等の許可済みスキームだけを許可
//   2. javascript: / data: / file: / vbscript: を弾く (XSS / 任意コード起点)
//   3. 失敗時に toast を 1 度だけ表示 (silent fail を絶対にしない)
//
// 呼び出し側は `await safeOpenUrl(url)` で boolean を受け取れる。
// 既存 .catch(() => {}) はすべてこの関数経由に置換していくこと。
// ============================================================

const ALLOWED_SCHEMES = new Set([
  'http:', 'https:',
  'mailto:', 'tel:', 'sms:',
  // app 内 deep link
  'geek:',
  // iOS / Android settings 等
  'app-settings:', 'app-prefs:',
  // Maps
  'comgooglemaps:', 'maps:',
  // Obsidian custom scheme (lib/obsidian.ts)
  'obsidian:',
]);

function isSchemeAllowed(url: string): boolean {
  try {
    // URL ctor を使うと相対 URL でも throw する → 安心
    const parsed = new URL(url);
    return ALLOWED_SCHEMES.has(parsed.protocol);
  } catch {
    // URL ctor が無い古い Safari は (ほぼ無いが) 雑に prefix check で fallback
    const lower = url.toLowerCase();
    for (const s of ALLOWED_SCHEMES) {
      if (lower.startsWith(s)) return true;
    }
    return false;
  }
}

export type SafeOpenUrlOptions = {
  /** 失敗時のトースト文言 (default: 'リンクを開けませんでした') */
  errorMessage?: string;
  /** false にすると失敗時の toast を出さない (呼び出し側で独自処理する場合) */
  showToastOnError?: boolean;
};

export async function safeOpenUrl(
  url: string | null | undefined,
  opts: SafeOpenUrlOptions = {},
): Promise<boolean> {
  const { errorMessage = 'リンクを開けませんでした', showToastOnError = true } = opts;

  if (!url) {
    if (showToastOnError) useToastStore.getState().show(errorMessage, 'error');
    return false;
  }
  if (!isSchemeAllowed(url)) {
    console.warn('[safeOpenUrl] blocked scheme:', url.slice(0, 32));
    if (showToastOnError) useToastStore.getState().show(errorMessage, 'error');
    return false;
  }
  try {
    // Web では Linking.canOpenURL が常に true を返すため check スキップ。
    // Native では mail client が無いと canOpenURL=false になるので事前 check。
    if (Platform.OS !== 'web') {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        if (showToastOnError) useToastStore.getState().show(errorMessage, 'error');
        return false;
      }
    }
    await Linking.openURL(url);
    return true;
  } catch (e) {
    console.warn('[safeOpenUrl] openURL failed:', e);
    if (showToastOnError) useToastStore.getState().show(errorMessage, 'error');
    return false;
  }
}
