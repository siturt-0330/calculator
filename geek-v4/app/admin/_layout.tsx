import { Stack, Redirect } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

// ============================================================
// 隠し admin パネル — /admin URL で直接叩いた時だけ到達できる。
// app のナビゲーションには一切リンクを生やしていない。
//
// client gate:
//   - 未ログイン or 別ユーザー → /(tabs)/feed に redirect (Stack は描画しない)
//   - admin email のみ通す
// server gate:
//   - 0025_admin_role.sql の RLS で is_admin=true な profile だけが
//     全 profiles / posts / bbs_threads / communities にアクセスできる
//   - URL 直打ち + email 偽装が出来ても、データは何も取れない (空配列が返る)
// ============================================================
const ADMIN_EMAIL = 'siturt0330@gmail.com';

export default function AdminLayout() {
  const user = useAuthStore((s) => s.user);
  if (!user || user.email !== ADMIN_EMAIL) {
    return <Redirect href="/(tabs)/feed" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
