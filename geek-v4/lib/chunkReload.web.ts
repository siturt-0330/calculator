// ============================================================
// chunkReload.web.ts — コード分割 chunk の stale 404 自動復帰 (web 専用)
// ------------------------------------------------------------
// なぜ必要か:
//   asyncRoutes (app.json の expo-router plugin 設定) で web の各ルートが
//   個別 JS chunk に分割される。Netlify は atomic deploy で旧 deploy の
//   ハッシュ付き chunk を本番URLから外すため、デプロイ直後にセッション
//   継続中のユーザーが「まだ読み込んでいないルート」へ遷移すると、
//   起動時に読み込んだ index.html が参照する旧ハッシュ chunk が 404 →
//   dynamic import が reject → 遷移不能/白画面になりうる
//   ([[project_geek_v4_web_freshness]] 系のリスク。SW は使っていないので
//   初回ロードは常に整合するが、セッション継続中の遷移だけが穴)。
//
// 対策:
//   chunk 読込失敗を window の 'error' / 'unhandledrejection' で検知したら
//   **1 回だけ** full reload して最新の index.html + chunk を取り直す。
//   reload ループ防止に sessionStorage で直近 reload 時刻をガードし、
//   COOLDOWN_MS 以内の再発はリロードせず素通り (真に壊れた chunk で
//   無限リロードにならないため)。
// ============================================================
const RELOAD_FLAG = 'geek:chunk-reloaded-at';
const COOLDOWN_MS = 10_000;

// dynamic import / chunk 読込失敗の代表的メッセージ (ブラウザ差を吸収)。
const CHUNK_ERROR_RE =
  /Loading chunk \S+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i;

function looksLikeChunkError(msg: string | null | undefined): boolean {
  return !!msg && CHUNK_ERROR_RE.test(msg);
}

function reloadOnce(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || '0');
    const now = Date.now();
    if (now - last < COOLDOWN_MS) return; // 直近で reload 済 → ループ防止
    sessionStorage.setItem(RELOAD_FLAG, String(now));
  } catch {
    // sessionStorage 不可環境でも reload 自体は試みる
  }
  window.location.reload();
}

let installed = false;

/** web 専用の chunk 読込エラー自動リロード guard。冪等 (二重登録しない)。 */
export function installChunkReloadGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    const errMsg = (e?.error as Error | undefined)?.message;
    if (looksLikeChunkError(e?.message) || looksLikeChunkError(errMsg)) {
      reloadOnce();
    }
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = e?.reason as { message?: string; name?: string } | string | undefined;
    const msg = typeof reason === 'string' ? reason : reason?.message;
    const name = typeof reason === 'object' && reason ? reason.name : undefined;
    if (looksLikeChunkError(msg) || name === 'ChunkLoadError') {
      reloadOnce();
    }
  });
}
