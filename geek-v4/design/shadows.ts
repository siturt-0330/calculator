// ============================================================
// design/shadows.ts — 後方互換 re-export (実体は design/tokens.ts の SHADOW)
// ------------------------------------------------------------
// かつてここに Platform.select 版 SHADOW が二重定義されており、tokens.ts 版と
// 影値が乖離していく事故の温床だったため re-export に一本化した (2026-06-12)。
// - 旧版にのみあった fab / press / pill キーは全 codebase 未使用のため廃止。
// - 新規 import は design/tokens.ts から直接行うこと。
// ============================================================
export { SHADOW } from './tokens';
