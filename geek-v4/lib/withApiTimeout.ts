// ============================================================
// withApiTimeout
// ============================================================
// Supabase の `.select()` / `.insert()` 等が返す PostgrestBuilder は thenable で
// あって Promise<T> の挙動をするが、固有の "リクエスト中断" 機構が無い。
// ネットワークが詰まると無限待ちになるので、呼び出し側で timeout race するのが
// 一番堅実。lib/resilient.ts はリトライまでセットだが、リトライ不要 / 副作用あり
// のケースでは重い。
//
// この helper は **timeout だけ** を加える軽量版。
//   - 成功時: そのまま resolve
//   - timeout: throw new Error(`<label> timeout after Nms`)
//   - 失敗: そのまま reject
//
// 使い方:
//   const data = await withApiTimeout(
//     supabase.from('posts').select('*'),
//     'posts.fetch',
//     8000,
//   );
//
// 注: Supabase のリクエスト自体はバックグラウンドで継続する (AbortController が
// 提供されていないため)。ただし caller は待ち続けず、UI に error を返せる。
// ============================================================

const DEFAULT_TIMEOUT_MS = 10_000;

export async function withApiTimeout<T>(
  promise: Promise<T> | PromiseLike<T>,
  label: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  // PostgrestBuilder は thenable なので Promise.race に直接渡せる。
  return Promise.race<T>([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`[${label}] timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]);
}
