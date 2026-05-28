// ============================================================
// app/bbs/[id].tsx — 旧 BBS thread 詳細 → /post/[id] へ redirect
// ============================================================
// migration 0075 で bbs_threads は posts に UUID 保持で統合された。
// 旧 deep link (notification の thread_id payload, 共有 URL 等) を保つため、
// このルートは残し、 同一 UUID で /post/[id] に redirect する。
// ============================================================
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function BBSThreadRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/(tabs)/feed" />;
  return <Redirect href={`/post/${id}` as never} />;
}
