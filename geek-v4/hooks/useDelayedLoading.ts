import { useEffect, useState } from 'react';

/**
 * Returns true ONLY after `delayMs` of continuous loading.
 * Prevents skeleton flash on fast loads (<200ms).
 *
 * Usage:
 *   const isLoading = useDelayedLoading(query.isLoading, 200);
 *   if (isLoading) return <Skeleton />;
 */
export function useDelayedLoading(loading: boolean, delayMs = 200): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!loading) { setDelayed(false); return; }
    const t = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(t);
  }, [loading, delayMs]);
  return delayed;
}
