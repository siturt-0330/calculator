-- ============================================================
-- 0014: 堅牢化 - インデックス追加 + RLS 強化 + サーバーサイド rate limit
-- ============================================================

-- ============================================================
-- 1. パフォーマンス: 不足してるインデックスの追加
-- ============================================================

-- posts: tag_names での検索が多い (GIN は既にあるが)、作成日順の複合 index
create index if not exists posts_created_idx
  on public.posts(created_at desc)
  where is_public = true and is_anonymous = true;

-- posts: likes_count + comments_count での hot ソート用
create index if not exists posts_hot_idx
  on public.posts((likes_count + comments_count * 2) desc, created_at desc)
  where is_public = true;

-- comments: 投稿に対するコメント取得 (created_at で並べる)
create index if not exists comments_post_created_idx
  on public.comments(post_id, created_at desc);

-- bbs_replies: スレッドに対する返信取得
create index if not exists bbs_replies_thread_created_idx
  on public.bbs_replies(thread_id, created_at asc);

-- saves: 自分の保存リスト取得
create index if not exists saves_user_created_idx
  on public.saves(user_id, created_at desc);

-- likes: 投稿主の通知用 (post_id でグルーピング)
create index if not exists likes_post_idx
  on public.likes(post_id, created_at desc);

-- notifications: 未読数カウント高速化
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, read, created_at desc)
  where read = false;

-- post_reactions: 投稿のリアクション取得
create index if not exists post_reactions_post_idx2
  on public.post_reactions(post_id, meme);

-- ============================================================
-- 2. RLS 強化: 既存ポリシーの安全性確認 + 不足分追加
-- ============================================================

-- comments: 自分のコメントは削除可能に
drop policy if exists "comments_delete_self" on public.comments;
create policy "comments_delete_self" on public.comments
  for delete using (auth.uid() = author_id);

-- bbs_replies: 自分の返信は削除可能に
drop policy if exists "bbs_replies_delete_self" on public.bbs_replies;
create policy "bbs_replies_delete_self" on public.bbs_replies
  for delete using (auth.uid() = author_id);

-- posts: 自分の投稿は update / delete 可能 (既存) + 確認
drop policy if exists "posts_delete_self" on public.posts;
create policy "posts_delete_self" on public.posts
  for delete using (auth.uid() = author_id);

-- ============================================================
-- 3. サーバーサイド rate limit (Trigger function)
--    クライアントの checkRate と二重防御
-- ============================================================

-- 投稿が直近 1 分間に 5 件以上あれば reject
create or replace function public.enforce_post_rate_limit()
returns trigger language plpgsql security definer as $$
declare
  cnt int;
begin
  select count(*) into cnt
    from public.posts
    where author_id = NEW.author_id
      and created_at > now() - interval '1 minute';
  if cnt >= 5 then
    raise exception 'rate limit: posts (max 5/min)';
  end if;
  return NEW;
end;
$$;

drop trigger if exists posts_rate_limit_trg on public.posts;
create trigger posts_rate_limit_trg
  before insert on public.posts
  for each row execute procedure public.enforce_post_rate_limit();

-- コメントレートリミット: 直近1分で10件以上で reject
create or replace function public.enforce_comment_rate_limit()
returns trigger language plpgsql security definer as $$
declare cnt int;
begin
  select count(*) into cnt
    from public.comments
    where author_id = NEW.author_id
      and created_at > now() - interval '1 minute';
  if cnt >= 10 then
    raise exception 'rate limit: comments (max 10/min)';
  end if;
  return NEW;
end;
$$;

drop trigger if exists comments_rate_limit_trg on public.comments;
create trigger comments_rate_limit_trg
  before insert on public.comments
  for each row execute procedure public.enforce_comment_rate_limit();

-- BBS 返信レートリミット
create or replace function public.enforce_bbs_reply_rate_limit()
returns trigger language plpgsql security definer as $$
declare cnt int;
begin
  select count(*) into cnt
    from public.bbs_replies
    where author_id = NEW.author_id
      and created_at > now() - interval '1 minute';
  if cnt >= 10 then
    raise exception 'rate limit: bbs replies (max 10/min)';
  end if;
  return NEW;
end;
$$;

drop trigger if exists bbs_replies_rate_limit_trg on public.bbs_replies;
create trigger bbs_replies_rate_limit_trg
  before insert on public.bbs_replies
  for each row execute procedure public.enforce_bbs_reply_rate_limit();

-- ============================================================
-- 4. AUDIT 列追加 (将来のフォレンジック用)
-- ============================================================

-- posts に updated_at がない場合追加 + auto update trigger
alter table public.posts add column if not exists updated_at timestamptz not null default now();
create or replace function public.touch_posts_updated_at()
returns trigger language plpgsql as $$
begin NEW.updated_at = now(); return NEW; end; $$;
drop trigger if exists posts_touch_trg on public.posts;
create trigger posts_touch_trg
  before update on public.posts
  for each row execute procedure public.touch_posts_updated_at();

-- ============================================================
-- 5. データ整合性: 孤立データ自動削除 (CASCADE) の確認は schema 定義で実施済み
--    (likes / saves / concerns / comments / bbs_replies / post_reactions
--     はすべて posts.id への on delete cascade を持つ)
-- ============================================================

-- 完了
select 'migration 0014 完了: 8 indexes, 3 rate limits, 2 delete policies' as result;
