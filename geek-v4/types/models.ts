export type PostKind = 'fact' | 'opinion' | 'joke' | 'wip';
export type AccountState = 'healthy' | 'caution' | 'restricted' | 'warned' | 'suspended';
export type ConcernReason = 'misinfo' | 'unverified' | 'spam' | 'rude' | 'scam' | 'other';

export type CWCategory = 'spoiler' | 'nsfw' | 'violence' | 'sensitive' | null;

export type PostVisibility = 'private' | 'public' | 'community_only' | 'community_public';

export type Post = {
  id: string;
  content: string;
  media_urls: string[];
  media_blurhashes: string[];
  // 動画添付 (migration 0043 で追加)。サーバー側で default '{}' を持つので
  // 過去 post でも空配列が返る (NULL にはならない)。
  video_urls?: string[];
  video_durations?: number[];
  video_posters?: string[];
  tag_names: string[];
  likes_count: number;
  comments_count: number;
  score: number;
  hot_score: number;
  concern_count: number;
  kind: PostKind;
  source_url: string | null;
  is_public: boolean;
  trust_score_at_post: number;
  is_anonymous: boolean;
  content_warning?: string | null;
  cw_category?: CWCategory;
  visibility?: PostVisibility;
  created_at: string;
  // posts.author_id — RLS で誰でも読める。公式管理者識別のため fetch する。
  author_id?: string;
  // 公式コミュニティの管理者が投稿した時に、posts API 側でクライアントが
  // 算出する派生フィールド。is_official=true なコミュニティに紐付き、かつ
  // post.author_id === community.official_admin_user_id の時のみセットされる。
  // セット時は「匿」の代わりに実名 · 所属を表示する。
  official_author?: { name: string; organization: string } | null;
};

export type Comment = {
  id: string;
  post_id: string;
  content: string;
  avatar_color: string;
  created_at: string;
  trust_score?: number | null;  // 著者の現在の信頼スコア
};

export type Tag = {
  id: string;
  name: string;
  post_count: number;
};

export type ThreadVisibility = 'public' | 'community_only';

export type BBSThread = {
  id: string;
  title: string;
  category: string;
  replies_count: number;
  last_reply_at: string | null;
  created_at: string;
  // Migration 0023 で追加 — null は通常の全体 BBS スレッド
  community_id?: string | null;
  visibility?: ThreadVisibility;
};

export type BBSReply = {
  id: string;
  thread_id: string;
  content: string;
  color: string;
  created_at: string;
  trust_score?: number | null;  // 著者の現在の信頼スコア
};

export type Notification = {
  id: string;
  // 'official_post' は公式コミュニティ管理者投稿 (migration 0035 のトリガー由来)。
  // tag_name にはコミュニティ名が入る — 遷移時に name→id でルックアップする。
  type: 'like' | 'comment' | 'follow' | 'reply' | 'event' | 'official_post';
  tag_name: string | null;
  message: string;
  read: boolean;
  created_at: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  location: string;
  tag_name: string;
  is_official: boolean;
};

export type Goods = {
  id: string;
  title: string;
  description: string;
  price: number;
  media_url: string | null;
  tag_name: string;
  created_at: string;
};

export type FriendPost = {
  id: string;
  content: string;
  tag_name: string;
  created_at: string;
};

export type TrustScoreBreakdown = {
  total: number;
  post_count: number;
  like_received: number;
  report_received: number;
};
