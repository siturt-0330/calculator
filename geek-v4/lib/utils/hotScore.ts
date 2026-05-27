// ============================================================
// hotScore — Reddit 風「Hot」並び順の JS 実装
// ============================================================
// supabase/migrations/0058_hot_score.sql で定義した generated column
// (hot_score) と完全に同じ式を JS で再現する。
//
// 用途:
//   - 新規投稿直後など、generated column が反映される前にクライアントで
//     並び順を安定させるための fallback (createPost → optimistic update)。
//   - 単体テスト / 数値感覚を取りたい時に同じ formula を import できる。
//
// 式 (Reddit Hot ranking, 日本市場向けに時間係数を調整):
//   s     = likesCount - concernCount               (upvotes - downvotes 相当)
//   t     = (createdAt[sec] - GEEK_LAUNCH_EPOCH)
//   score = log10(max(|s|, 1)) + sign(s) * t / HOT_TIME_DIVISOR
//
// 設計メモ:
//   - log10(max(|s|, 1)) で s=0 の log10(0)=-Inf を回避。
//   - sign(s) は -1/0/+1。s=0 のときは時刻依存性が消えて score=0 となる。
//   - HOT_TIME_DIVISOR = 28800 (= 8h)。likes が 1 桁増えるのと "8 時間
//     経過" が同じ重み。Reddit は 45000 (12.5h)。日本市場の活動帯が
//     短い (夕〜深夜ピーク) ため短めに振ってある。
//   - GEEK_LAUNCH_EPOCH を引いて原点をずらすのは double precision の精度
//     確保のため (epoch がそのままだと 1.7e9 で log10 加算が小さくなる)。
// ============================================================

/** Geek launch epoch (UTC sec) — 2024-05-16 00:00:00 UTC. */
export const GEEK_LAUNCH_EPOCH = 1715817600;

/** 時間係数の分母 (秒)。8 時間 = 28800s。 */
export const HOT_TIME_DIVISOR = 28800;

export type HotScoreInput = {
  likesCount: number;
  concernCount: number;
  /**
   * 投稿時刻。
   *   - string: ISO timestamp (Date.parse 可能なもの)
   *   - number: epoch ms (Date.now() と同じ単位)
   *   - Date: そのまま
   * Invalid な値は NaN として扱い、score=0 を返す (silent failure)。
   */
  createdAt: string | number | Date;
};

/**
 * 0058_hot_score.sql の generated column と同じ式で hot_score を計算する。
 *
 * 例:
 *   const score = computeHotScore({
 *     likesCount: 42,
 *     concernCount: 3,
 *     createdAt: '2026-05-27T12:00:00Z',
 *   });
 *
 * 不正入力 (NaN / 無効 timestamp) は 0 を返して fallback ソートが
 * 落ちないようにする。
 */
export function computeHotScore(input: HotScoreInput): number {
  const likes = toNonNegativeInt(input.likesCount);
  const concerns = toNonNegativeInt(input.concernCount);
  const createdAtSec = toEpochSeconds(input.createdAt);
  if (!Number.isFinite(createdAtSec)) return 0;

  const s = likes - concerns;
  // log10(max(|s|, 1)) — s=0 でも -Inf にならない
  const order = Math.log10(Math.max(Math.abs(s), 1));
  // Math.sign は -1 / 0 / +1
  const sgn = Math.sign(s);
  const seconds = createdAtSec - GEEK_LAUNCH_EPOCH;
  const score = order + (sgn * seconds) / HOT_TIME_DIVISOR;
  // 防御: SQL 側で発生し得ない NaN/Inf が出たら 0 に倒す
  return Number.isFinite(score) ? score : 0;
}

// ----------------------------------------------------------------
// internal helpers
// ----------------------------------------------------------------
function toNonNegativeInt(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : Math.floor(v);
}

function toEpochSeconds(v: string | number | Date): number {
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? ms / 1000 : NaN;
  }
  if (typeof v === 'number') {
    // epoch ms として扱う (Date.now() と同じ単位を期待)
    return Number.isFinite(v) ? v / 1000 : NaN;
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms / 1000 : NaN;
  }
  return NaN;
}
