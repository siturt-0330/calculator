// ============================================================
// lib/safety/spamDetection.ts
//
// 投稿送信前のスパム/安全チェックモジュール
// - クライアントサイド: 同期ヒューリスティック (checkSpamBeforePost)
// - サーバーサイド: レートリミット (checkRateLimitServer) / 重複検知 (checkDuplicateContent)
// - 便利関数: runAllChecks (全チェックを順番に実行)
//
// 設計上の注意:
//   - このファイルは React Native / Web の両環境で動作する
//   - Node.js の crypto モジュールは使わず純粋な JS ハッシュ関数を使用
//   - supabase RPC は既存 migration で定義済みのものを想定
// ============================================================

import { supabase } from '../supabase';

// ------------------------------------------------------------
// 型定義
// ------------------------------------------------------------

export type SpamCheckResult = {
  isSpam: boolean;
  reason?: string;
};

// ------------------------------------------------------------
// コンテンツフィルタパターン (明らかなスパム正規表現)
// ------------------------------------------------------------

export const CONTENT_FILTER_PATTERNS: readonly string[] = [
  // 3件以上のURL (URLが連続している場合)
  '(https?://[^\\s]+[\\s\\S]*?){3,}',
  // 同じ文字が10回以上連続 (絵文字・全角含む)
  '(.)\\1{9,}',
  // よくある日本語スパム表現
  '副業.*稼げる',
  '月収.*万円.*保証',
  '簡単.*稼ぎ.*方法',
  'LINE.*追加.*プレゼント',
  '無料.*プレゼント.*登録',
  '今すぐクリック',
  'ダイエット.*効果.*保証',
  '儲かる.*投資.*無料',
  // 情報商材・アフィリエイト系
  '初期費用.*ゼロ.*稼げる',
  '在宅.*高収入.*即日',
  '不労所得.*簡単.*申し込み',
  '完全在宅.*1日.*万円',
  '紹介するだけ.*稼げる',
  '登録無料.*すぐに稼げる',
  // 過剰な絵文字・記号の繰り返し
  '[!！]{5,}',
  '[？?]{5,}',
  '★{4,}',
  '▼{3,}',
  // フィッシング系
  '(パスワード|password).*(入力|確認).*急',
  '(アカウント|account).*(停止|suspended).*(解除|解锁)',
  '(本人確認|verify).*(今すぐ|immediately).*(クリック|click)',
];

// ------------------------------------------------------------
// 内部ユーティリティ: djb2 ハッシュ (純粋 JS)
// ------------------------------------------------------------

/**
 * djb2 アルゴリズムで文字列から 32bit 符号なし整数ハッシュを計算する。
 * Node.js crypto に依存しないため RN / Web 両対応。
 *
 * Unicode 文字 (日本語など) を正しく扱うため charCodeAt ではなく
 * codePointAt を使い、サロゲートペア (絵文字等) も含む全コードポイントを
 * ハッシュに反映する。
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  // スプレッドで Unicode コードポイント単位に分割 (サロゲートペア対応)
  for (const char of str) {
    const cp = char.codePointAt(0) ?? 0;
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash) ^ cp;
  }
  // 符号なし 32bit に変換して 16 進文字列に
  // eslint-disable-next-line no-bitwise
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------
// 1. クライアントサイド スパムチェック (同期)
// ------------------------------------------------------------

/**
 * 投稿内容をローカルのヒューリスティックでスパム判定する。
 * 送信前の軽量バリデーションとして使用する。
 *
 * @param content チェック対象の投稿テキスト
 * @returns SpamCheckResult — isSpam=true の場合は reason に判定理由を含む
 */
export function checkSpamBeforePost(content: string): SpamCheckResult {
  // a. 空チェック
  if (content.trim().length === 0) {
    return { isSpam: true, reason: 'isEmpty' };
  }

  // b. 同一文字の連続 (10文字以上)
  const repeatCharsPattern = /(.)\1{9,}/u;
  if (repeatCharsPattern.test(content)) {
    return { isSpam: true, reason: 'repeatChars' };
  }

  // c. 全角大文字率チェック (半角英字が対象、20文字超で80%以上が大文字)
  if (content.length > 20) {
    const asciiLetters = content.match(/[a-zA-Z]/g);
    if (asciiLetters && asciiLetters.length > 0) {
      const upperCount = (content.match(/[A-Z]/g) ?? []).length;
      const upperRatio = upperCount / asciiLetters.length;
      if (upperRatio > 0.8) {
        return { isSpam: true, reason: 'allCaps' };
      }
    }
  }

  // d. URL が 3件以上含まれる
  const urlMatches = content.match(/https?:\/\/[^\s]+/gi);
  if (urlMatches && urlMatches.length >= 3) {
    return { isSpam: true, reason: 'tooManyLinks' };
  }

  // e. 既定スパムパターンに一致
  for (const pattern of CONTENT_FILTER_PATTERNS) {
    try {
      if (new RegExp(pattern, 'iu').test(content)) {
        return { isSpam: true, reason: 'suspiciousPatterns' };
      }
    } catch {
      // 不正な正規表現は無視
    }
  }

  return { isSpam: false };
}

// ------------------------------------------------------------
// 2. サーバーサイド レートリミットチェック
// ------------------------------------------------------------

/**
 * Supabase RPC `check_and_log_post_rate` を呼び出し、
 * 投稿レートリミットをチェックする。
 *
 * - 成功: { allowed: true }
 * - レートリミット超過 (errcode 53400) またはエラー: { allowed: false, message }
 * - ネットワークエラー等 (fail-open): { allowed: true } — サーバー側にフォールバック
 */
export async function checkRateLimitServer(): Promise<{
  allowed: boolean;
  message?: string;
}> {
  try {
    const { error } = await supabase.rpc('check_and_log_post_rate');

    if (!error) {
      return { allowed: true };
    }

    // PostgreSQL errcode 53400 = too_many_connections / レートリミット超過
    if (error.code === '53400') {
      return {
        allowed: false,
        message: error.message || '投稿の頻度が高すぎます。しばらくしてから再試行してください。',
      };
    }

    // その他のエラー (詳細メッセージを優先して返す)
    return {
      allowed: false,
      message: error.message || 'レートリミットの確認中にエラーが発生しました。',
    };
  } catch (err) {
    // ネットワーク断等は fail-open (サーバー側 RLS で守られる)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました。';
    return { allowed: false, message };
  }
}

// ------------------------------------------------------------
// 3. 重複コンテンツチェック
// ------------------------------------------------------------

/**
 * 投稿内容の djb2 ハッシュを計算し、Supabase RPC `check_duplicate_content` で
 * 同一ユーザーによる重複投稿を検知する。
 *
 * @param content チェック対象の投稿テキスト
 * @returns true: 重複あり / false: 重複なし (エラー時も fail-open で false)
 */
export async function checkDuplicateContent(content: string): Promise<boolean> {
  const contentHash = djb2Hash(content.trim());

  try {
    const { data, error } = await supabase.rpc('check_duplicate_content', {
      p_content_hash: contentHash,
    });

    if (error) {
      // エラー時はスパム判定しない (fail-open: 投稿を止めない)
      return false;
    }

    // RPC が boolean または { is_duplicate: boolean } を返すケースに対応
    if (typeof data === 'boolean') {
      return data;
    }
    if (data !== null && typeof data === 'object' && 'is_duplicate' in data) {
      return Boolean((data as { is_duplicate: boolean }).is_duplicate);
    }

    return false;
  } catch {
    // ネットワークエラー等は fail-open
    return false;
  }
}

// ------------------------------------------------------------
// 4. 全チェックをまとめて実行する便利関数
// ------------------------------------------------------------

/**
 * クライアントサイドのヒューリスティック → レートリミット → 重複検知の
 * 順にすべてのスパムチェックを実行し、最初に引っかかったものを返す。
 *
 * - checkSpamBeforePost が isSpam=true を返した時点で即終了 (サーバー呼び出しなし)
 * - checkRateLimitServer が allowed=false なら isSpam=true として返す
 * - checkDuplicateContent が true なら isSpam=true (reason: 'duplicate') として返す
 * - 全チェック通過: { isSpam: false }
 *
 * @param content 投稿内容
 * @returns SpamCheckResult
 */
export async function runAllChecks(content: string): Promise<SpamCheckResult> {
  // 1. クライアントサイドの同期チェック
  const localResult = checkSpamBeforePost(content);
  if (localResult.isSpam) {
    return localResult;
  }

  // 2. サーバーサイド レートリミットチェック
  const rateResult = await checkRateLimitServer();
  if (!rateResult.allowed) {
    return { isSpam: true, reason: rateResult.message ?? 'rateLimitExceeded' };
  }

  // 3. 重複コンテンツチェック
  const isDuplicate = await checkDuplicateContent(content);
  if (isDuplicate) {
    return { isSpam: true, reason: 'duplicate' };
  }

  return { isSpam: false };
}
