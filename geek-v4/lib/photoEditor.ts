// ============================================================
// lib/photoEditor.ts — フル写真エディタの opener
// ============================================================
// `openPhotoEditor(uri)` で全画面の写真編集 (描く/文字/スタンプ/モザイク/フィルター/
// 切り抜き) を開き、編集後の data URL を resolve する。imageCropper.ts と同じ
// module-level Map + hard timeout + orphan 掃除パターン。
//
// ★ web 専用機能: フルエディタは HTML canvas 実装のため web でのみ動く。
//   native (iOS/Android アプリ) は openCropper の rect モード (切り抜き+回転) に
//   フォールバックする。GEEK の主対象は iOS Safari/PWA = web。
// ============================================================

import { Platform } from 'react-native';
import { router } from 'expo-router';
import { openCropper } from './imageCropper';

let pendingResolve: ((uri: string | null) => void) | null = null;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingId: string | null = null;
const pendingSources = new Map<string, string>();

function tsFromId(id: string): number {
  const part = id.split('_')[1];
  if (!part) return 0;
  const n = parseInt(part, 36);
  return Number.isFinite(n) ? n : 0;
}

function generateId(): string {
  return `pe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function flush(value: string | null) {
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  if (pendingId) {
    pendingSources.delete(pendingId);
    pendingId = null;
  }
  if (pendingSources.size > 0) {
    const now = Date.now();
    for (const id of Array.from(pendingSources.keys())) {
      if (now - tsFromId(id) > 120_000) pendingSources.delete(id);
    }
  }
  if (pendingResolve) {
    const r = pendingResolve;
    pendingResolve = null;
    try {
      r(value);
    } catch (e) {
      console.warn('[photoEditor] resolve threw:', e);
    }
  }
}

// 写真エディタを開いて編集後 uri を返す。cancel/timeout は null。
export function openPhotoEditor(sourceUri: string): Promise<string | null> {
  // native はフルエディタ非対応 → 切り抜き+回転のクロッパーにフォールバック
  if (Platform.OS !== 'web') {
    return openCropper(sourceUri, { shape: 'rect', aspect: 'original', outMaxEdge: 1440 });
  }
  return new Promise((resolve) => {
    flush(null);
    pendingResolve = resolve;
    const id = generateId();
    pendingId = id;
    pendingSources.set(id, sourceUri);
    // ★ hard timeout は張らない: エディタは長時間編集が前提で、timeout が編集中に
    //   発火すると「完了」が無音で破棄されたり画面が突然閉じる事故になる。画面側の
    //   unmount safety (resolvePhotoEditor(null)) が caller の hang を防ぐので不要。
    try {
      router.push({ pathname: '/photo-editor' as never, params: { id } as never });
    } catch (e) {
      console.warn('[photoEditor] router.push failed:', e);
      flush(null);
    }
  });
}

export function resolvePhotoEditor(editedUri: string | null) {
  flush(editedUri);
}

export function consumePendingPhoto(id: string): string | null {
  if (!id) return null;
  return pendingSources.get(id) ?? null;
}
