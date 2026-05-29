// ============================================================
// lib/community/tabSets.ts
// ------------------------------------------------------------
// コミュニティ詳細画面のタブ識別子。
//
// 2026-05: ジャンル別タブバー (#95 feat/community-genre-tabs) は撤去済み。
// 詳細画面は FeedTab (ホーム) のみを描画し、掲示板 / 聖地 / カレンダー /
// 管理は個別 route からアクセスする。ジャンル → タブセット対応表
// (GENRE_TAB_SETS) と getTabsFor() / 公式タブ定義は休眠コードだったため削除。
// CommunityTabKey 型のみ、詳細画面の activeTab / visitedTabs 管理に
// 引き続き使うので残す。
// ============================================================

export type CommunityTabKey =
  | 'feed'
  | 'threads'
  | 'spots'
  | 'events'
  | 'compose'
  | 'comments'
  | 'search'
  | 'profile';
