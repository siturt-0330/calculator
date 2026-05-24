import { Stack, Redirect } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { isAdminUser } from '../../lib/admin';

// ============================================================
// 隠し admin パネル — /admin URL で直接叩いた時だけ到達できる。
// app のナビゲーションには一切リンクを生やしていない。
//
// client gate:
//   - 未ログイン or 別ユーザー → /(tabs)/feed に redirect (Stack は描画しない)
//   - admin email のみ通す (lib/admin.ts に集約)
// server gate:
//   - 0025_admin_role.sql の RLS で is_admin=true な profile だけが
//     全 profiles / posts / bbs_threads / communities にアクセスできる
//   - URL 直打ち + email 偽装が出来ても、データは何も取れない (空配列が返る)
//
// dev shortcut:
//   - Web: Cmd/Ctrl + Shift + A (hooks/useAdminShortcut.ts)
//   - Native + Web: feed.tsx の Geek ワードマーク長押し
// ============================================================
export default function AdminLayout() {
  const user = useAuthStore((s) => s.user);
  if (!isAdminUser(user)) {
    return <Redirect href="/(tabs)/feed" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
