// ============================================================
// app/search.tsx — legacy URL redirect
// ------------------------------------------------------------
// 旧 /search URL (通知ディープリンク・共有リンク) を tab 化した
// /(tabs)/search に転送する。実装は app/(tabs)/search.tsx 側。
// ============================================================
import { Redirect } from 'expo-router';

export default function SearchRedirect() {
  return <Redirect href={'/(tabs)/search' as never} />;
}
