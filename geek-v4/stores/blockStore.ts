import { create } from 'zustand';
import { getJson, setJson } from '../lib/storage';
import { supabase } from '../lib/supabase';

// ============================================================
// blockStore — 匿名ユーザーブロック管理
// ============================================================
// pseudonym_id (migration 0116 で導入) をベースにした匿名ブロック機能。
// - blockedPseudonymIds は Set<string> で O(1) lookup を保証。
// - MMKV (native) / localStorage (web) に 'geek:blocks:v1' で同期永続化。
// - サーバー側の block_pseudonym / unblock_pseudonym / get_blocked_pseudonyms RPC
//   を呼ぶが、通信失敗はローカル状態を巻き戻さず fail-silent で握りつぶす。
//   (楽観更新: ローカルを先に変えてから RPC を fire-and-forget)
// ============================================================

const STORAGE_KEY = 'geek:blocks:v1';

type BlockReason = 'spam' | 'harassment' | 'other';

type BlockState = {
  blockedPseudonymIds: Set<string>;
  loaded: boolean;
  blockUser: (pseudonymId: string, reason?: BlockReason) => void;
  unblockUser: (pseudonymId: string) => void;
  loadBlocks: () => Promise<void>;
  isBlocked: (pseudonymId: string | null | undefined) => boolean;
};

// MMKV / localStorage に Set を保存するためのシリアライズヘルパ
function saveToStorage(ids: Set<string>): void {
  try {
    setJson(STORAGE_KEY, [...ids]);
  } catch {
    /* swallow — 永続化失敗はセッション内ブロックには影響しない */
  }
}

function loadFromStorage(): Set<string> {
  try {
    const raw = getJson<string[]>(STORAGE_KEY);
    if (Array.isArray(raw)) {
      return new Set(raw.filter((v): v is string => typeof v === 'string'));
    }
  } catch {
    /* swallow */
  }
  return new Set();
}

export const useBlockStore = create<BlockState>((set, get) => ({
  blockedPseudonymIds: loadFromStorage(),
  loaded: false,

  blockUser: (pseudonymId, reason) => {
    // 楽観更新: ローカルに即反映
    const next = new Set(get().blockedPseudonymIds);
    next.add(pseudonymId);
    set({ blockedPseudonymIds: next });
    saveToStorage(next);

    // fire-and-forget — 通信失敗はローカルを巻き戻さない
    void supabase.rpc('block_pseudonym', {
      p_pseudonym_id: pseudonymId,
      p_reason: reason ?? 'other',
    }).then(({ error }) => {
      if (error) {
        console.warn('[blockStore] block_pseudonym rpc failed:', error.message);
      }
    });
  },

  unblockUser: (pseudonymId) => {
    // 楽観更新: ローカルに即反映
    const next = new Set(get().blockedPseudonymIds);
    next.delete(pseudonymId);
    set({ blockedPseudonymIds: next });
    saveToStorage(next);

    // fire-and-forget
    void supabase.rpc('unblock_pseudonym', {
      p_pseudonym_id: pseudonymId,
    }).then(({ error }) => {
      if (error) {
        console.warn('[blockStore] unblock_pseudonym rpc failed:', error.message);
      }
    });
  },

  loadBlocks: async () => {
    try {
      const { data, error } = await supabase.rpc('get_blocked_pseudonyms');
      if (error) {
        console.warn('[blockStore] get_blocked_pseudonyms rpc failed:', error.message);
        set({ loaded: true });
        return;
      }
      // RPC は { pseudonym_id: string }[] か string[] を返すことを想定。
      // 配列の各要素が string なら直接使い、object なら pseudonym_id フィールドを取る。
      const ids: string[] = [];
      if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === 'string') {
            ids.push(item);
          } else if (item && typeof item === 'object' && 'pseudonym_id' in item) {
            const v = (item as { pseudonym_id: unknown }).pseudonym_id;
            if (typeof v === 'string') ids.push(v);
          }
        }
      }
      const next = new Set(ids);
      set({ blockedPseudonymIds: next, loaded: true });
      saveToStorage(next);
    } catch (e) {
      console.warn('[blockStore] loadBlocks exception:', e);
      set({ loaded: true });
    }
  },

  isBlocked: (pseudonymId) => {
    if (!pseudonymId) return false;
    return get().blockedPseudonymIds.has(pseudonymId);
  },
}));
