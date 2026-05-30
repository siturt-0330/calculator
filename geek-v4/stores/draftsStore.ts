// ============================================================
// draftsStore — 投稿 / コミュニティ作成の「下書き」一覧ストア
// ------------------------------------------------------------
// 投稿フロー (post/create + create-settings) と コミュニティ作成
// (community/create) の両方で、入力が始まったら自動で下書きを 1 件
// 登録し、編集のたびに同じ下書きを更新する (LRU 上限 MAX_DRAFTS)。
// ドロワーの「下書き」→ app/drafts でこの一覧を見て再開 / 削除できる。
//
// 設計 (CLAUDE.md 準拠):
//   - Zustand。購読は selector で (§5.4 destructure 禁止)。
//   - 永続化は lib/storage の getJson/setJson (MMKV native / localStorage web)。
//     cold start でも await 無しで即 hydrate。window 直叩き禁止 (§5.7)。
//   - 型は postDraftStore / lib/api から type-only import (実行時 import cycle 無し)。
//   - 画像 / 動画 / アイコンはローカル URI を best-effort で保持する。アプリ再起動で
//     URI が失効しうる旨は復元側 (create 画面) で扱う (本ストアは保持のみ)。
//   - 下書き ID は呼び出し側が newDraftId() で発番し、upsert で同 ID を更新する。
// ============================================================
import { create } from 'zustand';
import { getJson, setJson } from '../lib/storage';
import type { PostVisibility } from '../lib/api/posts';
import type { Visibility, Community } from '../lib/api/communities';
import type { PickedVideo, CWCat } from './postDraftStore';

const STORAGE_KEY = 'geekv4_drafts_v1';
const MAX_DRAFTS = 30;

export type DraftKind = 'post' | 'community';

/** 投稿の下書き — postDraftStore の serializable な部分集合 + メタ */
export interface PostDraft {
  id: string;
  kind: 'post';
  updatedAt: number;
  // ---- content (Step 1) ----
  title: string;
  content: string;
  images: string[];
  video: PickedVideo | null;
  anonymous: boolean;
  // ---- settings (Step 2) ----
  tags: string[];
  visibility: PostVisibility;
  selectedCommunityIds: string[];
  selectedCommunities: Community[];
  cwCategory: CWCat;
  cwText: string;
  sourceUrl: string;
  showPoll: boolean;
  pollQuestion: string;
  pollOptions: string[];
  pollMulti: boolean;
  pollHours: number | null;
}

/** コミュニティ作成の下書き */
export interface CommunityDraft {
  id: string;
  kind: 'community';
  updatedAt: number;
  name: string;
  description: string;
  tags: string[];
  visibility: Visibility;
  /** クローズ時の細分 ('request' = 許可制 / 'invite' = 完全招待制) */
  closedMode: 'request' | 'invite';
  /** 切り抜き済みアイコンのローカル URI (best-effort / 再起動で失効しうる) */
  iconUri: string | null;
}

export type Draft = PostDraft | CommunityDraft;

// upsert で受け取る形 — id/kind/updatedAt を除いた中身。updatedAt は store 側で打つ。
export type PostDraftInput = Omit<PostDraft, 'updatedAt'>;
export type CommunityDraftInput = Omit<CommunityDraft, 'updatedAt'>;
export type DraftInput = PostDraftInput | CommunityDraftInput;

// 連番カウンタ — newDraftId の衝突回避用 (同一 ms 連続発番でも一意)。
let idCounter = 0;

/**
 * 下書き ID を発番する。create 画面が初回保存時に 1 度だけ呼び、以後は
 * 同じ ID で upsert して同一下書きを更新する。
 * 注: アプリ runtime では Date.now() は利用可 (Workflow script 内のみ禁止)。
 */
export function newDraftId(kind: DraftKind): string {
  idCounter += 1;
  return `${kind}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

interface DraftsState {
  items: Draft[];
  hydrated: boolean;
  /** storage から復元 (sync)。多重呼び出しは no-op。 */
  hydrate: () => void;
  /** 下書きを 1 件追加 or 更新 (id 一致で更新)。先頭へ繰り上げ、上限で切り詰め。 */
  upsert: (draft: DraftInput) => void;
  /** 下書きを 1 件削除。 */
  remove: (id: string) => void;
  /** 全削除。 */
  clear: () => void;
}

export const useDraftsStore = create<DraftsState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const saved = getJson<Draft[]>(STORAGE_KEY);
    set({ items: Array.isArray(saved) ? saved : [], hydrated: true });
  },

  upsert: (draft) => {
    if (!get().hydrated) get().hydrate();
    const stamped = { ...draft, updatedAt: Date.now() } as Draft;
    // 同 ID を除いて先頭へ前置 (= 最近編集が上)。
    const next: Draft[] = [
      stamped,
      ...get().items.filter((d) => d.id !== draft.id),
    ].slice(0, MAX_DRAFTS);
    set({ items: next });
    setJson(STORAGE_KEY, next);
  },

  remove: (id) => {
    if (!get().hydrated) get().hydrate();
    const next = get().items.filter((d) => d.id !== id);
    set({ items: next });
    setJson(STORAGE_KEY, next);
  },

  clear: () => {
    set({ items: [] });
    setJson(STORAGE_KEY, []);
  },
}));
