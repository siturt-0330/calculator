// ============================================================
// app/(tabs)/community/[id]/bbs.tsx — community sub-tab → community home へ redirect
// ============================================================
// migration 0075 で thread は posts に統合され、 community home feed に
// title 付き post として混ざる。 専用 BBS sub-tab は不要に。
// deep link /community/[id]/bbs は同じ community detail に redirect する。
// ============================================================
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function CommunityBBSRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/(tabs)/community" />;
  return <Redirect href={`/(tabs)/community/${id}` as never} />;
}
