// ============================================================
// Circular image cropper — callback-based opener
// ============================================================
// 任意の画面から `openCropper(uri)` を呼ぶと、cropper 画面が
// modal-like に push される。ユーザーが「次へ」したら crop 後の
// uri を、cancel したら null を resolve する。
//
// router.push に **ID だけ** を param として渡し、cropper 画面側は
// `consumePendingSource(id)` で sourceUri を取得する設計。
// resolveCropper() で結果を返してから router.back() する。
//
// ★ なぜ uri を直接 query param に乗せないか:
//   expo-image-picker の Web 実装 (~16.0.0) は FileReader.readAsDataURL で
//   写真を base64 data URL として返す。4K iPhone 写真 (~10MB) を base64 化すると
//   13MB+ の文字列になり、これを router.push の query param に乗せると iOS Safari /
//   WKWebView (TikTok 等 in-app browser) の URL 長制限 (~80K chars) で silent
//   truncate される → cropper 画面が壊れた data URL を受け取り Image.getSize 失敗
//   → router.back() で「写真選んでも何も起きない」現象になっていた.
//   module-level Map で渡せば URL に乗らず長さ無制限になる.
//
// Safety nets:
//   - cropper screen の unmount 時にも resolveCropper(null) を呼ぶ
//     ので、ブラウザ back や refresh, deeplink 等で promise が宙ぶらりんに
//     ならない (caller の await が永久 hang しない)
//   - 二重 resolve は冪等に無視
//   - openCropper 自体に 60 秒の hard timeout を設けて、想定外の状況でも
//     必ず null で resolve するようにする
//   - timeout / resolve / unmount のどこからでも Map entry を確実に削除する
//     (メモリリーク防止. data URL は MB 単位で大きいので放置は致命的)
// ============================================================

import { router } from 'expo-router';

let pendingResolve: ((uri: string | null) => void) | null = null;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingId: string | null = null;
// ID → sourceUri Map. 同時に複数の cropper が開くことは無いが、
// race condition (古い openCropper の resolve が新しい entry を消す等) を
// 防ぐため ID で entry を結び付ける.
const pendingSources = new Map<string, string>();

// 内部: 衝突しない ID 生成 (timestamp 36 進数 + random 8 文字)
function generateId(): string {
  return `crop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// 内部 helper — pending を確実に flush する (二重呼びは安全)
function flush(value: string | null) {
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  if (pendingId) {
    pendingSources.delete(pendingId);
    pendingId = null;
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
    // 同時に開いてた前の Promise を clean up (二重起動防止 + 古い Map entry 削除)
    flush(null);
    pendingResolve = resolve;
    const id = generateId();
    pendingId = id;
    pendingSources.set(id, sourceUri);
    // 60 秒の hard timeout — どんなに想定外でも caller を hang させない
    pendingTimeout = setTimeout(() => {
      console.warn('[imageCropper] timed out after 60s — resolving null');
      flush(null);
    }, 60_000);
    try {
      router.push({
        pathname: '/image-cropper' as never,
        params: { id } as never,
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

// cropper screen が sourceUri を取得するための API。
// 同じ id で複数回 (= cropper 画面の複数 render で) 呼ばれても同じ値が返るよう、
// ここでは Map から delete しない. Map のクリーンアップは flush() に任せる.
// id が見つからない場合 (例: ブラウザ refresh で in-memory state が消えた) は null.
export function consumePendingSource(id: string): string | null {
  if (!id) return null;
  return pendingSources.get(id) ?? null;
}
