// ============================================================
// Image cropper — callback-based opener
// ============================================================
// 任意の画面から `openCropper(uri, opts?)` を呼ぶと、cropper 画面が
// modal-like に push される。ユーザーが「次へ」したら crop 後の
// uri を、cancel したら null を resolve する。
//
// opts で「アイコン用 (正方形/円)」と「投稿写真用 (任意アスペクト矩形 + 回転)」を
// 切り替える。opts 省略時は従来どおりアイコン用 (circle / 1:1 / 512px) で、
// 既存呼び出し (community icon, avatar) は一切挙動が変わらない。
//
// router.push に **ID だけ** を param として渡し、cropper 画面側は
// `consumePendingSource(id)` で {sourceUri, opts} を取得する設計。
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
//     + flush() のたびに「70 秒以上前の orphan entry」も掃除する
//     (data URL は MB 単位で大きいので放置は致命的。リトライ連打での leak も塞ぐ)
// ============================================================

import { router } from 'expo-router';

// cropper の形状/アスペクト/出力サイズ指定。
export interface CropperOptions {
  /** 'circle' = アイコン用の円マスク (正方形 crop)。'rect' = 投稿写真用の矩形。既定 'circle'。 */
  shape?: 'circle' | 'rect';
  /**
   * rect 時の crop フレームのアスペクト (幅/高さ)。
   * 'original' = 画像そのままのアスペクト (= 切り抜き無し・回転のみ可能)。既定 'original'。
   * circle 時は無視 (常に 1:1)。
   */
  aspect?: number | 'original';
  /** rect 時の出力の長辺上限 px。既定 1440。circle 時は無視 (常に 512 正方形)。 */
  outMaxEdge?: number;
  /** hard timeout (ms)。既定 60000。長時間操作する写真エディタからの呼び出しは延長する。 */
  timeoutMs?: number;
}

interface PendingEntry {
  uri: string;
  opts: CropperOptions;
}

let pendingResolve: ((uri: string | null) => void) | null = null;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingId: string | null = null;
// ID → {uri, opts} Map. 同時に複数の cropper が開くことは無いが、
// race condition (古い openCropper の resolve が新しい entry を消す等) を
// 防ぐため ID で entry を結び付ける.
const pendingSources = new Map<string, PendingEntry>();

// id に埋め込んだ timestamp (base36) を取り出す。壊れた id は 0。
function tsFromId(id: string): number {
  const part = id.split('_')[1];
  if (!part) return 0;
  const n = parseInt(part, 36);
  return Number.isFinite(n) ? n : 0;
}

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
  // ★ orphan 掃除: 何らかの異常で delete されずに残った 70 秒以上前の entry を回収。
  //   (HEIC decode 失敗 → リトライ連打で data URL が積もる leak を塞ぐ安全網)
  if (pendingSources.size > 0) {
    const now = Date.now();
    for (const id of Array.from(pendingSources.keys())) {
      if (now - tsFromId(id) > 70_000) pendingSources.delete(id);
    }
  }
  if (pendingResolve) {
    const r = pendingResolve;
    pendingResolve = null;
    try {
      r(value);
    } catch (e) {
      console.warn('[imageCropper] resolve threw:', e);
    }
  }
}

// 画像 URI を渡すと cropper 画面を開いて、ユーザーが OK/cancel した croppedUri を返す。
// cancel または timeout の場合は null。opts で形状/アスペクト/出力サイズを切り替える。
export function openCropper(sourceUri: string, opts: CropperOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    // 同時に開いてた前の Promise を clean up (二重起動防止 + 古い Map entry 削除)
    flush(null);
    pendingResolve = resolve;
    const id = generateId();
    pendingId = id;
    pendingSources.set(id, { uri: sourceUri, opts });
    // hard timeout — どんなに想定外でも caller を hang させない (既定 60s)。
    pendingTimeout = setTimeout(() => {
      console.warn('[imageCropper] timed out — resolving null');
      flush(null);
    }, opts.timeoutMs ?? 60_000);
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

// cropper screen が {sourceUri, opts} を取得するための API。
// 同じ id で複数回 (= cropper 画面の複数 render で) 呼ばれても同じ値が返るよう、
// ここでは Map から delete しない. Map のクリーンアップは flush() に任せる.
// id が見つからない場合 (例: ブラウザ refresh で in-memory state が消えた) は null.
export function consumePendingSource(id: string): PendingEntry | null {
  if (!id) return null;
  return pendingSources.get(id) ?? null;
}
