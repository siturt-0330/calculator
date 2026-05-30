// ============================================================
// lib/offline/queue.ts のテスト
// ============================================================
// 対象: enqueue / dedupe / dequeue / processQueue / retryCount /
//       上限 (MAX_ITEMS=100) / dead letter / 永続化 round-trip / clear
//
// lib/storage.ts は react-native chain を引き込むため、ここでは
// in-memory mock に差し替えて pure function として queue ロジックを検証する。
// ============================================================

// lib/storage を in-memory mock に置き換え (react-native を引き込まない)
jest.mock('../../lib/storage', () => {
  const mem = new Map<string, unknown>();
  return {
    getJson: <T>(key: string): T | undefined => mem.get(key) as T | undefined,
    setJson: <T>(key: string, val: T): void => {
      // 永続化される値の構造をエミュレートするため JSON round-trip
      mem.set(key, JSON.parse(JSON.stringify(val)));
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

// swallow は Sentry breadcrumb 連鎖を辿る可能性があるので no-op に
jest.mock('../../lib/swallow', () => ({
  swallow: () => {},
}));

import {
  enqueue,
  dequeue,
  processQueue,
  clearQueue,
  clearDeadLetter,
  loadQueue,
  loadDeadLetter,
  getSnapshot,
  size,
  deadSize,
  MAX_ITEMS,
  MAX_RETRIES,
  type QueueItem,
} from '../../lib/offline/queue';

function resetAll() {
  clearQueue();
  clearDeadLetter();
}

describe('lib/offline/queue', () => {
  beforeEach(() => {
    resetAll();
  });

  // ----------------------------------------------------------
  // 1. enqueue 基本
  // ----------------------------------------------------------
  it('enqueue: 新規 item は末尾に push される', () => {
    const id1 = enqueue('like', { postId: 'p1' });
    const id2 = enqueue('like', { postId: 'p2' });
    const q = loadQueue();
    expect(q.length).toBe(2);
    expect(q[0]?.id).toBe(id1);
    expect(q[1]?.id).toBe(id2);
    expect(q[0]?.retryCount).toBe(0);
    expect(typeof q[0]?.createdAt).toBe('number');
  });

  // ----------------------------------------------------------
  // 2. dedupe: 同種 + 同 payload は重複しない
  // ----------------------------------------------------------
  it('dedupe: 同じ kind + payload の二重 enqueue は no-op (既存 id を返す)', () => {
    const id1 = enqueue('reaction', { postId: 'p1', meme: 'heart' });
    const id2 = enqueue('reaction', { postId: 'p1', meme: 'heart' });
    expect(id1).toBe(id2);
    expect(loadQueue().length).toBe(1);
  });

  it('dedupe: payload キーの並びが違っても同一視される (stable stringify)', () => {
    const id1 = enqueue('comment_create', { postId: 'p1', text: 'hi' });
    const id2 = enqueue('comment_create', { text: 'hi', postId: 'p1' });
    expect(id1).toBe(id2);
    expect(size()).toBe(1);
  });

  it('dedupe: kind が違えば別 item として残る', () => {
    enqueue('like', { postId: 'p1' });
    enqueue('concern', { postId: 'p1' });
    expect(size()).toBe(2);
  });

  // ----------------------------------------------------------
  // 3. dequeue
  // ----------------------------------------------------------
  it('dequeue: id を指定して 1 件削除できる', () => {
    const id1 = enqueue('like', { postId: 'p1' });
    enqueue('like', { postId: 'p2' });
    dequeue(id1);
    const q = loadQueue();
    expect(q.length).toBe(1);
    expect(q[0]?.payload.postId).toBe('p2');
  });

  // ----------------------------------------------------------
  // 4. processQueue: 順次実行 + 成功で dequeue
  // ----------------------------------------------------------
  it('processQueue: 全件成功 → 全 dequeue, processed カウント正しい', async () => {
    enqueue('like', { postId: 'p1' });
    enqueue('like', { postId: 'p2' });
    enqueue('like', { postId: 'p3' });
    const calls: string[] = [];
    const r = await processQueue(async (item) => {
      calls.push(item.payload.postId as string);
    });
    expect(r).toEqual({ processed: 3, failed: 0, dead: 0 });
    expect(calls).toEqual(['p1', 'p2', 'p3']); // 順序維持
    expect(size()).toBe(0);
  });

  // ----------------------------------------------------------
  // 5. processQueue: 失敗で retryCount++
  // ----------------------------------------------------------
  it('processQueue: 失敗 → retryCount++; MAX_RETRIES 未満なら queue に残る', async () => {
    enqueue('like', { postId: 'p1' });
    const r = await processQueue(async () => {
      throw new Error('boom');
    });
    expect(r).toEqual({ processed: 0, failed: 1, dead: 0 });
    const q = loadQueue();
    expect(q.length).toBe(1);
    expect(q[0]?.retryCount).toBe(1);
  });

  // ----------------------------------------------------------
  // 6. processQueue: MAX_RETRIES 到達で dead letter
  // ----------------------------------------------------------
  it(`processQueue: ${MAX_RETRIES} 回失敗で dead letter に移送される`, async () => {
    enqueue('like', { postId: 'p1' });
    const fail = async () => {
      throw new Error('always-fail');
    };
    // 3 回失敗
    for (let i = 0; i < MAX_RETRIES; i++) {
      await processQueue(fail);
    }
    expect(size()).toBe(0);
    const dead = loadDeadLetter();
    expect(dead.length).toBe(1);
    expect(dead[0]?.reason).toContain('always-fail');
    expect(dead[0]?.retryCount).toBe(MAX_RETRIES);
    expect(typeof dead[0]?.failedAt).toBe('number');
  });

  // ----------------------------------------------------------
  // 7. processQueue: 混在 (一部成功 / 一部失敗)
  // ----------------------------------------------------------
  it('processQueue: 一部成功 + 一部失敗が正しく分かれる', async () => {
    enqueue('like', { postId: 'p1' });
    enqueue('like', { postId: 'p2' });
    enqueue('like', { postId: 'p3' });
    const r = await processQueue(async (item) => {
      if (item.payload.postId === 'p2') throw new Error('nope');
    });
    expect(r.processed).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.dead).toBe(0);
    const q = loadQueue();
    expect(q.length).toBe(1);
    expect(q[0]?.payload.postId).toBe('p2');
    expect(q[0]?.retryCount).toBe(1);
  });

  // ----------------------------------------------------------
  // 8. 上限 (MAX_ITEMS=100): 超えたら oldest が dropped
  // ----------------------------------------------------------
  it(`上限: ${MAX_ITEMS} 件超で oldest が drop される`, () => {
    for (let i = 0; i < MAX_ITEMS + 5; i++) {
      enqueue('like', { postId: `p${i}` });
    }
    const q = loadQueue();
    expect(q.length).toBe(MAX_ITEMS);
    // oldest = p0..p4 が drop されているはず → 先頭は p5
    expect(q[0]?.payload.postId).toBe('p5');
    expect(q[q.length - 1]?.payload.postId).toBe(`p${MAX_ITEMS + 4}`);
  });

  // ----------------------------------------------------------
  // 9. 永続化 round-trip: enqueue → 別 view (loadQueue) で同じ結果
  // ----------------------------------------------------------
  it('永続化: enqueue 後に loadQueue で同じ内容が読める (永続層 round-trip)', () => {
    enqueue('post_create', { text: 'hello', tags: ['a', 'b'] });
    const q1 = loadQueue();
    expect(q1.length).toBe(1);
    const item = q1[0] as QueueItem;
    expect(item.kind).toBe('post_create');
    expect(item.payload).toEqual({ text: 'hello', tags: ['a', 'b'] });
    // 再 load しても同じ
    const q2 = loadQueue();
    expect(q2).toEqual(q1);
  });

  // ----------------------------------------------------------
  // 10. clearQueue / clearDeadLetter
  // ----------------------------------------------------------
  it('clearQueue: queue を全削除する', () => {
    enqueue('like', { postId: 'p1' });
    enqueue('like', { postId: 'p2' });
    expect(size()).toBe(2);
    clearQueue();
    expect(size()).toBe(0);
  });

  it('clearDeadLetter: dead letter を全削除する', async () => {
    enqueue('like', { postId: 'p1' });
    for (let i = 0; i < MAX_RETRIES; i++) {
      await processQueue(async () => {
        throw new Error('x');
      });
    }
    expect(deadSize()).toBe(1);
    clearDeadLetter();
    expect(deadSize()).toBe(0);
  });

  // ----------------------------------------------------------
  // 11. snapshot
  // ----------------------------------------------------------
  it('getSnapshot: pending + dead を返す', async () => {
    enqueue('reply_create', { threadId: 't1', text: 'a' });
    enqueue('like', { postId: 'p1' });
    // like だけ失敗させて dead letter に移送
    for (let i = 0; i < MAX_RETRIES; i++) {
      await processQueue(async (item) => {
        if (item.kind === 'like') throw new Error('like-fail');
      });
    }
    const snap = getSnapshot();
    expect(snap.pending.length).toBe(0); // reply は成功 / like は dead
    expect(snap.dead.length).toBe(1);
    expect(snap.dead[0]?.kind).toBe('like');
  });

  // ----------------------------------------------------------
  // 12. processQueue: 途中で enqueue されても落ちない
  // ----------------------------------------------------------
  it('processQueue: 処理中に追加 enqueue が来ても次回 flush で拾える', async () => {
    enqueue('like', { postId: 'p1' });
    const r1 = await processQueue(async (item) => {
      if (item.payload.postId === 'p1') {
        // 処理中に追加で enqueue (後続 flush に回るはず)
        enqueue('like', { postId: 'p-new' });
      }
    });
    expect(r1.processed).toBe(1);
    // 追加した分は次回 flush で処理される
    expect(size()).toBe(1);
    const r2 = await processQueue(async () => {});
    expect(r2.processed).toBe(1);
    expect(size()).toBe(0);
  });

  // ----------------------------------------------------------
  // 13. kind 種類カバレッジ
  // ----------------------------------------------------------
  it('kind: 全種類 (post_create / comment_create / reaction / like / concern / reply_create) を enqueue できる', () => {
    enqueue('post_create', { text: '1' });
    enqueue('comment_create', { postId: 'p1', text: '1' });
    enqueue('reaction', { postId: 'p1', meme: 'heart' });
    enqueue('like', { postId: 'p1' });
    enqueue('concern', { postId: 'p1' });
    enqueue('reply_create', { threadId: 't1', text: '1' });
    expect(size()).toBe(6);
    const kinds = loadQueue().map((q) => q.kind);
    expect(kinds).toEqual([
      'post_create',
      'comment_create',
      'reaction',
      'like',
      'concern',
      'reply_create',
    ]);
  });

  // ----------------------------------------------------------
  // 14. dead letter の永続化 round-trip
  // ----------------------------------------------------------
  it('dead letter: 永続化されて loadDeadLetter で読める', async () => {
    enqueue('like', { postId: 'p1' });
    for (let i = 0; i < MAX_RETRIES; i++) {
      await processQueue(async () => {
        throw new Error('persistent-fail');
      });
    }
    const dead1 = loadDeadLetter();
    // 再度 load しても同じ
    const dead2 = loadDeadLetter();
    expect(dead1).toEqual(dead2);
    expect(dead1[0]?.reason).toContain('persistent-fail');
  });

  // ----------------------------------------------------------
  // 15. dedupe + processQueue 統合
  // ----------------------------------------------------------
  it('integration: dedupe で 1 件、 flush 成功で 0 件', async () => {
    enqueue('like', { postId: 'p1' });
    enqueue('like', { postId: 'p1' }); // dedupe
    enqueue('like', { postId: 'p1' }); // dedupe
    expect(size()).toBe(1);
    const r = await processQueue(async () => {});
    expect(r.processed).toBe(1);
    expect(size()).toBe(0);
  });
});
