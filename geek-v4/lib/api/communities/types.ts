// ============================================================
// communities/types.ts — communities API 共通型
// ============================================================
// すべての submodule が依存する DB row 型 + UUID 形式 regex。
// 「型だけ要りたい」consumer (component の prop typing 等) も
// `import type { Community } from '../lib/api/communities'` で済むよう、
// barrel に export している。
// ============================================================

export type Visibility = 'open' | 'request' | 'invite';
export type MemberRole = 'owner' | 'admin' | 'member';

export type Community = {
  id: string;
  name: string;
  description: string;
  icon_emoji: string;
  icon_color: string;
  icon_url: string | null;
  visibility: Visibility;
  member_count: number;
  post_count: number;
  last_post_at: string | null;
  created_by: string;
  created_at: string;
  // 公式コミュニティ (migration 0032)
  is_official?: boolean;
  official_admin_user_id?: string | null;
  official_admin_display_name?: string | null;
  official_organization?: string | null;
  official_features?: Array<'qna' | 'calendar' | 'map'>;
};

export type CommunityWithMembership = Community & {
  is_member: boolean;
  role: MemberRole | null;
  tags: string[];
};

export type CommunityPost = {
  id: string;
  community_id: string;
  author_id: string;
  body: string;
  image_url: string | null;
  created_at: string;
};

export type CommunityPostWithCommunity = CommunityPost & {
  community: Pick<Community, 'id' | 'name' | 'icon_emoji' | 'icon_color' | 'icon_url' | 'is_official'>;
  author_nickname?: string;
  // 公式コミュ管理者投稿の de-anonymize 用 (匿名ニックネームではなく実名 · 所属を表示)
  official_author?: { name: string; organization: string } | null;
};

// ============================================================
// 聖地 (community_spots) — 地図ベース・スポット
// ============================================================
export type CommunitySpot = {
  id: string;
  community_id: string;
  name: string;
  description: string;
  lat: number;
  lon: number;
  photo_url: string | null;
  created_by: string;
  created_at: string;
  is_certified?: boolean;
};

// ============================================================
// カレンダー (community_events) — オフ会 / イベント
// ============================================================
export type CommunityEvent = {
  id: string;
  community_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  photo_url: string | null;
  created_by: string;
  created_at: string;
};

// ============================================================
// posts.ts で使う Post-as-CommunityFeed 用の lite メタ型
// ============================================================
export type CommunityMetaLite = {
  id: string;
  name: string;
  icon_emoji: string;
  icon_color: string;
  icon_url: string | null;
  is_official: boolean;
};

// 共通 UUID 形式チェック (community_id / spot_id / event_id 入力検証)
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
