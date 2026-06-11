// ============================================================
// useHiddenStamps — 「このスタンプを非表示」(端末ローカル / userId 別)
// ------------------------------------------------------------
// MemeReactionPicker の長押しメニューから非表示にしたスタンプを
// lib/storage (MMKV/localStorage) の key `geek:hidden_stamps:${userId}` に
// string[] で永続化する。
//   - 未ログイン時は no-op (hide/unhide は何もしない・一覧は常に空)
//   - Zustand store にはしない (storage を import する新規 store を
//     i18n 連鎖に入れない規約のため)。picker の mount 中だけ React state に
//     ミラーし、変更時に同期 KV へ二重書きする。
//   - 同期 KV なので cold start / open 時に await 不要。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getJson, setJson } from '../lib/storage';

const keyFor = (userId: string) => `geek:hidden_stamps:${userId}`;

const load = (userId: string | undefined): string[] =>
  userId ? (getJson<string[]>(keyFor(userId)) ?? []) : [];

export function useHiddenStamps() {
  const userId = useAuthStore((s) => s.user?.id);
  const [hidden, setHidden] = useState<string[]>(() => load(userId));

  // ログイン user が変わったら読み直す (logout → [] / 切替 → その user の分)
  useEffect(() => {
    setHidden(load(userId));
  }, [userId]);

  const hide = useCallback(
    (stamp: string) => {
      if (!userId) return; // 未ログインは no-op
      const t = stamp.trim();
      if (!t) return;
      setHidden((prev) => {
        if (prev.includes(t)) return prev;
        const next = [t, ...prev];
        setJson(keyFor(userId), next);
        return next;
      });
    },
    [userId],
  );

  const unhide = useCallback(
    (stamp: string) => {
      if (!userId) return;
      setHidden((prev) => {
        const next = prev.filter((x) => x !== stamp);
        if (next.length === prev.length) return prev;
        setJson(keyFor(userId), next);
        return next;
      });
    },
    [userId],
  );

  // 表示 filter 用の O(1) lookup
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  return { hidden, hiddenSet, hide, unhide, canHide: !!userId };
}
