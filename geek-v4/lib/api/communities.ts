// ============================================================
// communities.ts — barrel re-export
// ============================================================
// 旧 1274 行の単一 file を以下の submodule に分割した:
//   - communities/types.ts       — DB row 型 + UUID_RE
//   - communities/_helpers.ts    — internal-only (mapJoinError, escapeForIlike)
//   - communities/core.ts        — fetchMy / create / update / fetch / icon upload
//   - communities/discover.ts    — searchByName / fetchOfficial / discover / search
//   - communities/members.ts     — join / request / leave / realtime
//   - communities/posts.ts       — fetchMyCommunityFeed / fetchMyCommunityPostsRich
//   - communities/spots.ts       — 聖地 (community_spots) CRUD + certify
//   - communities/events.ts      — カレンダー (community_events) CRUD
//
// すべての export がこの barrel から手に入るので、consumer 側の import 文は
// 変更不要 (`import { ... } from '../lib/api/communities'` がそのまま動く)。
// 個別に submodule を直接 import することも可能 (tree-shaking のため推奨)。
// ============================================================

export * from './communities/types';
export * from './communities/core';
export * from './communities/discover';
export * from './communities/members';
export * from './communities/posts';
export * from './communities/spots';
export * from './communities/events';
