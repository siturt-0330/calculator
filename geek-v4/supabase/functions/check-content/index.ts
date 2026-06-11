// ============================================================
// check-content: 投稿前のコンテンツモデレーション
// ============================================================
// 監査修正:
//   - content の型を string で厳格チェック (object / null / array はエラー)
//   - Unicode 正規化 (NFKC) + 空白除去で「個 人情報」のような回避を阻止
//   - catch 時は ok:false (fail-secure) ※ 旧実装は ok:true でバイパス可能だった
//   - CORS allowlist 方式
//   - パターン拡充 (メール / 電話番号 / マイナンバー / クレカ番号など)
//
// 注意: 本関数は最初のフィルタリング層であり、
//       本格的なモデレーションは LLM ベースの edge function に移行予定。
// ============================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { buildCorsHeaders, jsonResponse } from '../_shared/cors.ts';

const MAX_CONTENT_LEN = 10_000;

// 個人情報パターン (大まかなヒューリスティック)
// 監査指摘: 旧版は word boundary が緩く「0万円から1000-200-3000円」のような
// 値段表現でも電話番号として誤検出していた。前後に非数字を要求して回避。
const BANNED_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /個人情報/u, reason: '個人情報という語を含みます' },
  { pattern: /本名は|住所は|電話番号は|電話は|tel:|電話[::]/iu, reason: '個人情報の記載が疑われます' },
  // 日本の電話番号: 前後に数字/英字無し
  {
    pattern: /(?<![\d\w])(?:\+?81[- ]?|0)\d{1,4}[- ]?\d{1,4}[- ]?\d{4}(?![\d\w])/u,
    reason: '電話番号が含まれている可能性',
  },
  // メールアドレス
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, reason: 'メールアドレスが含まれている可能性' },
  // クレジットカード番号 (16 桁、前後に非数字)
  {
    pattern: /(?<!\d)(?:\d[ -]?){15}\d(?!\d)/u,
    reason: 'カード番号らしき数字列',
  },
  // マイナンバー (12 桁、前後に非数字)
  {
    pattern: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/u,
    reason: 'マイナンバーらしき数字列',
  },
  // 郵便番号 — 〒 か明示的な「郵便番号:」文脈が必要 (誤検出抑制)
  {
    // ★ [\s\-－] のハイフンは要エスケープ — /u モードで [\s-－] は「\s〜－の範囲」と解釈され
    //   SyntaxError → モジュール評価失敗 → 関数 boot 不能 (503) になっていた [実証済: V8 で再現]
    pattern: /(?:〒\s*|郵便番号[\s::]*)\d{3}[\s\-－]?\d{4}/u,
    reason: '郵便番号らしき数字列',
  },
];

function normalize(input: string): string {
  // NFKC で半角全角統一、ゼロ幅文字除去、空白圧縮
  let s = input.normalize('NFKC');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, ''); // zero-width chars
  s = s.replace(/\s+/g, ' '); // 連続空白を 1 つに
  return s;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse(req, { ok: false, reason: 'bad-request' }, 400);
    }
    const raw = (body as { content?: unknown }).content;
    if (typeof raw !== 'string') {
      // 厳格: object / null / array は弾く (旧実装は cast していた)
      return jsonResponse(req, { ok: false, reason: 'content must be string' }, 400);
    }
    if (raw.length > MAX_CONTENT_LEN) {
      return jsonResponse(req, { ok: false, reason: '本文が長すぎます' }, 400);
    }

    const normalized = normalize(raw);

    for (const { pattern, reason } of BANNED_PATTERNS) {
      if (pattern.test(normalized)) {
        return jsonResponse(req, { ok: false, reason });
      }
    }

    return jsonResponse(req, { ok: true });
  } catch {
    // fail-secure: 想定外エラー時は投稿を許可しない
    return jsonResponse(req, { ok: false, reason: 'internal' }, 500);
  }
});
