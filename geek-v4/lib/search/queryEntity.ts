// ============================================================
// queryEntity — クエリの keywords を entity (対象) + modifiers (絞り込み) に分類
// ============================================================
// 概要:
//   parseQuery は「構文」 (phrase / tag operator / 除外 / etc) を解釈する。
//   classifyIntent (queryIntent.ts) は kind (person/work/place/year/...) を分類する。
//   ここでは keywords[] を **タグ inventory** と照合して
//   「具体的な対象 (entity)」 と「絞り込み修飾語 (modifier)」 に分解する。
//
//   例:
//     「乃木坂46 ライブ」  → entity: "乃木坂46", modifiers: ["ライブ"]
//     「ホロライブ 卒業」  → entity: "ホロライブ", modifiers: ["卒業"]
//     「新曲 おすすめ」    → entity: null,        modifiers: ["新曲", "おすすめ"]
//     「ラーメン」         → entity: "ラーメン",  modifiers: []
//
// 用途:
//   - entity が分かれば post.tag_names に含まれる post を強くブースト
//   - cooccur で entity を拡張 → 同クラスタの post も少し上げる
//   - modifiers は本文一致のみに使う (タグでは弱い)
//
// なぜ parseQuery と分けた?:
//   - parseQuery は構文解析 (pure, tag inventory 不要) のまま保つ
//   - classifyEntity は tag inventory を参照する別の責務
// ============================================================

import { deepNormalize } from './tokenize';
import type { ParsedQuery } from './queryParser';
import type { CooccurMap } from '../tagClustering/suggest';
import { getRelatedTags } from '../tagClustering/relations';

export type QueryEntity = {
  entity: string | null;        // 最も具体的な「対象」 — 元表記で返す
  entityNorm: string | null;    // 正規化済み (scoring 比較用)
  modifiers: string[];          // 「絞り込み」 — entity 以外のキーワード (元表記)
  // entity と共起する関連タグ (Phase 2 relations 由来) — entity が null なら []
  // post の tag_names と照合して「同じクラスタ」の post を識別するのに使う
  relatedEntities: string[];    // 正規化済み
};

// ============================================================
// 主関数: クエリの keywords を entity + modifiers に分類
// ============================================================
//
// ルール:
//   1) parseQuery の tag: operator で明示指定があれば最優先 entity
//   2) keywords[] を順に走査、最初に knownTagSet に当たる物 = entity (= 1 つだけ)
//   3) 残りはすべて modifiers
//   4) cooccur が渡された場合、entity の top-K 共起タグを relatedEntities に
//
// 例: query "乃木坂46 ライブ 配信"
//   keywords = ["乃木坂46", "ライブ", "配信"]
//   knownTagSet ∋ "乃木坂46"
//   → entity = "乃木坂46", modifiers = ["ライブ", "配信"]
//
// 例: query "新曲 おすすめ"  (どちらもタグじゃない)
//   → entity = null, modifiers = ["新曲", "おすすめ"]
//   (本文 hit を狙う)
//
// 例: query "乃木坂46 日向坂46" (両方タグ)
//   → entity = "乃木坂46" (最初のヒット), modifiers = ["日向坂46"]
//   (modifiers にもう一方のタグが残るが、scoring 側で両方をタグマッチで拾える)
export function classifyEntity(
  q: ParsedQuery,
  knownTagSet: ReadonlySet<string>,
  opts?: { cooccur?: CooccurMap; relatedTopK?: number },
): QueryEntity {
  let entity: string | null = null;
  let entityNorm: string | null = null;
  const modifiers: string[] = [];

  // tag: operator で明示されてれば最優先 entity
  if (q.tags.length > 0) {
    const t = q.tags[0]!;
    entity = t;
    entityNorm = deepNormalize(t);
  }

  for (const k of q.keywords) {
    const n = deepNormalize(k);
    if (!n) continue;
    if (!entity && knownTagSet.has(n)) {
      entity = k;
      entityNorm = n;
    } else {
      modifiers.push(k);
    }
  }

  // entity から cooccur で拡張 (Phase 2 relations primitive を使用)
  let relatedEntities: string[] = [];
  if (entity && opts?.cooccur) {
    const related = getRelatedTags(entity, opts.cooccur, {
      topK: opts.relatedTopK ?? 6,
      minCount: 3,
    });
    relatedEntities = related.map((r) => r.tag);
  }

  return { entity, entityNorm, modifiers, relatedEntities };
}

// ============================================================
// 表示用: entity classification を人間が読める形にする
// ============================================================
// UI の検索結果ヘッダなどで「これは○○についての検索です」と表示する用。
export function describeEntity(qe: QueryEntity): string {
  if (qe.entity && qe.modifiers.length > 0) {
    return `${qe.entity} に関する「${qe.modifiers.join(' ')}」`;
  }
  if (qe.entity) return qe.entity;
  if (qe.modifiers.length > 0) return qe.modifiers.join(' ');
  return '';
}
