// ============================================================
// Rate Limit (client-side, anti-spam)
// ============================================================
// クライアントサイドで簡易レートリミット。サーバー側 RLS と合わせて多層防御。
// 主な制約:
//   post:        5 / 分     (連投防止)
//   comment:     10 / 分    (荒らし防止)
//   bbs_reply:   10 / 分
//   reaction:    30 / 分    (連打防止)
//   like:        60 / 分
//   tag_add:     20 / 分
//   custom_stamp: 5 / 10分  (スタンプ濫造防止)
//
// 永続化なし: アプリ再起動で reset。本当に重要な制限は server-side で。
// ============================================================

type Window = { count: number; windowStart: number };

const limits: Record<string, { max: number; windowMs: number }> = {
  post:           { max: 5,  windowMs: 60 * 1000 },
  comment:        { max: 10, windowMs: 60 * 1000 },
  bbs_reply:      { max: 10, windowMs: 60 * 1000 },
  bbs_thread:     { max: 3,  windowMs: 60 * 1000 },
  reaction:       { max: 30, windowMs: 60 * 1000 },
  like:           { max: 60, windowMs: 60 * 1000 },
  concern:        { max: 20, windowMs: 60 * 1000 },
  tag_add:        { max: 20, windowMs: 60 * 1000 },
  custom_stamp:   { max: 5,  windowMs: 10 * 60 * 1000 },
  bookmark:       { max: 30, windowMs: 60 * 1000 },
  feedback:       { max: 3,  windowMs: 10 * 60 * 1000 },
  community_post: { max: 5,  windowMs: 60 * 1000 },
  community_create: { max: 3, windowMs: 10 * 60 * 1000 },
  // 招待コード受諾: brute-force による invite code 総当たり防止
  friend_invite_accept: { max: 5, windowMs: 60 * 1000 },
  // 認証: brute-force / credential-stuffing / spam-account の抑止。
  // 在メモリ (再起動で reset) なので server-side 制限との多層防御の一段目。
  login:          { max: 8,  windowMs: 5 * 60 * 1000 },
  signup:         { max: 5,  windowMs: 10 * 60 * 1000 },
  password_reset: { max: 5,  windowMs: 10 * 60 * 1000 },
};

const state = new Map<string, Window>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
};

export function checkRate(action: keyof typeof limits): RateLimitResult {
  const cfg = limits[action];
  if (!cfg) return { ok: true, remaining: Infinity, retryAfterMs: 0 };
  const now = Date.now();
  const cur = state.get(action) ?? { count: 0, windowStart: now };
  // 端末時計が逆行 (NTP sync / 手動変更) しても rate limit が bypass されないよう
  // elapsed の絶対値で判定。負値なら新 window としてリセット。
  const elapsed = now - cur.windowStart;
  if (elapsed < 0 || elapsed > cfg.windowMs) {
    // clock skew or window expiry: 新 window 開始
    state.set(action, { count: 1, windowStart: now });
    return { ok: true, remaining: cfg.max - 1, retryAfterMs: 0 };
  }
  if (cur.count >= cfg.max) {
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: cfg.windowMs - (now - cur.windowStart),
    };
  }
  cur.count += 1;
  state.set(action, cur);
  return { ok: true, remaining: cfg.max - cur.count, retryAfterMs: 0 };
}

export function rateLimitMessage(action: keyof typeof limits, retryAfterMs: number): string {
  const sec = Math.ceil(retryAfterMs / 1000);
  const labels: Record<string, string> = {
    post: '投稿', comment: 'コメント', bbs_reply: '掲示板の返信',
    reaction: 'リアクション', like: 'いいね', concern: '気になる',
    tag_add: 'タグ追加', custom_stamp: 'カスタムスタンプ作成',
    bookmark: 'ブックマーク', feedback: 'フィードバック',
    friend_invite_accept: '招待コードの受諾',
    login: 'ログイン', signup: 'アカウント登録', password_reset: 'パスワード再設定',
  };
  const name = labels[action] ?? action;
  if (sec > 60) {
    const min = Math.ceil(sec / 60);
    return `${name}が短時間で多すぎます。${min}分後にお試しください。`;
  }
  return `${name}が短時間で多すぎます。${sec}秒後にお試しください。`;
}

// 開発用: 全リミットをリセット
export function _resetAllRateLimits() {
  state.clear();
}
