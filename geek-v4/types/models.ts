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
  // Q&A モード (migration 0067) — post author が enable すると、コメント sort で
  //   author が返信したスレッドが上位に来る (lib/utils/qaSort.ts)。AMA 用途。
  qa_mode?: boolean;
  created_at: string;
  // posts.author_id — RLS で誰でも読める。公式管理者識別のため fetch する。
  // ★ de-anon Phase2: 2b で anon/authenticated から SELECT(author_id) を REVOKE するため、
  //   段階的に client から author_id 参照を外していく (移行中は fallback 用に optional 保持)。
  author_id?: string;
  // de-anon Phase2: server (feed/community RPC) が「閲覧者自身の投稿か」を boolean で供給する
  //   派生フィールド。author_id 比較を client から無くすための置換 (REVOKE 後は author_id が来ない)。
  is_own?: boolean;
  // de-anon Phase2: 投稿者アイデンティティの表示用フィールド (author_id 非依存)。
  //   - avatar_url / avatar_emoji: 投稿者アバター (画像優先 → emoji → 色+頭文字 fallback)。
  //   - pseudonym_id: 安定した擬似ハンドルを導出するためのトークン (lib/utils/pseudonym.ts)。
  //     ★ author_id ではなくサーバが供給するこのトークンを使う (実名特定を防ぐ)。
  avatar_url?: string | null;
  avatar_emoji?: string | null;
  pseudonym_id?: string | null;
  // Reddit スタイル author 表示用。
  //   - home feed: communities prop から community 名/icon を使用するため不要。
  //   - community tab (viewContext='community'): fetchCommunityPosts が profiles から一括取得して attach。
  author_nickname?: string;
  author_avatar_url?: string | null;
  // ★ BBS 統合 (migration 0075) — title is not null なら「スレ形式」の post。
  //   通常の写真投稿は title=null。フィード描画では title あれば content の上に大きく表示。
  title?: string | null;
  // ★ BBS 統合 (migration 0075) — 最終アクティビティ時刻 (最新コメント or 作成時)。
  //   sort 'hot' や discovery で「直近で動いているスレ」を引き出すのに使う。
  last_activity_at?: string | null;
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
  author_id?: string | null;  // コメント主の user id — モデレーション操作・own判定用 (fetchComments が SELECT)
  trust_score?: number | null;  // 著者の現在の信頼スコア
  // ============================================================
  // コメントツリー (migration 0059)
  // ------------------------------------------------------------
  // - parent_comment_id: 直接の親 (返信ボタンで指定)。NULL = ルート。
  //   trigger で 4 段超は NULL に矯正されるので、クライアントは
  //   depth = 0..3 までを想定して良い。
  // - reply_to_comment_id: メンション通知の宛先 comment。深い階層で
  //   parent が nullify されても、特定の発言を狙えるようにするための field。
  // - children / depth は client side で buildCommentTree が組み立てる派生 field。
  // ============================================================
  parent_comment_id?: string | null;
  reply_to_comment_id?: string | null;
  // コメント添付メディア (migration 0104)。posts-media bucket の公開 URL 配列。
  // 画像/動画は拡張子 (.mp4/.mov/.webm/.m4v) で判別する。列が無い環境では undefined。
  media_urls?: string[] | null;
  children?: Comment[];
  depth?: number;
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
  // 投稿者 user_id。クライアントは「スレ内 ID」表示用に hash する
  // (lib/utils/threadUserId.ts)。RLS bbs_replies_read で公開済なので
  // 露出自体は新規露出ではなく、SELECT 漏れを補う形。
  author_id?: string;
};

export type Notification = {
  id: string;
  // 'official_post' は公式コミュニティ管理者投稿 (migration 0035 のトリガー由来)。
  // tag_name にはコミュニティ名が入る — 遷移時に name→id でルックアップする。
  // 'join_request' は request 制コミュニティへの参加申請 (migration 0101 の
  // community_join_requests AFTER INSERT トリガー由来)。owner / admin に届く。
  // data.community_id を遷移先 (/community/<id>/admin) として使う。
  type:
    | 'like'
    | 'comment'
    | 'follow'
    | 'reply'
    | 'event'
    | 'official_post'
    | 'mention'
    | 'announcement'
    | 'join_request'
    // 'system' はアカウント状態変更通知 (警告 / 停止 / 解除 等、migration 0060 の
    // account_state_history AFTER INSERT トリガー由来)。
    | 'system';
  tag_name: string | null;
  message: string;
  read: boolean;
  created_at: string;
  /** 通知種別ごとの追加メタ (jsonb)。join_request は community_id / applicant_user_id 等を含む。 */
  data?: Record<string, unknown> | null;
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

// ============================================================
// 友達追加 + 写真アルバム (migration 0051 / 0052)
// ------------------------------------------------------------
// docs/MYPAGE_ALBUMS_SPEC.md § 3 を反映。
// - friendships: 互恵承認制 (pending → accepted)
// - friend_invites: 招待リンク (検索なし運用)
// - albums / album_photos: photo 単位 + album 単位 共有
// ============================================================

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export interface Friendship {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: FriendshipStatus;
  created_at: string;
  accepted_at?: string | null;
  // join 時に付加: 相手 (= 自分でない方) の profile
  friend_profile?: {
    id: string;
    nickname: string | null;
    avatar_url: string | null;
    avatar_emoji: string | null;
    bio: string | null;
  };
}

export interface FriendInvite {
  code: string;
  created_by: string;
  used_by?: string | null;
  created_at: string;
  expires_at: string;
  used_at?: string | null;
}

export type PhotoVisibility = 'private' | 'shared';

export interface Album {
  id: string;
  owner_id: string;
  title: string;
  description?: string | null;
  cover_photo_id?: string | null;
  cover_url?: string | null;  // join 時に付加 (album_photos から)
  visibility: PhotoVisibility;
  shared_with_user_ids: string[];
  photo_count: number;
  created_at: string;
  updated_at: string;
}

export interface AlbumPhoto {
  id: string;
  owner_id: string;
  album_id?: string | null;
  image_url: string;
  caption?: string | null;
  visibility: PhotoVisibility;
  shared_with_user_ids: string[];
  is_hidden: boolean;
  width?: number | null;
  height?: number | null;
  blurhash?: string | null;
  position: number;
  created_at: string;
}
