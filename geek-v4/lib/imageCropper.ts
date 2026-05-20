// ============================================================
// Circular image cropper — callback-based opener
// ============================================================
// 任意の画面から `openCropper(uri)` を呼ぶと、cropper 画面が
// modal-like に push される。ユーザーが「次へ」したら crop 後の
// uri を、cancel したら null を resolve する。
//
// router.push に param として uri を渡し、cropper 画面側は
// resolveCropper() で結果を返してから router.back() する設計。
// ============================================================

import { router } from 'expo-router';

let pendingResolve: ((uri: string | null) => void) | null = null;

// 画像 URI を渡すと cropper 画面を開いて、ユーザーが OK/cancel した croppedUri を返す。
// cancel の場合は null。
export function openCropper(sourceUri: string): Promise<string | null> {
  return new Promise((resolve) => {
    // 同時に開いてた前の Promise を clean up (二重起動防止)
    if (pendingResolve) {
      const prev = pendingResolve;
      pendingResolve = null;
      prev(null);
    }
    pendingResolve = resolve;
    router.push({
      pathname: '/image-cropper' as never,
      params: { uri: sourceUri } as never,
    });
  });
}

// cropper screen が結果を返すための内部 API
export function resolveCropper(croppedUri: string | null) {
  if (pendingResolve) {
    const r = pendingResolve;
    pendingResolve = null;
    r(croppedUri);
  }
}
