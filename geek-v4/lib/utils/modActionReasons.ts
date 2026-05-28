// ============================================================
// modActionReasons — Mod (コミュ管理者) のアクション理由 preset
// ============================================================
// 削除 / キック / BAN の 3 操作に対して chip 選択肢を提供する。
// 「その他」は label を出すだけで、呼び出し側で TextInput 自由入力に
// 切り替える前提 (key === 'other' のときだけ free-text)。
//
// 設計メモ:
//   - 列挙体は `as const` で stringly-typed key を保つ (型推論で union が出る)
//   - `getReasonLabel(key)` は 3 列挙体の合算 lookup を 1 関数で
//   - icon プロパティは constants/icons.ts の Icon.* キー (型は緩く string)
// ============================================================

export const MOD_DELETE_REASONS = [
  { key: 'abuse', label: '暴言', icon: 'warn' },
  { key: 'spam', label: 'スパム', icon: 'shield' },
  { key: 'harassment', label: '誹謗中傷', icon: 'warn' },
  { key: 'rule_violation', label: 'ルール違反', icon: 'block' },
  { key: 'inappropriate', label: '不適切な内容', icon: 'warn' },
  { key: 'other', label: 'その他', icon: 'comment' },
] as const;

export type ModDeleteReasonKey = typeof MOD_DELETE_REASONS[number]['key'];

export const MOD_KICK_REASONS = [
  { key: 'repeated_violation', label: '繰り返しの違反', icon: 'warn' },
  { key: 'community_inappropriate', label: 'コミュに不適切', icon: 'block' },
  { key: 'harassment', label: '他メンバーへの嫌がらせ', icon: 'shield' },
  { key: 'other', label: 'その他', icon: 'comment' },
] as const;

export type ModKickReasonKey = typeof MOD_KICK_REASONS[number]['key'];

export const MOD_BAN_REASONS = [
  { key: 'severe_violation', label: '重大なルール違反', icon: 'warn' },
  { key: 'repeated_abuse', label: '繰り返しの暴言', icon: 'block' },
  { key: 'spam_account', label: 'スパムアカウント', icon: 'shield' },
  { key: 'doxxing', label: '個人情報の晒し', icon: 'warn' },
  { key: 'other', label: 'その他', icon: 'comment' },
] as const;

export type ModBanReasonKey = typeof MOD_BAN_REASONS[number]['key'];

// 3 列挙体合算の lookup map (key -> label)。
// 同じ key (例: 'other') が複数あっても安全なように、登場順で固定。
// 'harassment' は delete / kick の両方に存在するが label は同一。
const ALL_REASONS = [
  ...MOD_DELETE_REASONS,
  ...MOD_KICK_REASONS,
  ...MOD_BAN_REASONS,
] as const;

/**
 * reason key を表示用 label に変換する。
 *
 * - null / undefined / 空文字 → '理由なし'
 * - 既知の key → label
 * - 不明な key → そのまま reason 文字列を返す (free-text の 'その他' 経由分など)
 *
 * @param reason 削除/キック/BAN の reason key, または free-text の理由
 */
export function getReasonLabel(reason: string | null | undefined): string {
  if (!reason || reason.trim().length === 0) return '理由なし';
  const hit = ALL_REASONS.find((r) => r.key === reason);
  if (hit) return hit.label;
  // 未登録 (free-text) の場合はそのまま (UI 側で truncate などするのは呼び出し側責務)
  return reason;
}

/**
 * action 種別ごとの preset list を返す helper。
 *
 * @param action 'delete' | 'kick' | 'ban'
 */
export function getReasonsFor(
  action: 'delete' | 'kick' | 'ban',
): readonly { readonly key: string; readonly label: string; readonly icon: string }[] {
  if (action === 'delete') return MOD_DELETE_REASONS;
  if (action === 'kick') return MOD_KICK_REASONS;
  return MOD_BAN_REASONS;
}
