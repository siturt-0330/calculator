// ============================================================
// passwordPolicy.ts — クライアント側パスワード検証ポリシー
// ============================================================
// 監査での指摘 (Medium): 8 文字以上だけのチェックで credential stuffing に弱い。
// → 最低限「英字 + 数字」の文字種 2 種類を要求する。
//
// 本物の防御は Supabase ダッシュボード側のポリシー
// (Authentication → Policies → Password Requirements: Letters + Digits)
// で重複設定すること。クライアントは UX 改善が目的。
// ============================================================

export const MIN_PASSWORD_LEN = 8;
export const MAX_PASSWORD_LEN = 72; // bcrypt 上限

/** 一般的な弱いパスワードの単純な検出 (網羅的ではないが noticeable な値を弾く) */
const COMMON_WEAK = new Set([
  'password', 'password1', 'password123',
  '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'qwertyui',
  'abc12345', 'abcd1234', 'abcdef12',
  'iloveyou', 'letmein1', 'welcome1',
  'admin123', 'p@ssw0rd', 'P@ssword',
]);

export type PasswordCheck = {
  ok: boolean;
  reason?: string;       // ユーザー表示用の理由
};

/**
 * パスワードの強度を検証する。
 *   - 長さ: 8〜72 文字
 *   - 英字 + 数字を両方含む
 *   - 単一文字の繰り返しのみは NG (例: "aaaaaaaa")
 *   - 一般的な弱パスを NG
 */
export function validatePassword(pw: string): PasswordCheck {
  if (typeof pw !== 'string') {
    return { ok: false, reason: 'パスワードを入力してください。' };
  }
  if (pw.length < MIN_PASSWORD_LEN) {
    return { ok: false, reason: `パスワードは ${MIN_PASSWORD_LEN} 文字以上にしてください。` };
  }
  if (pw.length > MAX_PASSWORD_LEN) {
    return { ok: false, reason: `パスワードは ${MAX_PASSWORD_LEN} 文字以内にしてください。` };
  }
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  if (!hasLetter || !hasDigit) {
    return {
      ok: false,
      reason: 'パスワードは英字と数字を両方含めてください。',
    };
  }
  // 全部同じ文字 (例: "aaaaaaaa" は英字だけ → 上ですり抜けるが、数字混入でも "11111111a" 等)
  if (/^(.)\1+$/.test(pw)) {
    return { ok: false, reason: '同じ文字の繰り返しは使えません。' };
  }
  if (COMMON_WEAK.has(pw.toLowerCase())) {
    return { ok: false, reason: 'よく使われるパスワードのため使えません。' };
  }
  return { ok: true };
}

/**
 * UI 用の強度メーター値 (0..4)。色つきバーで表示する用途。
 *   0: very weak / 1: weak / 2: fair / 3: good / 4: strong
 */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
