// ============================================================
// app/bbs/create.tsx — 旧 BBS create route → /post/create?title=1 へ redirect
// ============================================================
// migration 0075 で BBS スレッドは posts に統合された。
// 新規スレ作成は post/create に title 入力モード (?title=1) で対応。
// ============================================================
import { Redirect } from 'expo-router';

export default function BBSCreateRedirect() {
  return <Redirect href={'/post/create?title=1' as never} />;
}
