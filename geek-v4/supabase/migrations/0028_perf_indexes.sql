-- ============================================================
-- 0028_perf_indexes.sql
-- ============================================================
-- 大量同時アクセス時の読み込み性能を底上げする index 群。
--
-- 戦略:
--   1) HOT path 優先 — feed scroll / BBS scroll / community feed / 集計の順
--   2) partial index を最大活用 — visibility='public' のような selective な
--      条件は WHERE 句に入れて index size を圧縮 + planner が選びやすく
--   3) composite index は (filter, sort) の順 — equality → range の鉄則
--   4) 既存 PK と「逆順」になる lookup には別 index — likes/saves/concerns の
--      PK は (user_id, post_id) なので IN(post_ids) は seq scan 化していた
--   5) 全て CREATE INDEX IF NOT EXISTS — 冪等、再実行 OK
--
-- 注: CONCURRENTLY は migration の transaction 内では使えないので使わず。
-- 本番大規模 DB に流す時は migration を一時的に止めて手動 CONCURRENTLY 推奨。
--
-- 既存 index は drop しない (互換性維持)。重複しても planner が最適な方を選ぶ。
-- ============================================================

-- ============================================================
-- posts: home feed (visibility filter + 時間順)
-- ============================================================
-- fetchPosts (lib/api/posts.ts) は visibility IN ('public','community_public')
-- + created_at DESC が default。既存の posts_created_idx (is_public+is_anonymous
-- partial) は visibility カラムを含まないので、visibility での絞り込みが効かない。
-- → visibility 専用の composite partial index を新設。
create index if not exists posts_visibility_created_idx
  on public.posts (visibility, created_at desc)
  where visibility in ('public', 'community_public');

-- hot/top sort 用 (visibility + likes_count + created_at)
-- 既存 posts_hot_idx は formula 式 ((likes+comments*2) desc) で
-- 実 query (.order('likes_count') .order('created_at')) と一致しない。
create index if not exists posts_visibility_likes_created_idx
  on public.posts (visibility, likes_count desc, created_at desc)
  where visibility in ('public', 'community_public');

-- ============================================================
-- post_communities: コミュニティ詳細 feed
-- ============================================================
-- 既存 post_communities_community_idx (community_id, created_at desc) は
-- すでに 0023 にある。重複追加しないが、共通名で明示的に再宣言しておく。
-- (IF NOT EXISTS なので no-op)
create index if not exists post_communities_community_created_idx
  on public.post_communities (community_id, created_at desc);

-- ============================================================
-- bbs_threads: home BBS list (visibility + last_reply 順)
-- ============================================================
-- fetchThreads は visibility='public' + last_reply_at DESC NULLS LAST が hot path。
-- 既存 bbs_threads_created_idx は created_at で、last_reply_at ではない。
-- 既存 bbs_threads_visibility_idx は visibility 単独で order に効かない。
-- → partial composite が最速。
create index if not exists bbs_threads_visibility_lastreply_idx
  on public.bbs_threads (visibility, last_reply_at desc nulls last)
  where visibility = 'public';

-- ============================================================
-- bbs_threads: per-community BBS タブ
-- ============================================================
-- fetchCommunityThreads は community_id でフィルタ + last_reply_at (or replies_count) 順。
-- 既存 bbs_threads_community_idx は (community_id, created_at desc) なので
-- last_reply_at sort に効かない。
create index if not exists bbs_threads_community_lastreply_idx
  on public.bbs_threads (community_id, last_reply_at desc nulls last)
  where community_id is not null;

-- sort='hot' 用 (replies_count desc → last_reply_at desc)
create index if not exists bbs_threads_community_replies_idx
  on public.bbs_threads (community_id, replies_count desc, last_reply_at desc nulls last)
  where community_id is not null;

-- ============================================================
-- bbs_replies: thread を開いた時の reply 一覧
-- ============================================================
-- 既存 bbs_replies_thread_idx + bbs_replies_thread_created_idx で carry されている。
-- IF NOT EXISTS で確認のみ。
create index if not exists bbs_replies_thread_created_asc_idx
  on public.bbs_replies (thread_id, created_at asc);

-- ============================================================
-- community_members: マイコミュニティ一覧 + member check
-- ============================================================
-- 既存 community_members_user_idx (user_id, joined_at desc) はある。
-- is_community_member() の RLS で community_id+user_id の存在チェックが頻発するので
-- 単一の (community_id, user_id) lookup index を追加 (PK と重複だが PK の順は逆)。
-- PK は (community_id, user_id) なので実はカバーされている — IF NOT EXISTS で no-op。
-- 念のため明示。
create index if not exists community_members_user_joined_idx
  on public.community_members (user_id, joined_at desc);

-- ============================================================
-- tags: trending 表示 / discover
-- ============================================================
-- fetchTrendingTags で .in('name', candidateTags) の lookup (unique で OK)。
-- discover で post_count desc 並び替えるとき seq scan を防ぐ。
create index if not exists tags_postcount_desc_idx
  on public.tags (post_count desc nulls last);

-- member_count desc (Reddit-like subscribe 数) も将来使うので入れておく
create index if not exists tags_membercount_desc_idx
  on public.tags (member_count desc nulls last);

-- ============================================================
-- likes: bulk 'in' lookup
-- ============================================================
-- PK は (user_id, post_id) なので .in('post_id', [...]) は first-col に
-- 効かず seq scan 化していた。post_id 先頭の covering index で全件 index only scan。
create index if not exists likes_post_user_idx
  on public.likes (post_id, user_id);

-- ============================================================
-- saves: 同上 — feed の bulk 既保存判定
-- ============================================================
create index if not exists saves_post_user_idx
  on public.saves (post_id, user_id);

-- ============================================================
-- concerns: 同上 — getMyConcerns(postIds) で多用
-- ============================================================
-- 既存 index ゼロ (PK のみ)。.in('post_id', postIds) + .eq('user_id', uid) は
-- 全件 scan していた。post_id 先頭の composite で爆速化。
create index if not exists concerns_post_user_idx
  on public.concerns (post_id, user_id);

-- is_private=false の concern_count 集計を高速化 (0010 で trigger 内 count(*))
create index if not exists concerns_post_public_idx
  on public.concerns (post_id)
  where is_private = false;

-- ============================================================
-- post_reactions: post_id でまとめて lookup
-- ============================================================
-- 0008 で post_reactions_post_idx, 0014 で post_reactions_post_idx2 (post_id,meme)
-- がすでにあるので bulk in lookup はカバー済。確認のみ。
-- ここでは追加なし。

-- ============================================================
-- community_events: starts_at 近未来順
-- ============================================================
-- 既存 community_events_community_starts_idx (community_id, starts_at desc) が
-- ある。upcomingOnly=true (.gte('starts_at', now())) でも desc index が逆走で
-- 効くが、ascending order での starts_at >= now() という頻発 query 用に asc も追加。
create index if not exists community_events_community_starts_asc_idx
  on public.community_events (community_id, starts_at asc);

-- ============================================================
-- community_spots: 一覧
-- ============================================================
-- 既存 community_spots_community_idx (community_id, created_at desc) でカバー済。
-- 確認のみ。

-- ============================================================
-- profiles: nickname 検索 (admin panel + mention autocomplete)
-- ============================================================
-- lower(nickname) で case-insensitive 検索が出来るよう functional index。
create index if not exists profiles_nickname_lower_idx
  on public.profiles (lower(nickname));

-- ============================================================
-- posts: tag_names を GIN で配列検索可能に (タグ別 feed)
-- ============================================================
-- 既存 posts_tag_names_idx (0001) で既に GIN は存在。IF NOT EXISTS で no-op。
create index if not exists posts_tag_names_gin_idx
  on public.posts using gin (tag_names);

-- ============================================================
-- post_added_tags: bulk in lookup
-- ============================================================
-- 0004 で post_added_tags_post_idx (post_id 単独) はある。
-- fetchAddedTagsForPosts (lib/api/tags.ts) が .in('post_id', postIds)
-- + order created_at で読むので、composite を追加。
create index if not exists post_added_tags_post_created_idx
  on public.post_added_tags (post_id, created_at asc);

-- ============================================================
-- comments: post 単体取得 (FlashList 上の bulk read を意識)
-- ============================================================
-- 0001 と 0014 で carry されているが、composite (post_id, created_at) を
-- 強化して index only scan を取りやすくする。
create index if not exists comments_post_created_asc_idx
  on public.comments (post_id, created_at asc);

-- ============================================================
-- notifications: 未読 + 時間順 で取得
-- ============================================================
-- 0014 の notifications_user_unread_idx (read=false partial) はある。
-- 全件取得 (.order created_at desc + limit 50) 用は notifications_user_idx (0001)
-- で carry。追加なし。

-- ============================================================
-- 統計情報の更新 — index 作成後、planner が新 index を選ぶには ANALYZE が必要
-- ============================================================
analyze public.posts;
analyze public.bbs_threads;
analyze public.bbs_replies;
analyze public.communities;
analyze public.community_members;
analyze public.community_posts;
analyze public.post_communities;
analyze public.community_events;
analyze public.community_spots;
analyze public.community_tags;
analyze public.tags;
analyze public.likes;
analyze public.saves;
analyze public.concerns;
analyze public.post_reactions;
analyze public.comments;
analyze public.post_added_tags;
analyze public.profiles;
analyze public.notifications;

-- ============================================================
-- (Optional) Trending Tags Materialized View
-- ============================================================
-- 直近 24h の tag 出現頻度を 5 分毎に precompute。
-- fetchTrendingTags は現状 posts を limit 500 で読んでクライアント集計しているので
-- DB 側で precompute すればクライアント側 CPU + DB read 両方削減。
-- REFRESH MATERIALIZED VIEW CONCURRENTLY を可能にするため UNIQUE INDEX を必須化。
--
-- ↓ 採用に踏み切れていないので一旦は CREATE のみ。REFRESH は pg_cron / Edge
-- Function 経由で `select cron.schedule('refresh-trending', '*/5 * * * *',
-- 'refresh materialized view concurrently public.mv_trending_tags');` などで。
-- ============================================================
create materialized view if not exists public.mv_trending_tags as
select
  tag,
  count(*) as recent_count,
  max(created_at) as last_seen
from (
  select unnest(tag_names) as tag, created_at
  from public.posts
  where created_at >= now() - interval '24 hours'
    and visibility in ('public', 'community_public')
) t
group by tag
order by recent_count desc;

create unique index if not exists mv_trending_tags_tag_idx
  on public.mv_trending_tags (tag);

create index if not exists mv_trending_tags_count_desc_idx
  on public.mv_trending_tags (recent_count desc);

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0028_perf_indexes 完了: 16 indexes + 1 MV' as result;
