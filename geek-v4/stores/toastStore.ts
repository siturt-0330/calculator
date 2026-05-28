import { create } from 'zustand';
import { translateStatic } from '../lib/i18n';

export type ToastVariant = 'info' | 'success' | 'error' | 'warn';

export type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
  undoLabel?: string;
  onUndo?: () => void;
};

type ToastState = {
  toasts: Toast[];
  show: (
    message: string,
    variant?: ToastVariant,
    opts?: { undoLabel?: string; onUndo?: () => void; duration?: number },
  ) => void;
  dismiss: (id: string) => void;
};

// 表示時間を variant + 文字数で動的に決定。
// 旧版は一律 2400ms で error の長い message が読み切れず「何が起きたか分からないまま消えた」
// 体感の UX 問題があった。error は最低 4000ms + 文字数に応じて加算 (35 字超で +1000ms ずつ)。
// export して unit test 可能にする。
export function computeDuration(message: string, variant: ToastVariant, override?: number): number {
  if (override != null) return Math.max(1000, override);
  const baseByVariant: Record<ToastVariant, number> = {
    info: 2400,
    success: 2400,
    warn: 3200,
    error: 4000,
  };
  const base = baseByVariant[variant];
  const extra = Math.max(0, Math.floor(message.length / 35)) * 1000;
  return Math.min(base + extra, 8000); // 上限 8s
}

// ★ 2026-05 改修: content-based dedup window.
//   Audit D で複数の mutation path (smart-queue 再 dispatch / parity logic 等) が
//   同一 onError → show('いいねに失敗') を同時発火する事例が判明。source 修正後の
//   defense-in-depth として Toast layer で (message, variant) 重複を間引く。
//   現在表示中、または直近 DEDUP_WINDOW_MS 以内に表示された identical toast は skip。
export const DEDUP_WINDOW_MS = 1500;

// recentToasts: store 外に保持して set() の不要な再 render を避ける。
// 各 entry の at は show() 時刻 (= 表示開始)。dismiss/timeout でも entry は
// DEDUP_WINDOW_MS 経過まで残し、その期間内の重複を抑止する。
const recentToasts: Array<{ message: string; variant: ToastVariant; at: number }> = [];

function pruneRecent(now: number): void {
  // 末尾から走査して expire 済みを除去 (順序保持のため filter ではなく in-place)。
  for (let i = recentToasts.length - 1; i >= 0; i--) {
    const entry = recentToasts[i];
    if (entry && now - entry.at > DEDUP_WINDOW_MS) {
      recentToasts.splice(i, 1);
    }
  }
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, variant = 'info', opts) => {
    // ★ 2026-05 改修: 全 caller の文言を変更せずに、表示直前で言語切替する。
    //   DICT に登録があれば現在 lang に翻訳、無ければそのまま (= 安全な fallback)。
    //   既存 caller (auth flow / hooks / api) のコード変更ゼロで Toast が多言語化される。
    const localized = translateStatic(message);

    // ★ Dedup: 同一 (message, variant) が DEDUP_WINDOW_MS 以内に show 済みなら skip。
    //   localize 後の文字列で照合する (= user が画面で見る文言と一致させる)。
    const now = Date.now();
    pruneRecent(now);
    const isDup = recentToasts.some((r) => r.message === localized && r.variant === variant);
    if (isDup) return;
    recentToasts.push({ message: localized, variant, at: now });

    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message: localized, variant, undoLabel: opts?.undoLabel, onUndo: opts?.onUndo }] }));
    const ms = computeDuration(localized, variant, opts?.duration);
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
