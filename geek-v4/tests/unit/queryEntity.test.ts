// ============================================================
// queryEntity — classify entity + modifiers のロジック test
// ============================================================
// parseQuery と classifyEntity を組み合わせて挙動を検証。
// classifyEntity 自体は pure (knownTagSet と optional cooccur が入力)。
// ============================================================

import { parseQuery } from '../../lib/search/queryParser';
import { classifyEntity, describeEntity } from '../../lib/search/queryEntity';
import type { CooccurMap } from '../../lib/tagClustering/suggest';

// helper: query 文字列 → classifyEntity 適用
function classify(
  raw: string,
  knownTags: string[],
  cooccur?: CooccurMap,
) {
  const q = parseQuery(raw);
  const knownSet = new Set(knownTags.map((t) => t.toLowerCase()));
  return classifyEntity(q, knownSet, { cooccur });
}

describe('classifyEntity — entity + modifiers', () => {
  it('keywords 全部が unknown → entity=null, modifiers に全部', () => {
    const r = classify('新曲 おすすめ', []);
    expect(r.entity).toBeNull();
    expect(r.modifiers).toEqual(['新曲', 'おすすめ']);
  });

  it('最初の keyword が known tag → entity に', () => {
    const r = classify('乃木坂46 ライブ', ['乃木坂46']);
    expect(r.entity).toBe('乃木坂46');
    expect(r.entityNorm).toBe('乃木坂46');
    expect(r.modifiers).toEqual(['ライブ']);
  });

  it('keyword 内に entity が複数あっても最初の 1 つだけ', () => {
    const r = classify('乃木坂46 日向坂46 ライブ', ['乃木坂46', '日向坂46']);
    expect(r.entity).toBe('乃木坂46');
    expect(r.modifiers).toEqual(['日向坂46', 'ライブ']);
  });

  it('tag: operator の指定が最優先で entity', () => {
    const r = classify('tag:ホロライブ 配信 切り抜き', ['ホロライブ', '配信']);
    // tag: で明示された ホロライブ が entity
    expect(r.entity).toBe('ホロライブ');
    // 配信 は knownTagSet にあるが、entity 既に確定済みなので modifiers 行き
    expect(r.modifiers).toContain('配信');
    expect(r.modifiers).toContain('切り抜き');
  });

  it('keywords が空 → entity=null, modifiers=[]', () => {
    const r = classify('', ['乃木坂46']);
    expect(r.entity).toBeNull();
    expect(r.modifiers).toEqual([]);
  });

  it('cooccur が渡されたら relatedEntities が populate される', () => {
    const cooccur: CooccurMap = {
      乃木坂46: { 日向坂46: 30, 櫻坂46: 25, ライブ: 10 },
    };
    const r = classify('乃木坂46 配信', ['乃木坂46'], cooccur);
    expect(r.entity).toBe('乃木坂46');
    // related に日向坂46 と 櫻坂46 (deepNormalize 後の lowercase) が含まれる
    expect(r.relatedEntities.length).toBeGreaterThan(0);
    expect(r.relatedEntities).toContain('日向坂46');
  });

  it('entity が null → relatedEntities は []', () => {
    const cooccur: CooccurMap = { A: { B: 10 } };
    const r = classify('unknown1 unknown2', [], cooccur);
    expect(r.relatedEntities).toEqual([]);
  });

  it('表記揺れ (大小文字) を吸収して entity 判定', () => {
    // knownTagSet には "vtuber" (lowercase) のみだが、入力は "Vtuber" (大文字)
    const r = classify('Vtuber 配信', ['vtuber']);
    expect(r.entity).toBe('Vtuber');  // 元表記
    expect(r.entityNorm).toBe('vtuber');  // 正規化
  });
});

describe('describeEntity — UI 表示用', () => {
  it('entity + modifiers → 結合表示', () => {
    const r = classify('乃木坂46 ライブ', ['乃木坂46']);
    expect(describeEntity(r)).toContain('乃木坂46');
    expect(describeEntity(r)).toContain('ライブ');
  });

  it('entity のみ → entity を返す', () => {
    const r = classify('乃木坂46', ['乃木坂46']);
    expect(describeEntity(r)).toBe('乃木坂46');
  });

  it('modifiers のみ → 結合表示', () => {
    const r = classify('新曲 おすすめ', []);
    expect(describeEntity(r)).toBe('新曲 おすすめ');
  });

  it('全て空 → 空文字', () => {
    const r = classify('', []);
    expect(describeEntity(r)).toBe('');
  });
});
