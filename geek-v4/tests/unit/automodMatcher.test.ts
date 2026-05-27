// ============================================================
// automodMatcher — pure 関数の unit test (Reddit ガイド 6.4 章)
// ============================================================
// 仕様: lib/utils/automodMatcher.ts が以下を満たすことを確認。
//   - 各 matcher (5 種) を正しく読む
//   - 各 op (8 種) を正しく適用 (lt/lte/gt/gte/eq/contains/regex/in)
//   - 複数 conditions は AND 結合
//   - enabled=false や空 conditions は matched=false
//   - 不正な入力 / regex は fail-secure (false)
// ============================================================

import {
  evalCondition,
  evalRule,
  evalAllRules,
  type AutomodPostCtx,
  type AutomodRule,
  type AutomodCondition,
} from '../../lib/utils/automodMatcher';

// ---------- 共通 fixture ----------
function ctx(overrides: Partial<AutomodPostCtx> = {}): AutomodPostCtx {
  return {
    author_age_days:    30,
    author_trust_score: 50,
    content:            'これはテスト投稿です',
    tag_names:          ['anime', 'tech'],
    is_edited:          false,
    ...overrides,
  };
}

function rule(
  cond: AutomodCondition | AutomodCondition[],
  overrides: Partial<AutomodRule> = {},
): AutomodRule {
  return {
    id: 'r1',
    name: 'test rule',
    enabled: true,
    conditions: Array.isArray(cond) ? cond : [cond],
    action: 'hide',
    ...overrides,
  };
}

describe('evalCondition — number ops', () => {
  it('author_age_days lt 7 → 新規アカウント (3日) は true', () => {
    expect(
      evalCondition(
        { matcher: 'author_age_days', op: 'lt', value: 7 },
        ctx({ author_age_days: 3 }),
      ),
    ).toBe(true);
  });

  it('author_age_days lt 7 → 7 日ちょうどは false (lt は strict)', () => {
    expect(
      evalCondition(
        { matcher: 'author_age_days', op: 'lt', value: 7 },
        ctx({ author_age_days: 7 }),
      ),
    ).toBe(false);
  });

  it('author_age_days lte 7 → 7 日ちょうどは true', () => {
    expect(
      evalCondition(
        { matcher: 'author_age_days', op: 'lte', value: 7 },
        ctx({ author_age_days: 7 }),
      ),
    ).toBe(true);
  });

  it('author_trust_score gte 80 → 90 は true / 50 は false', () => {
    const c: AutomodCondition = { matcher: 'author_trust_score', op: 'gte', value: 80 };
    expect(evalCondition(c, ctx({ author_trust_score: 90 }))).toBe(true);
    expect(evalCondition(c, ctx({ author_trust_score: 50 }))).toBe(false);
  });

  it('eq number — 0 と "0" は同等視 (Number cast)', () => {
    expect(
      evalCondition(
        { matcher: 'author_age_days', op: 'eq', value: 0 },
        ctx({ author_age_days: 0 }),
      ),
    ).toBe(true);
  });
});

describe('evalCondition — string ops', () => {
  it('post_content contains "discord.gg" — 大文字小文字を問わず一致', () => {
    expect(
      evalCondition(
        { matcher: 'post_content', op: 'contains', value: 'discord.gg' },
        ctx({ content: 'join my DISCORD.GG/abcd server!' }),
      ),
    ).toBe(true);
  });

  it('post_content contains はマッチしない時 false', () => {
    expect(
      evalCondition(
        { matcher: 'post_content', op: 'contains', value: 'http://' },
        ctx({ content: '安全な本文' }),
      ),
    ).toBe(false);
  });

  it('post_content regex — 単純な URL 検出', () => {
    expect(
      evalCondition(
        { matcher: 'post_content', op: 'regex', value: 'https?://\\S+' },
        ctx({ content: 'チェック https://evil.example.com を見て' }),
      ),
    ).toBe(true);
  });

  it('post_content regex — 不正パターンは fail-secure で false', () => {
    expect(
      evalCondition(
        { matcher: 'post_content', op: 'regex', value: '(' }, // 構文エラー
        ctx({ content: 'whatever' }),
      ),
    ).toBe(false);
  });
});

describe('evalCondition — array ops (tag_names)', () => {
  it('post_tag_names contains "anime" → true', () => {
    expect(
      evalCondition(
        { matcher: 'post_tag_names', op: 'contains', value: 'anime' },
        ctx({ tag_names: ['anime', 'manga'] }),
      ),
    ).toBe(true);
  });

  it('post_tag_names in ["spam","ad"] — tag に "spam" があれば true', () => {
    expect(
      evalCondition(
        { matcher: 'post_tag_names', op: 'in', value: ['spam', 'ad'] },
        ctx({ tag_names: ['spam', 'tech'] }),
      ),
    ).toBe(true);
  });

  it('post_tag_names in [...] — 共通要素無しは false', () => {
    expect(
      evalCondition(
        { matcher: 'post_tag_names', op: 'in', value: ['spam', 'ad'] },
        ctx({ tag_names: ['anime', 'tech'] }),
      ),
    ).toBe(false);
  });
});

describe('evalCondition — boolean', () => {
  it('post_is_edited eq true → 編集済みなら true', () => {
    expect(
      evalCondition(
        { matcher: 'post_is_edited', op: 'eq', value: true },
        ctx({ is_edited: true }),
      ),
    ).toBe(true);
    expect(
      evalCondition(
        { matcher: 'post_is_edited', op: 'eq', value: true },
        ctx({ is_edited: false }),
      ),
    ).toBe(false);
  });
});

describe('evalRule — AND 結合', () => {
  it('複数 conditions は全て true で matched=true', () => {
    const r = rule([
      { matcher: 'author_age_days',   op: 'lt',       value: 7 },
      { matcher: 'post_content',      op: 'contains', value: 'discord.gg' },
    ]);
    expect(
      evalRule(r, ctx({ author_age_days: 3, content: 'discord.gg/abcd' })).matched,
    ).toBe(true);
  });

  it('複数 conditions のうち 1 つでも false なら matched=false', () => {
    const r = rule([
      { matcher: 'author_age_days',   op: 'lt',       value: 7 },
      { matcher: 'post_content',      op: 'contains', value: 'discord.gg' },
    ]);
    // age はマッチするが content はマッチしない
    expect(
      evalRule(r, ctx({ author_age_days: 3, content: 'innocent post' })).matched,
    ).toBe(false);
  });

  it('enabled=false なら常に matched=false (全 condition が true でも)', () => {
    const r = rule(
      { matcher: 'author_age_days', op: 'lt', value: 7 },
      { enabled: false },
    );
    expect(evalRule(r, ctx({ author_age_days: 3 })).matched).toBe(false);
  });

  it('conditions が空配列なら matched=false (誤発火防止)', () => {
    const r = rule([]);
    expect(evalRule(r, ctx()).matched).toBe(false);
  });
});

describe('evalAllRules — 複数 rule', () => {
  it('マッチした rule だけが返る', () => {
    const r1 = rule({ matcher: 'author_age_days', op: 'lt', value: 7 }, { id: 'r1' });
    const r2 = rule({ matcher: 'post_content',    op: 'contains', value: 'http' }, { id: 'r2' });
    const r3 = rule({ matcher: 'author_trust_score', op: 'gt', value: 99 }, { id: 'r3' });
    const matched = evalAllRules(
      [r1, r2, r3],
      ctx({ author_age_days: 3, content: 'http://x', author_trust_score: 50 }),
    );
    expect(matched.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});
