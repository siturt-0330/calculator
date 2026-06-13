// ============================================================
// app/search.tsx — legacy URL redirect
// ------------------------------------------------------------
// 旧 /search URL (通知ディープリンク・共有リンク) を tab 化した
// /(tabs)/search に転送する。実装は app/(tabs)/search.tsx 側。
// ============================================================
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function SearchRedirect() {
  // 旧 /search?q=... のクエリ文字列 (q / community) を引き継いで転送する。
  // 固定文字列 href にすると q が捨てられ、トレンド検索 (/search?q=<topic>) や
  // 共有リンクが「空の検索タブ」に着地してしまう (受け側 (tabs)/search.tsx は
  // params.q / params.community を初期値として読む設計)。
  const params = useLocalSearchParams<{ q?: string; community?: string }>();
  return <Redirect href={{ pathname: '/(tabs)/search', params } as never} />;
}
