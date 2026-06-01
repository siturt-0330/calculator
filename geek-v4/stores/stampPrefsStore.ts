// ============================================================
// stampPrefsStore — テキストスタンプの「履歴」と「マイスタンプ」(ローカル)
// ------------------------------------------------------------
// テキストスタンプピッカー(タブ式)の 2 タブ分のデータをローカルに持つ:
//   - history:  最近自分が押したスタンプ (新しい順 / LRU / 最大 40)
//   - myStamps: 自分が保存・自作したスタンプ (新しい順 / 最大 100)
//
// 設計判断: DB 表ではなくローカル KV (lib/storage = MMKV/localStorage) に保存。
//   - マイグレーション不要で即デプロイ可能 (Netlify の JS ビルドのみで完結)
//   - 履歴は本来端末ローカルで十分。マイスタンプも v1 は端末内コレクションとする。
//   - 将来 DB 同期(複数端末)に拡張する場合は user_saved_stamps 表を追加する。
//
// 永続化は同期 KV (getJson/setJson) で行うため async/await 不要 = cold start が軽い。
// component からは selector で購読すること (CLAUDE.md §5.4)。
// ============================================================
import { create } from 'zustand';
import { getJson, setJson } from '../lib/storage';

const HISTORY_KEY = 'stamp-history-v1';
const MYSTAMPS_KEY = 'my-stamps-v1';
const MAX_HISTORY = 40;
const MAX_MYSTAMPS = 100;

type StampPrefsState = {
  history: string[];
  myStamps: string[];
  /** スタンプを押したら履歴に記録 (先頭へ / 重複除去 / 上限 LRU) */
  recordUse: (meme: string) => void;
  /** マイスタンプに保存 (自作 or 他人のを保存、どちらも) */
  saveToMyStamps: (meme: string) => void;
  /** マイスタンプから削除 */
  removeFromMyStamps: (meme: string) => void;
};

export const useStampPrefsStore = create<StampPrefsState>((set) => ({
  history: getJson<string[]>(HISTORY_KEY) ?? [],
  myStamps: getJson<string[]>(MYSTAMPS_KEY) ?? [],

  recordUse: (meme) =>
    set((s) => {
      const t = meme.trim();
      if (!t) return s;
      const next = [t, ...s.history.filter((x) => x !== t)].slice(0, MAX_HISTORY);
      setJson(HISTORY_KEY, next);
      return { history: next };
    }),

  saveToMyStamps: (meme) =>
    set((s) => {
      const t = meme.trim();
      if (!t || s.myStamps.includes(t)) return s;
      const next = [t, ...s.myStamps].slice(0, MAX_MYSTAMPS);
      setJson(MYSTAMPS_KEY, next);
      return { myStamps: next };
    }),

  removeFromMyStamps: (meme) =>
    set((s) => {
      const next = s.myStamps.filter((x) => x !== meme);
      setJson(MYSTAMPS_KEY, next);
      return { myStamps: next };
    }),
}));
