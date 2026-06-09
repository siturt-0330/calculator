// ============================================================
// draftStore — サーバー同期付き投稿下書きストア
// ------------------------------------------------------------
// MMKV でローカル永続化しつつ、Supabase RPC (upsert_post_draft /
// delete_post_draft / get_my_drafts) でサーバーとも同期する。
//
// 設計方針:
//   - ローカル保存を先行して行い、RPC は fire-and-forget (非同期バックグラウンド)。
//   - サーバー割り当て UUID は serverId に保持し、次回の upsert に渡す。
//   - ローカル上限は MAX_DRAFTS=20 件 (超えたら updatedAt の古いものを削除)。
//   - 永続化は lib/storage の getJson/setJson (MMKV native / localStorage web)。
//     cold start でも await 無しで即 hydrate。
//   - loadDrafts() でローカル復元 → バックグラウンドでサーバー最新版をマージ。
//   - Zustand。selector で subscribe (§5.4 destructure 禁止)。
// ============================================================

import { create } from 'zustand';
import { getJson, setJson, remove } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { swallow } from '../lib/swallow';

const STORAGE_KEY = 'geek:drafts:v1';
const MAX_DRAFTS = 20;

// ============================================================
// 型定義
// ============================================================

export interface Draft {
  /** ローカル UUID (新規発番) または サーバー同期後のサーバー UUID */
  id: string;
  content: string;
  title?: string;
  tagNames: string[];
  mediaUrls: string[];
  /** 最終更新のタイムスタンプ (ms) */
  updatedAt: number;
  /** サーバー側の draft UUID (RPC upsert 後に設定される) */
  serverId?: string;
}

export type DraftInput = Omit<Draft, 'id' | 'updatedAt'>;
export type DraftUpdates = Partial<Omit<Draft, 'id'>>;

// ============================================================
// ローカル UUID 発番
// ============================================================

let _idCounter = 0;

/** 下書き用のローカル ID を発番する。 */
export function newDraftId(): string {
  _idCounter += 1;
  return `draft_${Date.now().toString(36)}_${_idCounter.toString(36)}`;
}

// ============================================================
// サーバー同期ヘルパ (fire-and-forget)
// ============================================================

/** サーバーへ upsert し、返却された server_id を draft に書き戻す (best-effort)。 */
async function syncUpsertToServer(
  draft: Draft,
  onServerId: (localId: string, serverId: string) => void,
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('upsert_post_draft', {
      p_local_id: draft.id,
      p_server_id: draft.serverId ?? null,
      p_content: draft.content,
      p_title: draft.title ?? null,
      p_tag_names: draft.tagNames,
      p_media_urls: draft.mediaUrls,
      p_updated_at: new Date(draft.updatedAt).toISOString(),
    });
    if (error) {
      swallow('draftStore.syncUpsert', error);
      return;
    }
    // RPC が server_id (UUID) を返すことを期待
    if (data && typeof data === 'string') {
      onServerId(draft.id, data);
    } else if (data && typeof (data as Record<string, unknown>).server_id === 'string') {
      onServerId(draft.id, (data as Record<string, unknown>).server_id as string);
    }
  } catch (e) {
    swallow('draftStore.syncUpsert', e);
  }
}

/** サーバーから該当 draft を削除する (best-effort)。 */
async function syncDeleteFromServer(serverId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('delete_post_draft', {
      p_server_id: serverId,
    });
    if (error) swallow('draftStore.syncDelete', error);
  } catch (e) {
    swallow('draftStore.syncDelete', e);
  }
}

// ============================================================
// Zustand store
// ============================================================

interface DraftStoreState {
  drafts: Draft[];
  syncing: boolean;
  hydrated: boolean;

  /** 起動時に MMKV から復元し、バックグラウンドでサーバーとマージ。 */
  loadDrafts: () => void;
  /** 新規下書きをローカル保存しサーバーへ fire-and-forget 同期。 */
  saveDraft: (draft: DraftInput) => string;
  /** 既存下書きを部分更新し同期。 */
  updateDraft: (id: string, updates: DraftUpdates) => void;
  /** 下書きをローカルとサーバーから削除。 */
  deleteDraft: (id: string) => void;
  /** 単一 draft を返す。 */
  getDraft: (id: string) => Draft | undefined;
}

export const useDraftStore = create<DraftStoreState>((set, get) => ({
  drafts: [],
  syncing: false,
  hydrated: false,

  // ------------------------------------------------------------------
  // loadDrafts
  // ------------------------------------------------------------------
  loadDrafts: () => {
    // 多重呼び出し防止
    if (get().hydrated) return;

    // 1. MMKV から同期復元 (cold start を blocking しない)
    const saved = getJson<Draft[]>(STORAGE_KEY);
    const local: Draft[] = Array.isArray(saved) ? saved : [];
    set({ drafts: local, hydrated: true });

    // 2. サーバーから最新版を取得してマージ (fire-and-forget)
    set({ syncing: true });
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_my_drafts');
        if (error) {
          swallow('draftStore.loadDrafts.rpc', error);
          return;
        }
        if (!Array.isArray(data)) return;

        // サーバー側 draft をローカルとマージ
        // 同一 serverId のものは updatedAt が新しい方を採用
        const current = get().drafts;
        const byServerId = new Map<string, Draft>(
          current.filter((d) => d.serverId).map((d) => [d.serverId as string, d]),
        );

        const serverDrafts: Draft[] = (data as Array<Record<string, unknown>>).map((row) => ({
          id: (typeof row['local_id'] === 'string' && row['local_id'])
            ? row['local_id']
            : (typeof row['server_id'] === 'string' ? row['server_id'] : newDraftId()),
          content: typeof row['content'] === 'string' ? row['content'] : '',
          title: typeof row['title'] === 'string' ? row['title'] : undefined,
          tagNames: Array.isArray(row['tag_names']) ? (row['tag_names'] as string[]) : [],
          mediaUrls: Array.isArray(row['media_urls']) ? (row['media_urls'] as string[]) : [],
          updatedAt: row['updated_at']
            ? new Date(row['updated_at'] as string).getTime()
            : Date.now(),
          serverId: typeof row['server_id'] === 'string' ? row['server_id'] : undefined,
        }));

        // マージ: serverDrafts で上書き or 追記、ローカル専用 (serverId 無し) は保持
        const localOnly = current.filter((d) => !d.serverId);
        const merged: Draft[] = [...localOnly];

        for (const sd of serverDrafts) {
          const existing = sd.serverId ? byServerId.get(sd.serverId) : undefined;
          if (existing) {
            // 新しい方を採用
            merged.push(existing.updatedAt >= sd.updatedAt ? existing : sd);
          } else {
            merged.push(sd);
          }
        }

        // updatedAt 降順に並べ替えて上限適用
        const sorted = merged
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_DRAFTS);

        set({ drafts: sorted });
        setJson(STORAGE_KEY, sorted);
      } catch (e) {
        swallow('draftStore.loadDrafts', e);
      } finally {
        set({ syncing: false });
      }
    })();
  },

  // ------------------------------------------------------------------
  // saveDraft
  // ------------------------------------------------------------------
  saveDraft: (input) => {
    const id = newDraftId();
    const draft: Draft = {
      ...input,
      id,
      updatedAt: Date.now(),
    };

    // ローカル先行保存
    const next: Draft[] = [draft, ...get().drafts]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DRAFTS);
    set({ drafts: next });
    setJson(STORAGE_KEY, next);

    // サーバー同期 (fire-and-forget)
    void syncUpsertToServer(draft, (localId, serverId) => {
      // serverId を書き戻す
      const updated = get().drafts.map((d) =>
        d.id === localId ? { ...d, serverId } : d,
      );
      set({ drafts: updated });
      setJson(STORAGE_KEY, updated);
    });

    return id;
  },

  // ------------------------------------------------------------------
  // updateDraft
  // ------------------------------------------------------------------
  updateDraft: (id, updates) => {
    const existing = get().drafts.find((d) => d.id === id);
    if (!existing) return;

    const updated: Draft = {
      ...existing,
      ...updates,
      id,
      updatedAt: Date.now(),
    };

    const next: Draft[] = [
      updated,
      ...get().drafts.filter((d) => d.id !== id),
    ]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DRAFTS);

    set({ drafts: next });
    setJson(STORAGE_KEY, next);

    // サーバー同期 (fire-and-forget)
    void syncUpsertToServer(updated, (localId, serverId) => {
      const refreshed = get().drafts.map((d) =>
        d.id === localId ? { ...d, serverId } : d,
      );
      set({ drafts: refreshed });
      setJson(STORAGE_KEY, refreshed);
    });
  },

  // ------------------------------------------------------------------
  // deleteDraft
  // ------------------------------------------------------------------
  deleteDraft: (id) => {
    const target = get().drafts.find((d) => d.id === id);
    const next = get().drafts.filter((d) => d.id !== id);
    set({ drafts: next });
    if (next.length === 0) {
      remove(STORAGE_KEY);
    } else {
      setJson(STORAGE_KEY, next);
    }

    // サーバー削除 (serverId がある場合のみ)
    if (target?.serverId) {
      void syncDeleteFromServer(target.serverId);
    }
  },

  // ------------------------------------------------------------------
  // getDraft
  // ------------------------------------------------------------------
  getDraft: (id) => {
    return get().drafts.find((d) => d.id === id);
  },
}));
