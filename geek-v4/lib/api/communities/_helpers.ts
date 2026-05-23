// ============================================================
// communities/_helpers.ts — internal-only helpers
// ============================================================
// underscore prefix は「barrel re-export しない」マーカー。
// consumer は communities.ts barrel から import するため、ここの
// 関数を外から呼べない (し、呼ぶべきでない)。
// ============================================================

// ============================================================
// 参加系エラーメッセージのマッピング
// ============================================================
// Supabase / PostgREST から返ってくる生のエラーメッセージを日本語に丸める。
// 0025 migration 後は RPC が日本語メッセージを直接返すので、それを優先する。
export function mapJoinError(raw: string): string {
  if (!raw) return 'コミュニティ参加に失敗しました。時間をおいて再度お試しください。';
  // RPC が直接返す日本語メッセージ
  if (/^[ぁ-んァ-ヴ一-龯]/.test(raw)) return raw;

  const m = raw.toLowerCase();
  if (m.includes('row-level security') || m.includes('行レベル') || m.includes('rls')) {
    return 'ログイン状態が古くなっています。一度ログアウトして入り直すか、しばらく経ってから再試行してください。';
  }
  if (m.includes('not_authenticated') || m.includes('jwt') || m.includes('not authenticated')) {
    return 'ログイン情報を確認できませんでした。再度ログインしてください。';
  }
  if (m.includes('invite_only') || m.includes('invite-only')) {
    return 'このコミュニティは招待制です。招待リンクから参加してください。';
  }
  if (m.includes('requires_approval') || m.includes('requires approval')) {
    return 'このコミュニティは参加申請が必要です。';
  }
  if (m.includes('community_not_found') || m.includes('not found')) {
    return 'コミュニティが見つかりません。削除された可能性があります。';
  }
  if (m.includes('duplicate key') || m.includes('unique constraint') || m.includes('already')) {
    return '既にこのコミュニティに登録 / 申請済みです。';
  }
  if (m.includes('network') || m.includes('fetch failed')) {
    return 'ネットワークエラー。接続を確認してください。';
  }
  // 監査追加: PostgreSQL の標準エラーコード / メッセージを追加翻訳
  if (m.includes('permission denied') || m.includes('insufficient_privilege') || m.includes('42501')) {
    return 'この操作を行う権限がありません。';
  }
  if (m.includes('pgrst') && m.includes('no row')) {
    return '対象が見つかりません。削除された可能性があります。';
  }
  if (m.includes('rate-limit') || m.includes('rate_limit') || m.includes('53300')) {
    return '短時間に試行しすぎました。少し時間を置いてからお試しください。';
  }
  if (m.includes('foreign key') || m.includes('23503')) {
    return '依存関係のあるデータがあるため操作できません。';
  }
  if (m.includes('check constraint') || m.includes('23514')) {
    return '入力内容が制約を満たしていません。';
  }
  if (m.includes('22023')) {
    return '不正な状態遷移です (承認済み/却下済みからは変更できません)。';
  }
  return raw;
}

// ============================================================
// PostgREST or() 文法と ilike を破壊する文字をエスケープ
// ============================================================
// 旧実装の searchByName / searchCommunities が `%` / `_` / `,` / `(` / `)` を
// 直接渡していた事故 (ilike 全件マッチ / 構文崩壊) を防ぐ。
export function escapeForIlike(s: string): string {
  return s
    .replace(/\\/g, '\\\\')      // backslash 先
    .replace(/%/g, '\\%')         // ilike wildcard
    .replace(/_/g, '\\_')         // ilike wildcard
    .replace(/[,()]/g, '');       // PostgREST or() の区切り文字を削除
}
