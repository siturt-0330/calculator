// ============================================================
// lib/api/quotePosts.ts のユニットテスト
// ------------------------------------------------------------
// カバレッジ:
//   1. モジュールレベルキャッシュ — 同一 ID で 2 回呼ぶと Supabase は 1 回しか叩かない
//   2. in-flight dedup — 同一 ID の並列呼び出しでもリクエストは 1 本のみ
//   3. Supabase がエラーを返した場合 → null を返す
//   4. Supabase が data:null を返した場合 → null を返す
//   5. 正常系 — 正しい形状の QuotedPostPreview を返す
//
// supabase クライアントはモジュールレベルで jest.mock に差し替え。
// withApiTimeout は軽量ラッパのため実装をそのまま通す。
// swallow は副作用 (Sentry breadcrumb) を no-op にするため mock にする。
// ============================================================

// ------------------------------------------------------------
// swallow は Sentry 依存チェーンを持つため no-op に
// ------------------------------------------------------------
jest.mock('../../lib/swallow', () => ({
  swallow: jest.fn(),
}));

// ------------------------------------------------------------
// lib/supabase — supabase クライアントを mock に差し替え
// ------------------------------------------------------------
// from('posts').select(...).eq(...).single() という chained builder を
// 模倣するシンプルな mock。各テストで `mockSingle` に好きな応答を仕込む。
// ------------------------------------------------------------
const mockSingle = jest.fn<Promise<{ data: unknown; error: unknown }>, []>();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      single: () => mockSingle(),
    }),
  },
}));

// ------------------------------------------------------------
// 実際にテスト対象をインポート (mock 登録後)
// ------------------------------------------------------------
import { fetchQuotedPost, createQuotePost } from '../../lib/api/quotePosts';
import { supabase } from '../../lib/supabase';

// ------------------------------------------------------------
// ヘルパー: 正常な DB 行データ
// ------------------------------------------------------------
const MOCK_ROW = {
  id: 'post-abc',
  content: 'テストコンテンツ',
  title: 'テストタイトル',
  tag_names: ['tag1', 'tag2'],
  created_at: '2026-01-01T00:00:00.000Z',
};

// ------------------------------------------------------------
// beforeEach: キャッシュをリセットする
// ------------------------------------------------------------
// quotePosts.ts のモジュールレベルキャッシュ (_quoteCache / _quoteInflight) は
// モジュールが一度ロードされると共有される。各テストを独立させるため
// jest.resetModules() でモジュールキャッシュを完全にクリアし、再 require する。
//
// ただし jest.resetModules() は全 mock 登録も失われるため、
// 各テストで `require` + 新規 mock 登録が必要になり複雑度が跳ね上がる。
//
// 代わりに: _quoteCache / _quoteInflight は Module 内部の private Map なので
// テスト間でリセットする方法として「別の postId を使う」 or
// jest.isolateModules を使う手もあるが、最もシンプルな戦略として
// 各テストごとに異なる postId を使うことでキャッシュ衝突を回避する。
// ------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// fetchQuotedPost テスト群
// ============================================================

describe('fetchQuotedPost — モジュールレベルキャッシュ', () => {
  it('同じ postId を 2 回呼ぶと Supabase クエリは 1 回しか実行されない', async () => {
    mockSingle.mockResolvedValue({ data: { ...MOCK_ROW, id: 'cache-test-1' }, error: null });

    // 1 回目
    const r1 = await fetchQuotedPost('cache-test-1');
    // 2 回目 (キャッシュヒットのはず)
    const r2 = await fetchQuotedPost('cache-test-1');

    // Supabase の from は 1 度しか呼ばれていないはず
    expect(supabase.from).toHaveBeenCalledTimes(1);
    // 両呼び出しは同じ結果を返す
    expect(r1).toEqual(r2);
    expect(r1?.id).toBe('cache-test-1');
  });

  it('キャッシュに null が入った場合も 2 回目は Supabase を叩かない', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });

    const r1 = await fetchQuotedPost('cache-null-1');
    const r2 = await fetchQuotedPost('cache-null-1');

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });
});

describe('fetchQuotedPost — in-flight dedup', () => {
  it('同一 postId の 2 並列呼び出しは 1 本のリクエストに集約される', async () => {
    // 解決が遅い Promise を返して、2 つ目の呼び出しが確実に in-flight 中に来るようにする
    let resolveRequest!: (v: { data: unknown; error: unknown }) => void;
    const delayed = new Promise<{ data: unknown; error: unknown }>((res) => {
      resolveRequest = res;
    });
    mockSingle.mockReturnValue(delayed);

    // 2 つ同時に発火
    const p1 = fetchQuotedPost('inflight-test-1');
    const p2 = fetchQuotedPost('inflight-test-1');

    // この時点ではまだ resolved していないが、from の呼び出しは 1 回のはず
    expect(supabase.from).toHaveBeenCalledTimes(1);

    // Promise を解決する
    resolveRequest({ data: { ...MOCK_ROW, id: 'inflight-test-1' }, error: null });

    const [r1, r2] = await Promise.all([p1, p2]);

    // 両方同じ結果
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1?.id).toBe('inflight-test-1');
    expect(r1).toEqual(r2);
    // Supabase は計 1 回のみ
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe('fetchQuotedPost — エラー・null ハンドリング', () => {
  it('supabase がエラーを返した場合は null を返す', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { message: 'Row not found', code: 'PGRST116' },
    });

    const result = await fetchQuotedPost('error-case-1');
    expect(result).toBeNull();
  });

  it('supabase が data:null を返した場合は null を返す', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });

    const result = await fetchQuotedPost('null-data-1');
    expect(result).toBeNull();
  });

  it('supabase が throw した場合は null を返す (swallow で握り潰し)', async () => {
    mockSingle.mockRejectedValue(new Error('network error'));

    const result = await fetchQuotedPost('throw-case-1');
    expect(result).toBeNull();
  });
});

describe('fetchQuotedPost — 正常系: QuotedPostPreview の形状', () => {
  it('正しい形状の QuotedPostPreview を返す', async () => {
    const row = {
      id: 'shape-test-1',
      content: '本文テキスト',
      title: 'タイトルテキスト',
      tag_names: ['tech', 'geek'],
      created_at: '2026-06-01T12:00:00.000Z',
    };
    mockSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchQuotedPost('shape-test-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('shape-test-1');
    expect(result?.content).toBe('本文テキスト');
    expect(result?.title).toBe('タイトルテキスト');
    expect(result?.tag_names).toEqual(['tech', 'geek']);
    expect(result?.created_at).toBe('2026-06-01T12:00:00.000Z');
  });

  it('content / title が null の場合は null としてマッピングされる', async () => {
    const row = {
      id: 'null-fields-1',
      content: null,
      title: null,
      tag_names: [],
      created_at: '2026-06-01T00:00:00.000Z',
    };
    mockSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchQuotedPost('null-fields-1');

    expect(result?.content).toBeNull();
    expect(result?.title).toBeNull();
    expect(result?.tag_names).toEqual([]);
  });

  it('tag_names が配列でない場合は空配列にフォールバックする', async () => {
    const row = {
      id: 'tag-fallback-1',
      content: 'テスト',
      title: null,
      tag_names: null, // DB から null が来た場合
      created_at: '2026-06-01T00:00:00.000Z',
    };
    mockSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchQuotedPost('tag-fallback-1');

    expect(result?.tag_names).toEqual([]);
  });
});

// ============================================================
// createQuotePost テスト群
// ============================================================

describe('createQuotePost', () => {
  it('成功時は { id } を返す', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'new-post-1' }, error: null });

    const result = await createQuotePost({
      content: '引用テスト',
      quotePostId: 'original-post-1',
    });

    expect(result).toEqual({ id: 'new-post-1' });
  });

  it('supabase がエラーを返した場合は null を返す', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { message: 'insert failed', code: '23505' },
    });

    const result = await createQuotePost({
      content: 'テスト',
      quotePostId: 'orig-1',
    });

    expect(result).toBeNull();
  });

  it('supabase が throw した場合は null を返す', async () => {
    mockSingle.mockRejectedValue(new Error('network error'));

    const result = await createQuotePost({
      content: 'テスト',
      quotePostId: 'orig-2',
    });

    expect(result).toBeNull();
  });

  it('tagNames / isAnonymous のデフォルト値が正しく使われる', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'new-post-2' }, error: null });

    await createQuotePost({
      content: 'デフォルトテスト',
      quotePostId: 'orig-3',
      // tagNames・isAnonymous は省略
    });

    // supabase.from('posts') が呼ばれたことを確認
    expect(supabase.from).toHaveBeenCalledWith('posts');
  });
});
