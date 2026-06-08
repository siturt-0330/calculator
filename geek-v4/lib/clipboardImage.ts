// ============================================================
// lib/clipboardImage.ts — クリップボードの画像を取得する
// ------------------------------------------------------------
// 「ネットでコピーした画像」をアイコン等に貼り付けるための共通ヘルパ。
//   - Web:    navigator.clipboard.read() で image/* の ClipboardItem を探し data URL 化。
//             (secure context + ユーザー操作 + clipboard-read 権限が必要。netlify は https)
//   - Native: expo-clipboard の hasImageAsync / getImageAsync (data URI を返す)。
// 取得できなければ null を返す (例外も握りつぶして null → UI 側で「画像が無い」案内)。
// 返す URI は data:URL なので、そのまま prepareImageUpload / openCropper に渡せる
// (web の blob: revoke 問題も起きない)。
// ============================================================
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { swallow } from './swallow';

// react-native の lib に ClipboardItem 型が無い環境でも通るよう最小型で受ける。
type WebClipboardItem = { types: string[]; getType: (type: string) => Promise<Blob> };
type WebClipboard = { read?: () => Promise<WebClipboardItem[]> };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('clipboard image read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * クリップボードに画像があれば data:URL を返す。無い / 取得不可なら null。
 * ボタン押下 (ユーザー操作) の中から呼ぶこと (web の権限要件)。
 */
export async function getClipboardImageUri(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      const clip = (
        globalThis as unknown as { navigator?: { clipboard?: WebClipboard } }
      ).navigator?.clipboard;
      if (!clip?.read) return null; // 非対応ブラウザ
      const items = await clip.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          const url = await blobToDataUrl(blob);
          return url.startsWith('data:image/') ? url : null;
        }
      }
      return null; // 画像は無い (テキスト等)
    }

    // Native (iOS / Android)
    const has = await Clipboard.hasImageAsync();
    if (!has) return null;
    const img = await Clipboard.getImageAsync({ format: 'png' });
    const data = img?.data ?? null;
    return data && data.startsWith('data:image/') ? data : null;
  } catch (e) {
    swallow('clipboardImage.get', e);
    return null;
  }
}
