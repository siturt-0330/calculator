// ============================================================
// Personalization — interest profile builder
// ============================================================
// 端末ローカルのイベントログから、ユーザーの嗜好プロファイルを構築する。
// 純粋関数として実装、Storage には触らない。
// ============================================================

import type { FeedEvent, EventKind } from './events';

export type AffinityMap = Record<string, number>;

export type UserInterestProfile = {
  tagAffinity: AffinityMap;
  categoryAffinity: AffinityMap;
  recentTags: string[];          // last 30 min tags, MRU order
  hourHistogram: number[];       // length 24
  totalEvents: number;
  isColdStart: boolean;
};

// ----------------------------------------------------------------
// Per-kind base weights
// ----------------------------------------------------------------
const KIND_WEIGHTS: Record<EventKind, number> = {
  post_view: 1.0,       // multiplied by dwell-cap below
  post_like: 5.0,
  post_save: 8.0,
  post_unlike: -3.0,
  post_concern: -10.0,
  post_hide: -20.0,
  thread_open: 1.5,
  thread_reply: 6.0,
  tag_click: 3.0,
  tag_block: -50.0,
  search_submit: 4.0,
};

const DAY_MS = 86_400_000;
const DECAY_TAU_DAYS = 14;           // half-life ≈ 9.7 days
const RECENT_WINDOW_MS = 30 * 60_000; // 30 minutes
const COLD_START_THRESHOLD = 10;

function dwellMultiplier(dwellMs: number | undefined): number {
  if (dwellMs === undefined || dwellMs <= 0) return 1;
  return Math.min(dwellMs / 3000, 2.5);
}

function ageDecay(ageMs: number): number {
  const days = ageMs / DAY_MS;
  return Math.exp(-days / DECAY_TAU_DAYS);
}

function weightFor(e: FeedEvent, now: number): number {
  const base = KIND_WEIGHTS[e.kind] ?? 0;
  const decay = ageDecay(Math.max(0, now - e.ts));
  if (e.kind === 'post_view') {
    return base * dwellMultiplier(e.dwell_ms) * decay;
  }
  return base * decay;
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------
export function computeProfile(
  events: FeedEvent[],
  now: number = Date.now(),
): UserInterestProfile {
  const tagAffinity: AffinityMap = {};
  const categoryAffinity: AffinityMap = {};
  const hourHistogram: number[] = new Array(24).fill(0);

  let positiveCount = 0;
  // recentTags collection: traverse newest-first to get MRU order
  const recentTagsMRU: string[] = [];
  const recentTagSeen = new Set<string>();

  // sort by ts ascending so we know totals, but we need newest-first for recentTags
  const newestFirst = events.slice().sort((a, b) => b.ts - a.ts);

  for (const ev of newestFirst) {
    const w = weightFor(ev, now);

    // hour histogram (local time)
    try {
      const h = new Date(ev.ts).getHours();
      if (h >= 0 && h < 24) hourHistogram[h] = (hourHistogram[h] ?? 0) + 1;
    } catch {
      // skip bad ts
    }

    // distribute full weight to each tag (so 3-tag event contributes w to each tag)
    for (const tag of ev.tags) {
      if (!tag) continue;
      tagAffinity[tag] = (tagAffinity[tag] ?? 0) + w;
    }
    if (ev.category) {
      categoryAffinity[ev.category] = (categoryAffinity[ev.category] ?? 0) + w;
    }

    // positive event counter (for cold-start gate)
    if (w > 0) positiveCount += 1;

    // recent tags (last 30 min)
    if (now - ev.ts <= RECENT_WINDOW_MS) {
      for (const tag of ev.tags) {
        if (!tag) continue;
        if (recentTagSeen.has(tag)) continue;
        recentTagSeen.add(tag);
        recentTagsMRU.push(tag);
      }
    }
  }

  return {
    tagAffinity,
    categoryAffinity,
    recentTags: recentTagsMRU,
    hourHistogram,
    totalEvents: events.length,
    isColdStart: positiveCount < COLD_START_THRESHOLD,
  };
}
