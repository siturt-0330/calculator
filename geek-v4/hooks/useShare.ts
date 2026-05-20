import { Platform, Share as RNShare } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useToastStore } from '../stores/toastStore';
import { impact, Haptics } from '../lib/haptics';

// カスタムスキーム (geek://post/xxx) → 実 Web URL に変換
function toShareableUrl(input: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (input.startsWith('geek://')) {
      const path = input.replace('geek://', '');
      return `${window.location.origin}/${path}`;
    }
    if (input.startsWith('/')) return `${window.location.origin}${input}`;
    return input;
  }
  return input;
}

export function useShare() {
  const { show } = useToastStore();

  const share = async (title: string, rawUrl: string) => {
    impact(Haptics.ImpactFeedbackStyle.Light);
    const url = toShareableUrl(rawUrl);
    const message = `${title}\n${url}`;

    // Web
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      // Web Share API
      if (nav && typeof (nav as Navigator).share === 'function') {
        try {
          await (nav as Navigator).share!({ title, url, text: title });
          return;
        } catch (e) {
          // AbortError (ユーザーがキャンセル) は無視
          const err = e as { name?: string };
          if (err?.name === 'AbortError') return;
          // それ以外はクリップボードへフォールバック
        }
      }
      // クリップボードへフォールバック
      try {
        if (nav && (nav as Navigator).clipboard && typeof (nav as Navigator).clipboard.writeText === 'function') {
          await (nav as Navigator).clipboard.writeText(url);
        } else {
          await Clipboard.setStringAsync(url);
        }
        show('🔗 リンクをコピーしました', 'success');
      } catch {
        show('共有に失敗しました', 'error');
      }
      return;
    }

    // ネイティブ
    try {
      const result = await RNShare.share({ title, url, message });
      if (result.action === RNShare.dismissedAction) {
        // ユーザーキャンセル: 何もしない
      }
    } catch (e) {
      // フォールバック: クリップボード
      try {
        await Clipboard.setStringAsync(url);
        show('🔗 リンクをコピーしました', 'success');
      } catch {
        show('共有に失敗しました', 'error');
      }
    }
  };

  return { share };
}
