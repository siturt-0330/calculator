-- ============================================================
-- 0015: アカウント完全削除 + データエクスポート権限
-- ============================================================
-- GDPR Right to Erasure / 個人情報保護法の利用停止・消去請求への対応
--
-- 提供する仕組み:
--   1. RPC `delete_account()` — 本人だけが呼べる security definer 関数
--      - 関連テーブルから本人レコードを削除
--      - auth.users 自体は手動削除 or Supabase admin task で処理
--      - SECURITY DEFINER で all-tables 削除権限を一時的に得る
--   2. 各テーブルの DELETE RLS ポリシー
--      - クライアント側フォールバック削除用
--      - 0014_hardening で一部追加済み (posts/comments/bbs_replies/bbs_threads)
--      - ここで残りの likes/reactions/bookmarks/follows/tag_filters/oshi/saved_searches/notifications/profiles を追加
-- ============================================================

-- ============================================================
-- 1) DELETE RLS ポリシー (自分のレコードだけ削除可能)
-- ============================================================

-- profiles: 自分の profile を削除
drop policy if exists "profiles delete own" on public.profiles;
create policy "profiles delete own" on public.profiles
  for delete using (auth.uid() = id);

-- likes
drop policy if exists "likes delete own" on public.likes;
create policy "likes delete own" on public.likes
  for delete using (auth.uid() = user_id);

-- reactions
drop policy if exists "reactions delete own" on public.reactions;
create policy "reactions delete own" on public.reactions
  for delete using (auth.uid() = user_id);

-- bookmarks
drop policy if exists "bookmarks delete own" on public.bookmarks;
create policy "bookmarks delete own" on public.bookmarks
  for delete using (auth.uid() = user_id);

-- follows
drop policy if exists "follows delete own" on public.follows;
create policy "follows delete own" on public.follows
  for delete using (auth.uid() = follower_id);

-- tag_filters
drop policy if exists "tag_filters delete own" on public.tag_filters;
create policy "tag_filters delete own" on public.tag_filters
  for delete using (auth.uid() = user_id);

-- oshi
drop policy if exists "oshi delete own" on public.oshi;
create policy "oshi delete own" on public.oshi
  for delete using (auth.uid() = user_id);

-- saved_searches
drop policy if exists "saved_searches delete own" on public.saved_searches;
create policy "saved_searches delete own" on public.saved_searches
  for delete using (auth.uid() = user_id);

-- notifications
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 2) RPC: delete_account()
-- ============================================================
-- security definer で本人レコードをまとめて削除する
-- 呼び出し元 auth.uid() がそのまま「削除対象」になる (なりすまし不可)
-- auth.users の削除は Supabase admin task に委ねる
--   (公式ガイド: https://supabase.com/docs/guides/auth/managing-user-data#deleting-users)
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'unauthenticated';
  end if;

  -- 関連テーブルを順番に削除
  -- FK ON DELETE CASCADE が貼られているテーブルは自動で消えるが、念のため明示
  delete from public.likes where user_id = uid;
  delete from public.reactions where user_id = uid;
  delete from public.bookmarks where user_id = uid;
  delete from public.follows where follower_id = uid or followed_id = uid;
  delete from public.tag_filters where user_id = uid;
  delete from public.oshi where user_id = uid;
  delete from public.saved_searches where user_id = uid;
  delete from public.notifications where user_id = uid;
  delete from public.comments where author_id = uid;
  delete from public.bbs_replies where author_id = uid;
  delete from public.posts where author_id = uid;
  delete from public.bbs_threads where author_id = uid;
  -- profile は最後 (FK 制約上)
  delete from public.profiles where id = uid;
  -- auth.users はここでは削除しない (Supabase 側で 30 日後 GC or 手動削除)
end;
$$;

revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;

-- ============================================================
-- 3) 監査用: deletion_log (任意)
-- ============================================================
-- 法令対応上「いつ削除依頼があったか」記録する場合に
create table if not exists public.deletion_log (
  id bigserial primary key,
  user_id_hash text not null,  -- 元 UUID を sha256 した hash のみ保存 (再特定不可)
  deleted_at timestamptz not null default now()
);
alter table public.deletion_log enable row level security;
-- 一般ユーザーは見えない (admin RPC でのみ)
revoke all on public.deletion_log from public;
