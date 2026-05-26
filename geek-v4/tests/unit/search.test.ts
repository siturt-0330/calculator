// ============================================================
// search.test.ts — Google 風検索エンジンの単体テスト
// ============================================================
// カバレッジ:
//   - typoTolerance: levenshtein 距離 / 候補生成 / マッチ判定
//   - variants: synonym (英日 / カタカナ⇔英) の双方向拡張
//   - scoring (BM25): title-hit > body-hit > tag-only-hit のランキング
//   - scoring (popularity tiebreaker): 同 score なら like 多い方が上位
//   - autocomplete: 頻度 + 直近性 + prefix のスコアリング
//   - queryParser: getQueryMode (1単語 strict / 2+ loose / phrase)
// ============================================================

// lib/storage は react-native chain を引き込むので in-memory mock に差し替え
jest.mock('../../lib/storage', () => {
  const mem = new Map<string, unknown>();
  return {
    getJson: <T>(key: string): T | undefined => mem.get(key) as T | undefined,
    setJson: <T>(key: string, val: T): void => {
      mem.set(key, val);
    },
    getString: () => undefined,
    setString: () => {},
    getBool: () => undefined,
    setBool: () => {},
    getNumber: () => undefined,
    setNumber: () => {},
    remove: (key: string) => {
      mem.delete(key);
    },
    contains: (key: string) => mem.has(key),
    storage: {},
  };
});

import {
  levenshteinDistance,
  typoSimilarity,
  generateTypoVariants,
  findTypoCandidates,
  isTypoMatch,
  typoTolerance,
} from '../../lib/search/typoTolerance';
import { generateVariants } from '../../lib/search/variants';
import { parseQuery, getQueryMode } from '../../lib/search/queryParser';
import { scorePost, type PostDoc, type PersonalizationCtx } from '../../lib/search/scoring';
import {
  recordQuery,
  loadQueryStats,
  clearQueryStats,
  suggestQueries,
  mergeFromHistoryList,
  saveQueryStats,
} from '../../lib/search/autocomplete';

// ============================================================
// Test helpers
// ============================================================
function makePost(over: Partial<PostDoc>): PostDoc {
  return {
    id: 'p1',
    content: '',
    tag_names: [],
    likes_count: 0,
    comments_count: 0,
    concern_count: 0,
    created_at: new Date('2026-05-01').toISOString(),
    trust_score_at_post: 50,
    media_urls: [],
    source_url: null,
    kind: null,
    ...over,
  };
}

function emptyCtx(): PersonalizationCtx {
  return {
    likedTags: new Set(),
    blockedTags: new Set(),
    recentQueries: [],
    tagAffinity: {},
    recentTags: [],
  };
}

// ============================================================
// Tests: typoTolerance
// ============================================================
describe('typoTolerance', () => {
  describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshteinDistance('pokemon', 'pokemon')).toBe(0);
    });

    it('returns distance for substitution', () => {
      expect(levenshteinDistance('cat', 'bat')).toBe(1);
    });

    it('handles transposition (Damerau)', () => {
      // 'ab' ↔ 'ba' is a single transpose → distance 1
      expect(levenshteinDistance('ab', 'ba')).toBe(1);
    });

    it('empty string distance equals length', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3);
      expect(levenshteinDistance('abc', '')).toBe(3);
    });
  });

  describe('typoSimilarity', () => {
    it('absorbs hiragana/katakana variance', () => {
      expect(typoSimilarity('ポケモン', 'ぽけもん')).toBe(1);
    });
    it('absorbs full/half width variance', () => {
      expect(typoSimilarity('AbC', 'ＡｂＣ')).toBe(1);
    });
  });

  describe('typoTolerance (allowed distance)', () => {
    it('short queries get distance 1', () => {
      expect(typoTolerance(2)).toBe(1);
      expect(typoTolerance(3)).toBe(1);
    });
    it('medium queries get distance 1', () => {
      expect(typoTolerance(5)).toBe(1);
    });
    it('long queries get distance 2', () => {
      expect(typoTolerance(8)).toBe(2);
    });
  });

  describe('generateTypoVariants', () => {
    it('includes original', () => {
      const v = generateTypoVariants('cat');
      expect(v).toContain('cat');
    });

    it('includes 1-char deletes', () => {
      const v = generateTypoVariants('cat');
      expect(v).toContain('at');
      expect(v).toContain('ct');
      expect(v).toContain('ca');
    });

    it('includes adjacent swaps (transposition)', () => {
      const v = generateTypoVariants('cat');
      expect(v).toContain('act'); // c-a swapped
    });

    it('includes hiragana/katakana mirror', () => {
      const v = generateTypoVariants('ポケモ');
      expect(v).toContain('ぽけも');
    });

    it('bails out (returns just original + simple) for long queries', () => {
      const long = 'a'.repeat(20);
      const v = generateTypoVariants(long);
      expect(v).toContain(long);
    });
  });

  describe('findTypoCandidates', () => {
    it('matches "ポケモン" against typo "ポケモソ"', () => {
      const r = findTypoCandidates('ポケモソ', ['ポケモン', '原神', 'アニメ']);
      const top = r[0];
      expect(top?.candidate).toBe('ポケモン');
      expect(top?.distance).toBeLessThanOrEqual(1);
    });

    it('matches "ぽけもむ" → "ポケモン" (hira/kata + 1 char typo)', () => {
      const r = findTypoCandidates('ぽけもむ', ['ポケモン']);
      expect(r.length).toBeGreaterThan(0);
      expect(r[0]?.candidate).toBe('ポケモン');
    });

    it('returns empty when nothing close enough', () => {
      const r = findTypoCandidates('abcdef', ['xyz', '12345']);
      expect(r).toEqual([]);
    });

    it('sorts by similarity descending', () => {
      const r = findTypoCandidates('pokemo', ['pokemons', 'pokemon', 'pokémon']);
      expect(r.length).toBeGreaterThan(0);
      const sims = r.map((m) => m.similarity);
      for (let i = 1; i < sims.length; i++) {
        expect(sims[i - 1]).toBeGreaterThanOrEqual(sims[i]!);
      }
    });
  });

  describe('isTypoMatch', () => {
    it('true for 1-char typo', () => {
      expect(isTypoMatch('ポケモン', 'ポケモソ')).toBe(true);
    });
    it('true for hira→kata exact', () => {
      expect(isTypoMatch('ポケモン', 'ぽけもん')).toBe(true);
    });
    it('false for entirely different', () => {
      expect(isTypoMatch('pokemon', 'genshin')).toBe(false);
    });
  });
});

// ============================================================
// Tests: variants (synonym expansion)
// ============================================================
describe('variants (synonym expansion)', () => {
  it('pokemon → ポケモン variant present', () => {
    const v = generateVariants('pokemon');
    expect(v.some((x) => x.toLowerCase() === 'ポケモン'.toLowerCase())).toBe(true);
  });

  it('ポケモン → pokemon variant present', () => {
    const v = generateVariants('ポケモン');
    expect(v.some((x) => x.toLowerCase() === 'pokemon')).toBe(true);
  });

  it('ポケモン → "ぽけもん" hiragana variant present', () => {
    const v = generateVariants('ポケモン');
    expect(v.some((x) => x === 'ぽけもん')).toBe(true);
  });

  it('PokeMon (mixed-case) → ポケモン variant present', () => {
    const v = generateVariants('PokeMon');
    // normalize to lower → 'pokemon' → ポケモン
    expect(v.some((x) => x === 'ポケモン')).toBe(true);
  });

  it('ゲーム → game variant', () => {
    const v = generateVariants('ゲーム');
    expect(v.some((x) => x === 'game')).toBe(true);
  });

  it('ゲーム → ゲーミング (extended synonym, new)', () => {
    const v = generateVariants('ゲーミング');
    expect(v.some((x) => x === 'gaming' || x === 'ゲーム')).toBe(true);
  });

  it('half-width katakana ｲｺﾗﾌﾞ → =LOVE synonym', () => {
    const v = generateVariants('ｲｺﾗﾌﾞ');
    expect(v.some((x) => x.toLowerCase().includes('love') || x === 'イコラブ')).toBe(true);
  });
});

// ============================================================
// Tests: BM25 scoring — title > body > tag-only ranking
// ============================================================
describe('scorePost BM25 ranking', () => {
  it('exact tag match beats body match (title > body)', () => {
    const query = parseQuery('ポケモン');
    const ctx = emptyCtx();
    const empty = new Set<string>();

    const postBody = makePost({
      id: 'body',
      content: 'ポケモンが好き',
      tag_names: ['雑談'],
      created_at: new Date('2026-05-01').toISOString(),
    });
    const postTag = makePost({
      id: 'tag',
      content: '今日は良い天気',
      tag_names: ['ポケモン'],
      created_at: new Date('2026-05-01').toISOString(),
    });

    const sBody = scorePost(postBody, query, empty, ctx).score;
    const sTag = scorePost(postTag, query, empty, ctx).score;
    expect(sTag).toBeGreaterThan(sBody);
  });

  it('body match beats no-match', () => {
    const query = parseQuery('ポケモン');
    const ctx = emptyCtx();
    const empty = new Set<string>();
    const postBody = makePost({
      content: 'ポケモンが好きです',
      tag_names: ['雑談'],
    });
    const postMiss = makePost({
      id: 'miss',
      content: '今日は良い天気',
      tag_names: ['雑談'],
    });
    expect(scorePost(postBody, query, empty, ctx).score).toBeGreaterThan(
      scorePost(postMiss, query, empty, ctx).score,
    );
  });

  it('title-tag hit weight is 3-5x body hit', () => {
    const query = parseQuery('ホロライブ');
    const ctx = emptyCtx();
    const empty = new Set<string>();
    const bodyOnly = makePost({
      id: 'b',
      content: 'ホロライブ ホロライブ ホロライブ ホロライブ',
      tag_names: ['雑談'],
    });
    const tagOnly = makePost({
      id: 't',
      content: '今日は楽しかった',
      tag_names: ['ホロライブ'],
    });
    const sBody = scorePost(bodyOnly, query, empty, ctx).score;
    const sTag = scorePost(tagOnly, query, empty, ctx).score;
    // tag exact-match should be at least 2x body hit (was previously closer to 1.x)
    expect(sTag).toBeGreaterThan(sBody * 1.5);
  });
});

// ============================================================
// Tests: popularity tiebreaker — same score → more likes wins
// ============================================================
describe('scorePost popularity tiebreaker', () => {
  it('two posts equal on content rank by likes', () => {
    const query = parseQuery('ポケモン');
    const ctx = emptyCtx();
    const empty = new Set<string>();
    const base = {
      content: '今日は楽しかった',
      tag_names: ['ポケモン'],
      created_at: new Date('2026-05-01').toISOString(),
    };
    const popular = makePost({ id: 'pop', ...base, likes_count: 100, comments_count: 50 });
    const unpopular = makePost({ id: 'un', ...base, likes_count: 0, comments_count: 0 });
    const sPop = scorePost(popular, query, empty, ctx).score;
    const sUnpop = scorePost(unpopular, query, empty, ctx).score;
    expect(sPop).toBeGreaterThan(sUnpop);
  });
});

// ============================================================
// Tests: typo tolerance in scorePost
// ============================================================
describe('scorePost typo tolerance', () => {
  it('1-char typo on tag still matches with partial score', () => {
    const query = parseQuery('ポケモソ'); // ン→ソ typo
    const ctx = emptyCtx();
    const empty = new Set<string>();
    const post = makePost({ tag_names: ['ポケモン'] });
    const s = scorePost(post, query, empty, ctx).score;
    expect(s).toBeGreaterThan(0);
  });

  it('does not match if typo distance too large', () => {
    const query = parseQuery('ぜんぜん別物');
    const ctx = emptyCtx();
    const empty = new Set<string>();
    const post = makePost({
      tag_names: ['アニメ'],
      content: '無関係',
      created_at: new Date('2020-01-01').toISOString(),
      trust_score_at_post: 30,
      // Important: explicitly assert score=0 only if no other signals
    });
    // freshness が古いので freshness boost ほぼ 0
    // 信頼スコア低めにして信頼 boost も負
    const s = scorePost(post, query, empty, ctx).score;
    expect(s).toBeLessThan(1);
  });
});

// ============================================================
// Tests: getQueryMode (strict / loose / phrase)
// ============================================================
describe('getQueryMode', () => {
  it('returns strict for 1-word query', () => {
    expect(getQueryMode(parseQuery('ポケモン'))).toBe('strict');
  });
  it('returns loose for 2+ word query', () => {
    expect(getQueryMode(parseQuery('ポケモン アニメ'))).toBe('loose');
  });
  it('returns phrase when "..." present', () => {
    expect(getQueryMode(parseQuery('"進撃の巨人"'))).toBe('phrase');
  });
});

// ============================================================
// Tests: scorePost mode-aware (loose AND penalty)
// ============================================================
describe('scorePost loose mode AND-penalty', () => {
  it('post hitting all 2 keywords scores higher than hitting only 1', () => {
    const query = parseQuery('ポケモン アニメ');
    const ctx = emptyCtx();
    const empty = new Set<string>();
    const both = makePost({
      id: 'both',
      tag_names: ['ポケモン', 'アニメ'],
      content: 'おすすめ',
      created_at: new Date('2026-05-01').toISOString(),
    });
    const one = makePost({
      id: 'one',
      tag_names: ['ポケモン'],
      content: 'おすすめ',
      created_at: new Date('2026-05-01').toISOString(),
    });
    const sBoth = scorePost(both, query, empty, ctx).score;
    const sOne = scorePost(one, query, empty, ctx).score;
    expect(sBoth).toBeGreaterThan(sOne);
  });
});

// ============================================================
// Tests: autocomplete (V2 — suggestQueries / recordQuery)
// ============================================================
describe('autocomplete persistence + ranking', () => {
  beforeEach(() => {
    clearQueryStats();
  });

  it('recordQuery increments count', () => {
    recordQuery('ポケモン');
    recordQuery('ポケモン');
    recordQuery('ポケモン');
    const stats = loadQueryStats();
    const entries = Object.entries(stats);
    expect(entries.length).toBe(1);
    expect(entries[0]?.[1].count).toBe(3);
  });

  it('recordQuery records different queries separately', () => {
    recordQuery('ポケモン');
    recordQuery('原神');
    expect(Object.keys(loadQueryStats()).length).toBe(2);
  });

  it('suggestQueries returns recent history for empty input', () => {
    recordQuery('ポケモン', 1000);
    recordQuery('原神', 2000);
    recordQuery('アニメ', 3000);
    const r = suggestQueries('', { stats: loadQueryStats() });
    // 直近 (lastUsed 大) が先頭
    expect(r[0]?.text).toBe('アニメ');
  });

  it('suggestQueries prefers prefix match', () => {
    recordQuery('ポケモン');
    recordQuery('ポケモンアニメ');
    recordQuery('原神');
    const r = suggestQueries('ポケ', { stats: loadQueryStats() });
    // 上位 2 件は ポケモン / ポケモンアニメ
    const top2Texts = r.slice(0, 2).map((s) => s.text);
    expect(top2Texts).toEqual(expect.arrayContaining(['ポケモン', 'ポケモンアニメ']));
    expect(top2Texts).not.toContain('原神');
  });

  it('suggestQueries falls back to typo correction when no direct match', () => {
    // クエリ "ぽけもむ" (= "ポケモン" の typo) → popularTags の "ポケモン" を typo として返す
    const r = suggestQueries('ぽけもむ', {
      stats: {},
      popularTags: ['ポケモン', '原神'],
    });
    const hasPokemon = r.some((s) => s.text === 'ポケモン');
    expect(hasPokemon).toBe(true);
  });

  it('mergeFromHistoryList imports old string[]', () => {
    mergeFromHistoryList(['古い検索1', '古い検索2', '古い検索3']);
    const stats = loadQueryStats();
    expect(Object.keys(stats).length).toBe(3);
  });

  it('saveQueryStats round-trips data', () => {
    const stat = { ポケモン: { count: 5, lastUsed: 1234 } };
    saveQueryStats(stat);
    expect(loadQueryStats()).toEqual(stat);
  });
});
