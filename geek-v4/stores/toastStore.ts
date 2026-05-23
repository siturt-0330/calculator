import { create } from 'zustand';

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

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, variant = 'info', opts) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, variant, undoLabel: opts?.undoLabel, onUndo: opts?.onUndo }] }));
    const ms = computeDuration(message, variant, opts?.duration);
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
