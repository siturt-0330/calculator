// ============================================================
// lib/api/communities.ts — コミュニティ API バレル (後方互換エントリポイント)
// ------------------------------------------------------------
// このファイルは 1827 行から 5 つのモジュールに分割されました。
// 既存の `import { ... } from '.../lib/api/communities'` がそのまま動くよう、
// すべての型・関数をここで re-export しています。
//
// 新規コードでは直接 import 先を指定することを推奨:
//   - 型・コア CRUD       → ./communities-core
//   - フィード            → ./communities-feed
//   - 検索・探索          → ./communities-search
//   - メンバーシップ管理  → ./communities-membership
//   - 聖地・イベント      → ./communities-places
// ============================================================

export * from './communities-core';
export * from './communities-feed';
export * from './communities-search';
export * from './communities-membership';
export * from './communities-places';
