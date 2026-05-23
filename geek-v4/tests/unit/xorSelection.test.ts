// MemeReactionPicker の選択状態ロジック
// visiblyPicked = baselinePicked XOR localFlips (symmetric difference)
// 純関数として独立して検証する。
function visiblyPicked(baseline: string[], localFlips: string[]): Set<string> {
  const out = new Set<string>(baseline);
  for (const m of localFlips) {
    if (out.has(m)) out.delete(m);
    else out.add(m);
  }
  return out;
}

describe('XOR selection (MemeReactionPicker visiblyPicked)', () => {
  it('empty baseline + empty flips → empty', () => {
    expect(Array.from(visiblyPicked([], []))).toEqual([]);
  });

  it('baseline only (no taps) → baseline as-is', () => {
    const s = visiblyPicked(['a', 'b'], []);
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(true);
    expect(s.size).toBe(2);
  });

  it('tap unpicked stamp → visiblyPicked has it', () => {
    const s = visiblyPicked([], ['草']);
    expect(s.has('草')).toBe(true);
  });

  it('tap picked stamp once → visiblyPicked drops it', () => {
    const s = visiblyPicked(['草'], ['草']);
    expect(s.has('草')).toBe(false);
  });

  it('tap same stamp twice → returns to baseline state (toggle off)', () => {
    // 旧版「picked ∪ recentLocalPicks」だと、baseline に無いスタンプを 2 連打しても
    // localPicks.delete で removes だけだったが、ここでは正しく empty に戻る
    const s = visiblyPicked([], ['草', '草']);
    expect(s.has('草')).toBe(false);
  });

  it('tap baseline stamp twice → back to picked (server cancel + re-tap)', () => {
    const s = visiblyPicked(['草'], ['草', '草']);
    expect(s.has('草')).toBe(true);
  });

  it('parity: odd number of taps = flipped from baseline', () => {
    expect(visiblyPicked([], Array(5).fill('x')).has('x')).toBe(true); // 5 flips = on
    expect(visiblyPicked([], Array(4).fill('x')).has('x')).toBe(false); // 4 flips = off
    expect(visiblyPicked(['x'], Array(3).fill('x')).has('x')).toBe(false); // 3 flips on baseline-on = off
    expect(visiblyPicked(['x'], Array(2).fill('x')).has('x')).toBe(true); // 2 flips on baseline-on = on
  });

  it('multiple stamps: mixed tap independent', () => {
    const s = visiblyPicked(['a', 'b'], ['c', 'a', 'a']); // c added, a toggled twice (back)
    expect(s.has('a')).toBe(true); // baseline + 2 flips
    expect(s.has('b')).toBe(true); // baseline only
    expect(s.has('c')).toBe(true); // 1 flip
    expect(s.size).toBe(3);
  });

  it('baseline immutable: visiblyPicked does not mutate input', () => {
    const baseline = ['a', 'b'];
    visiblyPicked(baseline, ['c']);
    expect(baseline).toEqual(['a', 'b']);
  });
});

// ============================================================
// Smart-queue parity ロジックの検証
// ============================================================
// fire-once-then-reconcile: 初回 tap で dispatch、settle 時に余剰 tap 数が
// 奇数なら net toggle をもう一度 dispatch する。
// → N 連打 = N % 2 == 0 なら 2 回 dispatch (net 0), N % 2 == 1 なら 1 回 dispatch (net 1)
// （但し N === 1 の場合は単に 1 回 dispatch）
function smartQueueDispatchCount(tapCount: number): number {
  if (tapCount === 0) return 0;
  // 初回 tap で 1 回 dispatch。残り (tapCount - 1) が奇数なら追加で 1 dispatch。
  // その追加 dispatch 自体は再帰的に同じロジックを適用するが、
  // tap がそれ以上来なければ追加余剰=0 で停止。
  let dispatches = 1;
  let remaining = tapCount - 1;
  while (remaining % 2 === 1) {
    dispatches += 1;
    remaining = 0; // 追加 dispatch の最中に新規 tap が来なければ余剰 0
    // (実装はループせず再帰で fire を呼ぶが、テストでは tap 連打中に追加 tap が
    //  来ない前提で 1 回追加で停止)
  }
  return dispatches;
}

describe('Smart-queue dispatch count (logical model)', () => {
  it('0 taps → 0 dispatches', () => {
    expect(smartQueueDispatchCount(0)).toBe(0);
  });

  it('1 tap → 1 dispatch', () => {
    expect(smartQueueDispatchCount(1)).toBe(1);
  });

  it('2 taps → 2 dispatches (net 0)', () => {
    expect(smartQueueDispatchCount(2)).toBe(2);
  });

  it('3 taps → 1 dispatch (extras=2 even, no extra fire)', () => {
    expect(smartQueueDispatchCount(3)).toBe(1);
  });

  it('4 taps → 2 dispatches (extras=3 odd, +1 fire)', () => {
    expect(smartQueueDispatchCount(4)).toBe(2);
  });

  it('5 taps → 1 dispatch (extras=4 even)', () => {
    expect(smartQueueDispatchCount(5)).toBe(1);
  });

  it('10 taps → 2 dispatches (extras=9 odd)', () => {
    expect(smartQueueDispatchCount(10)).toBe(2);
  });

  it('odd taps always end up with parity ON (1 net dispatch)', () => {
    for (const n of [1, 3, 5, 7, 9, 11]) {
      expect(smartQueueDispatchCount(n) % 2).toBe(1);
    }
  });

  it('even taps always end up with parity OFF (2 net dispatches)', () => {
    for (const n of [2, 4, 6, 8, 10]) {
      expect(smartQueueDispatchCount(n) % 2).toBe(0);
    }
  });
});
