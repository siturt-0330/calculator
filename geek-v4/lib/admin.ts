// ============================================================
// admin.ts — 「この user は admin か?」の唯一の判定 source
// ============================================================
// 既存の app/admin/_layout.tsx に直書きされていた email 比較を切り出し、
// 開発者向け shortcut (キーボード / 長押し) からも参照できるようにする。
// server 側は 0025_admin_role.sql の RLS で is_admin=true profile のみ
// 全データにアクセス可。client gate は「URL を叩いてもガード画面で
// /(tabs)/feed に飛ばす」「shortcut も admin にしか反応しない」程度の
// 軽い目隠し。本質的な access control は RLS で行う。
// ============================================================

export const ADMIN_EMAIL = 'siturt0330@gmail.com';

export type UserLike = { email?: string | null } | null | undefined;

export function isAdminUser(user: UserLike): boolean {
  return !!user && user.email === ADMIN_EMAIL;
}
