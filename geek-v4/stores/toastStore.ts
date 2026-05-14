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
  show: (message: string, variant?: ToastVariant, opts?: { undoLabel?: string; onUndo?: () => void }) => void;
  dismiss: (id: string) => void;
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, variant = 'info', opts) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, variant, ...opts }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2400);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
