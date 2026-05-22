// ============================================================
// Circular image cropper — callback-based opener
// ============================================================
// 任意の画面から `openCropper(uri)` を呼ぶと、cropper 画面が
// modal-like に push される。ユーザーが「次へ」したら crop 後の
// uri を、cancel したら null を resolve する。
//
// router.push に param として uri を渡し、cropper 画面側は
// resolveCropper() で結果を返してから router.back() する設計。
//
// Safety nets:
//   - cropper screen の unmount 時にも resolveCropper(null) を呼ぶ
//     ので、ブラウザ back や refresh, deeplink 等で promise が宙ぶらりんに
//     ならない (caller の await が永久 hang しない)
//   - 二重 resolve は冪等に無視
//   - openCropper 自体に 60 秒の hard timeout を設けて、想定外の状況でも
//     必ず null で resolve するようにする
// ============================================================

import { router } from 'expo-router';

let pendingResolve: ((uri: string | null) => void) | null = null;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

// 内部 helper — pending を確実に flush する (二重呼びは安全)
function flush(value: string | null) {
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  if (pendingResolve) {
    const r = pendingResolve;
    pendingResolve = null;
    try { r(value); } catch (e) { console.warn('[imageCropper] resolve threw:', e); }
  }
}

// 画像 URI を渡すと cropper 画面を開いて、ユーザーが OK/cancel した croppedUri を返す。
// cancel または timeout の場合は null。
export function openCropper(sourceUri: string): Promise<string | null> {
  return new Promise((resolve) => {
    // 同時に開いてた前の Promise を clean up (二重起動防止)
    flush(null);
    pendingResolve = resolve;
    // 60 秒の hard timeout — どんなに想定外でも caller を hang させない
    pendingTimeout = setTimeout(() => {
      console.warn('[imageCropper] timed out after 60s — resolving null');
      flush(null);
    }, 60_000);
    try {
      router.push({
        pathname: '/image-cropper' as never,
        params: { uri: sourceUri } as never,
      });
    } catch (e) {
      console.warn('[imageCropper] router.push failed:', e);
      flush(null);
    }
  });
}

// cropper screen が結果を返すための内部 API。
// 「次へ」「戻る」「画面 unmount」のいずれからも呼ばれる可能性があり、
// 2 回以上呼ばれても安全。
export function resolveCropper(croppedUri: string | null) {
  flush(croppedUri);
}
