export type Post = {
  id: string;
  content: string;
  media_urls: string[];
  media_blurhashes: string[];
  tag_names: string[];
  likes_count: number;
  comments_count: number;
  trust_score_at_post: number;
  is_anonymous: boolean;
  created_at: string;
};

export type Comment = {
  id: string;
  post_id: string;
  content: string;
  avatar_color: string;
  created_at: string;
};

export type Tag = {
  id: string;
  name: string;
  post_count: number;
};

export type BBSThread = {
  id: string;
  title: string;
  category: string;
  replies_count: number;
  last_reply_at: string | null;
  created_at: string;
};

export type BBSReply = {
  id: string;
  thread_id: string;
  content: string;
  color: string;
  created_at: string;
};

export type Notification = {
  id: string;
  type: 'like' | 'comment' | 'follow' | 'event';
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
