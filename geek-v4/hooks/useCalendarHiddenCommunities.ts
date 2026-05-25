// ============================================================
// useCalendarHiddenCommunities — マイページ集約カレンダーの opt-out 管理
// ------------------------------------------------------------
// 設計:
//   - サーバに保存しない (簡易な opt-out で十分、device 単位で個別管理 OK)
//   - lib/storage.ts (MMKV native / localStorage web) で同期 hydrate
//   - 値は Set<communityId> として扱い、トグル / 一括クリアを提供
//
// 別 device で同期したくなったら、後から user_settings.calendar_hidden_communities
// のような JSONB column を足して migrate する想定。
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { getJson, setJson } from '../lib/storage';

const STORAGE_KEY = 'mypage-calendar-hidden-communities';

function loadHidden(): string[] {
  const raw = getJson<string[]>(STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  // 不正な entry (uuid 形式外) は除外
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export function useCalendarHiddenCommunities() {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadHidden()));

  // 他タブ (Web) や別画面で更新された時のために購読
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setHidden(new Set(loadHidden()));
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const persist = useCallback((next: Set<string>) => {
    setHidden(next);
    setJson(STORAGE_KEY, Array.from(next));
  }, []);

  const toggle = useCallback((communityId: string) => {
    const next = new Set(hidden);
    if (next.has(communityId)) next.delete(communityId);
    else next.add(communityId);
    persist(next);
  }, [hidden, persist]);

  const clear = useCallback(() => {
    persist(new Set());
  }, [persist]);

  const isHidden = useCallback((communityId: string) => hidden.has(communityId), [hidden]);

  return {
    hidden,
    hiddenIds: Array.from(hidden),
    isHidden,
    toggle,
    clear,
  };
}
