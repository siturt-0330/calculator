// ============================================================
// Personalization — public barrel
// ============================================================
// すべての行動シグナルは端末ローカル保存のみ。サーバーには送らない。
//
// NOTE: 旧版は `export *` を 3 ファイルにかけていたが、これだと bundler が
// 「使われていない export」を判定できず、tag_block 等を一切触らないルートでも
// 全シンボルが initial chunk に乗ってしまう。名前付き再 export に切り替え。
// ============================================================

export { logEvent, getEvents, clearEvents, getEventCount } from './events';
export type { FeedEvent, EventKind } from './events';

export { computeProfile } from './profile';
export type { UserInterestProfile, AffinityMap } from './profile';

export { scoreCandidate, rankFeed, computePostScore, diversifyFeed, risingVelocity } from './score';
export type { RankableCandidate, RankReason, ScoredCandidate, ScoreInput } from './score';
