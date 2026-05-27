// ============================================================
// postArchive — 90 日経過アーカイブ判定の client-side helper
// ------------------------------------------------------------
// Reddit ガイド #15 / 2.10 / 3.7 章:
//   90 日経過した post は「アーカイブ」状態となり、新規の
//   comment / like / reaction は受け付けない (RLS 側でも deny).
//   閲覧は永続なので、ここでは「UI で input を出さない」「banner を
//   出す」判定を行う helper を提供する。
//
// DB 側の `is_post_archived()` (0066_post_archive.sql) と同じ式を
// クライアント側でも持つことで、サーバ往復前に input UI を抑止できる.
// (権威は server. client は UX のみ.)
//
// 設計:
//   - 入力は string (ISO) | Date を受け付け、Number.isFinite で防御.
//   - 単位は 86400_000 ms × 90 = 90 日.
//   - exports は test しやすい純関数のみ.
// ============================================================

/** アーカイブ判定の閾値 (日). DB 側の `interval '90 days'` と一致. */
export const ARCHIVE_DAYS = 90;

/** 1 日のミリ秒. リテラルだと test 側でも目視確認しやすい. */
const DAY_MS = 86_400_000;

/**
 * 内部: created_at を epoch ms に正規化. 不正値は NaN を返す.
 *
 * - string  → Date.parse (ISO 8601 期待. invalid なら NaN)
 * - Date    → getTime()
 * - number  → そのまま受け取り (UTC ms と想定)
 */
function toEpochMs(createdAt: string | Date | number): number {
  if (typeof createdAt === 'number') return createdAt;
  if (createdAt instanceof Date) return createdAt.getTime();
  return Date.parse(createdAt);
}

/**
 * 指定した created_at の post が、現在時刻時点でアーカイブ済みか.
 *
 * - `Date.now() - created_at > 90 day` のとき true.
 * - 境界 (= 丁度 90 日) は **未アーカイブ** (>, 厳密大なり).
 *   → DB 側の `created_at < now() - interval '90 days'` と同じ境界.
 * - 不正な input は false (= 未アーカイブ扱い. UI は通常通り出す).
 */
export function isPostArchived(createdAt: string | Date | number): boolean {
  const t = toEpochMs(createdAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > ARCHIVE_DAYS * DAY_MS;
}

/**
 * アーカイブまで残り何日か. 整数で返す.
 *
 * - 既にアーカイブ済みなら 0.
 * - 不正な input は 0.
 * - 丸め: Math.ceil — 「あと N 日」表示で「あと 0 日」を避けるため.
 *   例: 残り 0.4 日 (= 約 10 時間) → 1 を返す.
 */
export function daysUntilArchive(createdAt: string | Date | number): number {
  const t = toEpochMs(createdAt);
  if (!Number.isFinite(t)) return 0;
  const archiveAt = t + ARCHIVE_DAYS * DAY_MS;
  const remainingMs = archiveAt - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / DAY_MS);
}

/**
 * アーカイブ予定時刻を Date で返す (= created_at + 90 days).
 *
 * - 不正な input は new Date(NaN) (= Invalid Date).
 *   呼び出し側で `Number.isNaN(d.getTime())` で判定可能.
 */
export function archivedAtDate(createdAt: string | Date | number): Date {
  const t = toEpochMs(createdAt);
  if (!Number.isFinite(t)) return new Date(NaN);
  return new Date(t + ARCHIVE_DAYS * DAY_MS);
}
