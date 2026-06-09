// ============================================================
// lib/safety/spamDetection.ts のユニットテスト
// ============================================================
// 対象:
//   - checkSpamBeforePost  (クライアントサイド同期チェック)
//   - runAllChecks          (全チェックの統合ラッパ)
//
// checkRateLimitServer は Supabase RPC を直接呼ぶため
// ここではテストしない (integration test でモックなしで行う)。
//
// Supabase クライアント (lib/supabase) は jest.mock で差し替え、
// テスト内で任意の RPC 応答を注入する。
// ============================================================

// ---- Supabase クライアントを mock に差し替え ----
// checkRateLimitServer / checkDuplicateContent が呼ぶ supabase.rpc を制御する。
const mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  checkSpamBeforePost,
  runAllChecks,
} from '../../lib/safety/spamDetection';

// ============================================================
// checkSpamBeforePost — 同期チェック
// ============================================================

describe('checkSpamBeforePost — 空文字列', () => {
  it('空文字列は isSpam: true (reason に "empty" を含む)', () => {
    const result = checkSpamBeforePost('');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBeDefined();
    expect(result.reason?.toLowerCase()).toContain('empty');
  });

  it('スペースのみも空と判定される', () => {
    const result = checkSpamBeforePost('   ');
    expect(result.isSpam).toBe(true);
    expect(result.reason?.toLowerCase()).toContain('empty');
  });

  it('全角スペースのみも空と判定される', () => {
    const result = checkSpamBeforePost('　　　');
    expect(result.isSpam).toBe(true);
    expect(result.reason?.toLowerCase()).toContain('empty');
  });
});

describe('checkSpamBeforePost — 同一文字の繰り返し (repeatChars)', () => {
  it('"aaaaaaaaaa" (a × 10) は isSpam: true', () => {
    const result = checkSpamBeforePost('aaaaaaaaaa');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('repeatChars');
  });

  it('"aaaaaaaaa" (a × 9) はスパム判定されない', () => {
    const result = checkSpamBeforePost('aaaaaaaaa');
    expect(result.isSpam).toBe(false);
  });

  it('全角文字の繰り返し "ああああああああああ" (10文字) も isSpam: true', () => {
    const result = checkSpamBeforePost('ああああああああああ');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('repeatChars');
  });

  it('絵文字の繰り返し (10個以上) も isSpam: true', () => {
    // 各絵文字はサロゲートペアだが (.) ユニコードフラグで 1 文字として扱われる
    const result = checkSpamBeforePost('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('repeatChars');
  });
});

describe('checkSpamBeforePost — 全大文字 (allCaps)', () => {
  it('21文字以上の全大文字英字は isSpam: true (reason: allCaps)', () => {
    // 21文字すべて大文字
    const result = checkSpamBeforePost('ABCDEFGHIJKLMNOPQRSTU');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('allCaps');
  });

  it('20文字以下なら allCaps チェックをスキップ', () => {
    // 20文字すべて大文字でも判定しない
    const result = checkSpamBeforePost('ABCDEFGHIJKLMNOPQRST');
    expect(result.isSpam).toBe(false);
  });

  it('大文字率が 80% 以下なら isSpam: false', () => {
    // 大文字 15 + 小文字 10 = 25 ASCII 文字 → 大文字率 60% < 80%
    // "AAAAABBBBBCCCCC" (15 大) + "aaaaabbbbbccccc" (15 小) で 50%
    const result = checkSpamBeforePost('AAAAAbbbbbCCCCCdddddEEEEEfffff');
    // 10 大 + 10 大 = 20 大 / 30 ASCII = 0.667 < 0.8 → false
    expect(result.isSpam).toBe(false);
  });

  it('日本語を含む文字列で大文字と小文字が混在していれば allCaps 判定されない', () => {
    // 大文字 "GEEK" (4) と小文字 "v" (1) が混在 → 大文字率 80% = 0.8 (> 0.8 は strict)
    // 小文字をもう少し増やして 80% 未満にする
    const result = checkSpamBeforePost('これはGeekの投稿テストです。Versionの日本語投稿です。');
    // G(大) e(小) e(小) k(小) V(大) e(小) r(小) s(小) i(小) o(小) n(小)
    // 大文字 2, 小文字 9 → 大文字率 18% < 80% → false
    expect(result.isSpam).toBe(false);
  });
});

describe('checkSpamBeforePost — URL 過多 (tooManyLinks)', () => {
  it('URL が 3件以上で isSpam: true (reason: tooManyLinks)', () => {
    const content = [
      'チェック https://example.com/a',
      'また https://example.com/b',
      'さらに https://example.com/c',
    ].join(' ');
    const result = checkSpamBeforePost(content);
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('tooManyLinks');
  });

  it('URL が 2件は許可される', () => {
    const result = checkSpamBeforePost(
      '参考: https://example.com/a および https://example.com/b',
    );
    expect(result.isSpam).toBe(false);
  });

  it('http と https が混在していても 3件以上でスパム', () => {
    const result = checkSpamBeforePost(
      'http://a.example.com https://b.example.com https://c.example.com',
    );
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('tooManyLinks');
  });
});

describe('checkSpamBeforePost — 正常な日本語テキスト', () => {
  it('普通の日本語投稿は isSpam: false', () => {
    const result = checkSpamBeforePost(
      'アニメの感想です。今期の推し作品はとても面白かったです！',
    );
    expect(result.isSpam).toBe(false);
  });

  it('短い日本語 1 文字も問題なし', () => {
    const result = checkSpamBeforePost('あ');
    expect(result.isSpam).toBe(false);
  });

  it('日本語 + 英数字の通常投稿も通過', () => {
    const result = checkSpamBeforePost('GEEK v4 のテスト投稿です。URL は https://example.com のみ。');
    expect(result.isSpam).toBe(false);
  });

  it('句読点・記号が少量含まれても問題なし', () => {
    const result = checkSpamBeforePost('良い投稿ですね！(^_^)v ありがとう★');
    expect(result.isSpam).toBe(false);
  });
});

describe('checkSpamBeforePost — スパムパターン (suspiciousPatterns)', () => {
  it('日本語スパム: 副業稼げる → isSpam: true', () => {
    const result = checkSpamBeforePost('この副業で稼げる方法を教えます');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('suspiciousPatterns');
  });

  it('感嘆符 5 個以上 → isSpam: true', () => {
    const result = checkSpamBeforePost('すごい！！！！！今すぐ見て');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('suspiciousPatterns');
  });

  it('感嘆符 4 個は許可 (5 未満)', () => {
    const result = checkSpamBeforePost('すごい！！！！今すぐ見て');
    // suspiciousPatterns による判定なしなら isSpam: false (他チェックも通過)
    // 注意: 4個の「！」はパターン [!！]{5,} にマッチしない
    expect(result.reason).not.toBe('suspiciousPatterns');
  });
});

// ============================================================
// runAllChecks — 全チェック統合
// ============================================================

describe('runAllChecks — クライアントチェックで早期リターン', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('空文字列はクライアントチェックで即 isSpam: true、RPC 呼び出しなし', async () => {
    const result = await runAllChecks('');
    expect(result.isSpam).toBe(true);
    expect(result.reason?.toLowerCase()).toContain('empty');
    // Supabase RPC は一切呼ばれないはず
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('同一文字繰り返しはクライアントチェックで即 isSpam: true、RPC 呼び出しなし', async () => {
    const result = await runAllChecks('aaaaaaaaaa');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('repeatChars');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('runAllChecks — レートリミット超過', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('checkRateLimitServer が 53400 を返すと isSpam: true', async () => {
    // 1 回目の rpc 呼び出し (check_and_log_post_rate) → 53400 エラー
    // 2 回目の rpc 呼び出し (check_duplicate_content) → 呼ばれないはず
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '53400', message: '投稿の頻度が高すぎます。' },
    });

    const result = await runAllChecks('普通の投稿テキストです。');
    expect(result.isSpam).toBe(true);
    // reason はレートリミットのメッセージまたは 'rateLimitExceeded'
    expect(result.reason).toBeDefined();
    // 重複チェックの rpc は呼ばれない
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('check_and_log_post_rate');
  });
});

describe('runAllChecks — 重複コンテンツ検知', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('check_duplicate_content が true を返すと isSpam: true, reason: duplicate', async () => {
    // 1 回目: check_and_log_post_rate → 成功 (allowed: true)
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    // 2 回目: check_duplicate_content → true (重複あり)
    mockRpc.mockResolvedValueOnce({ data: true, error: null });

    const result = await runAllChecks('重複している投稿内容です。');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('duplicate');
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'check_duplicate_content', expect.any(Object));
  });

  it('check_duplicate_content が { is_duplicate: true } オブジェクトを返しても duplicate 判定', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    mockRpc.mockResolvedValueOnce({ data: { is_duplicate: true }, error: null });

    const result = await runAllChecks('重複している投稿内容です。');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toBe('duplicate');
  });
});

describe('runAllChecks — 全チェック通過', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('全チェック通過で isSpam: false', async () => {
    // check_and_log_post_rate → 成功
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    // check_duplicate_content → false (重複なし)
    mockRpc.mockResolvedValueOnce({ data: false, error: null });

    const result = await runAllChecks('ふつうの投稿です。特に問題はありません。');
    expect(result.isSpam).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

describe('runAllChecks — fail-open 動作', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('checkDuplicateContent でエラーが発生しても fail-open (isSpam: false)', async () => {
    // check_and_log_post_rate → 成功
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    // check_duplicate_content → エラー (ネットワーク障害等)
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST000', message: 'DB error' } });

    const result = await runAllChecks('正常な投稿内容です。');
    // エラー時は fail-open → 重複なしとみなす
    expect(result.isSpam).toBe(false);
  });

  it('checkDuplicateContent で例外が投げられても fail-open', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    mockRpc.mockRejectedValueOnce(new Error('network timeout'));

    const result = await runAllChecks('正常な投稿内容です。');
    expect(result.isSpam).toBe(false);
  });
});
