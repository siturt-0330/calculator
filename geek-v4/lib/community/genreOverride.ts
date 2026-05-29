// ============================================================
// lib/community/genreOverride.ts
// ------------------------------------------------------------
// migration 0044 (communities.genre 追加) が production の Supabase に
// 未適用な環境で、ユーザーが選んだ genre を保持するための local override。
//
// 設計:
//   - Map<communityId, CommunityGenre> を JSON で MMKV / localStorage に保存
//   - createCommunity / updateCommunity が成功時に setGenreOverride を呼ぶ
//   - 詳細画面で effectiveGenre(id, server.genre) を使い、投稿 FAB の表示判定に使う
//     (legacy 以外なら投稿可能。#95 ジャンル別タブバー撤去後もこの用途で生存)
//   - migration 適用後は server 側の値が信頼できるので、override は補助に
//
// per-device な fallback なので、別 device から見た時は legacy 扱いに戻る
// (= ベストエフォート)。根本対応は `supabase db push --linked` で migration を
// 流すこと。
// ============================================================

import { getJson, setJson } from '../storage';
import type { CommunityGenre } from '../api/communities';

const STORAGE_KEY = 'community-genre-overrides';

type OverrideMap = Record<string, CommunityGenre>;

const VALID_GENRES: ReadonlySet<CommunityGenre> = new Set<CommunityGenre>([
  'oshi',
  'creative',
  'experience',
  'discussion',
  'legacy',
]);

function load(): OverrideMap {
  const raw = getJson<OverrideMap>(STORAGE_KEY);
  if (!raw || typeof raw !== 'object') return {};
  // 不正値 (古い key / typo) を除外
  const out: OverrideMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && k.length > 0 && VALID_GENRES.has(v as CommunityGenre)) {
      out[k] = v as CommunityGenre;
    }
  }
  return out;
}

export function getGenreOverride(communityId: string): CommunityGenre | undefined {
  if (!communityId) return undefined;
  return load()[communityId];
}

export function setGenreOverride(communityId: string, genre: CommunityGenre): void {
  if (!communityId || !VALID_GENRES.has(genre)) return;
  const m = load();
  m[communityId] = genre;
  setJson(STORAGE_KEY, m);
}

export function removeGenreOverride(communityId: string): void {
  if (!communityId) return;
  const m = load();
  if (m[communityId]) {
    delete m[communityId];
    setJson(STORAGE_KEY, m);
  }
}

/**
 * server から取得した genre と local override を merge して、画面で使うべき
 * 最終的な genre を返す。
 *
 * ルール:
 *   - server が 'legacy' or undefined or null → local override を優先
 *     (= migration 未適用 / 旧 community のケース)
 *   - server が 'oshi' / 'creative' / 'experience' / 'discussion' → server を尊重
 *     (= 正しく書き込めた値は信頼)
 *   - どちらも無ければ 'legacy'
 */
export function effectiveGenre(
  communityId: string,
  serverGenre: CommunityGenre | undefined | null,
): CommunityGenre {
  if (serverGenre && serverGenre !== 'legacy' && VALID_GENRES.has(serverGenre)) {
    return serverGenre;
  }
  const override = getGenreOverride(communityId);
  if (override) return override;
  return serverGenre ?? 'legacy';
}
