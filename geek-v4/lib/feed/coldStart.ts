// ============================================================
// lib/feed/coldStart.ts — cold-start interest feed の flag / 定数 (MVP)
// ------------------------------------------------------------
// 興味タグを選んで onboarding を終えた新規ユーザーを、初回フィードだけ既存の
// 興味スコープ (scope='closed' = サーバー側 overlaps(tag_names, likedTags)) に
// 着地させるための flag。これにより「on-topic な投稿で埋まった初回フィード」を
// 即提示でき、活性化 (Fogg B=MAP) と content-freshness retention を狙う。
//
// 依存ゼロの薄いモジュールとして切り出す理由:
//   stores/feedStore.ts から参照するが、feedQuery.ts (react-query / lib/api 依存)
//   は FeedScope を feedStore.ts から import しているため、そちらに定数を置くと
//   循環依存 + 重い import 連鎖を store に持ち込んでしまう。ここは pure data のみ。
//
// ★ 既定 OFF。CLAUDE.md §14 の通り、既定 OFF flag は必ず `=== '1'` で判定する
//   (`!== '0'` をコピペすると意図せず既定 ON になる)。本番は netlify.toml で ON。
// ============================================================

export const COLDSTART_INTEREST_FEED_ENABLED =
  process.env.EXPO_PUBLIC_COLDSTART_INTEREST_FEED === '1';

/** cold-start で興味スコープへ着地させる最小興味タグ数 (これ未満は open のまま)。 */
export const MIN_INTERESTS_FOR_COLDSTART = 1;

/**
 * cold-start 着地の純粋な決定関数 (副作用なし / RN 非依存 → unit test 可能)。
 *
 * @returns 興味スコープ (closed) へ着地させるべきなら true。flag OFF / 興味タグが
 *   閾値未満なら false (= 呼び出し側は scope を変えず open のままにする)。
 *
 * ※ 「適用済みか (one-shot)」の判定は呼び出し側 (store の coldStartApplied sentinel)
 *   が持つ。ここは「今この瞬間 closed にすべきか?」だけを純粋に返す。
 */
export function shouldLandInInterestScope(
  likedCount: number,
  enabled: boolean = COLDSTART_INTEREST_FEED_ENABLED,
): boolean {
  return enabled && likedCount >= MIN_INTERESTS_FOR_COLDSTART;
}
