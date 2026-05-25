// ============================================================
// lib/community/tabSets.ts
// ------------------------------------------------------------
// コミュニティ詳細画面のタブ構成をジャンル別に決定する純関数群。
// 詳細画面 (app/(tabs)/community/[id]/index.tsx) から import するだけでなく、
// 単体テスト (tests/unit/communityTabSets.test.ts) からも import するため
// page 直書きではなく lib に切り出している。
//
// migration 0044 で genre が追加されたタイミングで作成。
// ============================================================

import type { CommunityGenre } from '../api/communities';

export type CommunityTabKey =
  | 'feed'
  | 'threads'
  | 'spots'
  | 'events'
  | 'compose'
  | 'comments'
  | 'search'
  | 'profile';

// ジャンル別のタブセット (migration 0044 と対応)
// "何をやらないか" を明示するためタブ数は最小限に絞っている。
// 順序がそのままタブバーの並びになる。
export const GENRE_TAB_SETS: Record<CommunityGenre, CommunityTabKey[]> = {
  // 推し系 — ライブ参戦 / 聖地巡礼 / セトリ記録が主軸。掲示板は無し
  oshi:       ['feed', 'search', 'spots', 'events', 'profile'],
  // 作品系 — 考察 / 撮影地紹介。カレンダー / マイプロフ無し
  creative:   ['feed', 'threads', 'spots'],
  // 体験系 — サウナ / 旅行 / グルメ。記録もマップも全部いる
  experience: ['feed', 'threads', 'search', 'spots', 'events', 'profile'],
  // 議論系 — シンプルに語り合う。マップもカレンダーもいらない
  discussion: ['feed', 'threads'],
  // 旧コミュ — migration 前の既存 community 向け。後方互換のため compose を保持
  legacy:     ['feed', 'threads', 'spots', 'events', 'compose'],
};

// ジャンル別のタブラベル。新ジャンルでは「マップ」、legacy のみ「聖地」を維持。
const TAB_LABEL_DEFAULTS: Record<CommunityTabKey, string> = {
  feed: 'ホーム',
  threads: '掲示板',
  spots: 'マップ',
  events: 'カレンダー',
  compose: '投稿',
  comments: 'コメント',
  search: '検索',
  profile: 'マイプロフ',
};
const LEGACY_LABEL_OVERRIDE: Partial<Record<CommunityTabKey, string>> = {
  spots: '聖地',
};

// 公式コミュニティ用のタブセット (genre に依存しない別経路)
// - ホーム: 公式管理者のみ投稿可
// - Q&A: 旧「掲示板」を置換 — NotebookLM 風の質疑応答
// - 聖地 / カレンダー: 同じ
// - コメント: 旧「投稿」を置換 — 一般ユーザーが唯一書き込める場
const OFFICIAL_TABS: { key: CommunityTabKey; label: string }[] = [
  { key: 'feed', label: 'ホーム' },
  { key: 'threads', label: 'Q&A' },
  { key: 'spots', label: '聖地' },
  { key: 'events', label: 'カレンダー' },
  { key: 'comments', label: 'コメント' },
];

/**
 * コミュニティ詳細画面で表示すべきタブ一覧を返す。
 *
 * - `isOfficial=true` のときは genre を無視して OFFICIAL_TABS を返す
 *   (公式専用 Q&A / コメント機能のため別経路)
 * - 通常コミュは genre に応じた GENRE_TAB_SETS から構築
 * - genre が undefined (RPC fetch 結果が古い等) なら legacy として扱う
 */
export function getTabsFor(
  genre: CommunityGenre | undefined,
  isOfficial: boolean,
): { key: CommunityTabKey; label: string }[] {
  if (isOfficial) return OFFICIAL_TABS;
  const g: CommunityGenre = genre ?? 'legacy';
  const keys = GENRE_TAB_SETS[g];
  return keys.map((k) => ({
    key: k,
    label: (g === 'legacy' ? LEGACY_LABEL_OVERRIDE[k] : undefined) ?? TAB_LABEL_DEFAULTS[k],
  }));
}
