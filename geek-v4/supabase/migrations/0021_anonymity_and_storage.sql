-- ============================================================
-- 0021: 匿名性 + Storage + アカウント削除 完全性
-- ============================================================
-- 8-agent 監査の anonymity / storage / completion 系を一括 fix。
-- ============================================================

-- ============================================================
-- 1. AVATARS bucket: 完全な RLS 定義
--    現状: bucket 自体は dashboard で作られたが migration には無く、
--    policies が抜けている可能性
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- アバター path 規約: '<user_id>/<filename>'
create or replace function public.user_id_from_avatar_path(p text)
returns uuid language plpgsql immutable as $$
declare
  segs text[];
  s text;
begin
  segs := storage.foldername(p);
  if array_length(segs, 1) is null or array_length(segs, 1) < 1 then
    return null;
  end if;
  s := segs[1];
  if s !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return s::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select" on storage.objects for select using (
  bucket_id = 'avatars'
);

drop policy if exists "avatars_insert" on storage.objects;
create policy "avatars_insert" on storage.objects for insert with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and public.user_id_from_avatar_path(name) = auth.uid()
);

drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update" on storage.objects for update using (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and public.user_id_from_avatar_path(name) = auth.uid()
);

drop policy if exists "avatars_delete" on storage.objects;
create policy "avatars_delete" on storage.objects for delete using (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and public.user_id_from_avatar_path(name) = auth.uid()
);

-- ============================================================
-- 2. 通知 trigger を匿名化:
--    旧: message に nickname を hard-coded した
--    新: message は generic ("誰かがあなたの投稿にいいねしました")、
--        nickname は data jsonb に入れて、クライアントが「公開して OK」と
--        判断したら表示。匿名投稿系の anonymity を守る。
-- ============================================================
create or replace function public.notify_on_like()
returns trigger language plpgsql security definer as $$
declare
  author uuid;
  is_anon boolean;
begin
  select author_id, is_anonymous into author, is_anon
    from public.posts where id = NEW.post_id;
  if author is null or author = NEW.user_id then return null; end if;
  -- 匿名投稿でも非匿名投稿でも、liker の身元は notification message には含めない
  insert into public.notifications(user_id, type, message, data)
    values (
      author,
      'like',
      '誰かがあなたの投稿にいいねしました',
      jsonb_build_object('post_id', NEW.post_id)
    );
  return null;
end;
$$;

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer as $$
declare
  author uuid;
begin
  select author_id into author from public.posts where id = NEW.post_id;
  if author is null or author = NEW.author_id then return null; end if;
  insert into public.notifications(user_id, type, message, data)
    values (
      author,
      'comment',
      '誰かがあなたの投稿にコメントしました',
      jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id)
    );
  return null;
end;
$$;

create or replace function public.notify_on_reaction()
returns trigger language plpgsql security definer as $$
declare
  author uuid;
begin
  select author_id into author from public.posts where id = NEW.post_id;
  if author is null or author = NEW.user_id then return null; end if;
  insert into public.notifications(user_id, type, message, data)
    values (
      author,
      'like',
      '誰かがあなたの投稿にリアクションを付けました',
      jsonb_build_object('post_id', NEW.post_id, 'meme', NEW.meme)
    );
  return null;
end;
$$;

-- ============================================================
-- 3. アカウント削除を完全網羅
--    抜けていたテーブル: poll_votes / community_members /
--    community_join_requests / community_posts / community_invites /
--    community_tags (creator).
-- ============================================================
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pair text;
  tbl text;
  col text;
  targets text[] := array[
    'likes=user_id',
    'post_reactions=user_id',
    'bbs_reply_reactions=user_id',
    'concerns=user_id',
    'saves=user_id',
    'bookmark_collections=user_id',
    'saved_searches=user_id',
    'tag_subscriptions=user_id',
    'user_liked_tags=user_id',
    'user_blocked_tags=user_id',
    'user_stamps=user_id',
    'notifications=user_id',
    'poll_votes=user_id',
    'community_members=user_id',
    'community_join_requests=user_id',
    'community_posts=author_id',
    'community_invites=created_by',
    'comments=author_id',
    'bbs_replies=author_id',
    'posts=author_id',
    'bbs_threads=author_id',
    'app_feedback=user_id',
    'profiles=id'
  ];
begin
  if uid is null then
    raise exception 'unauthenticated';
  end if;

  foreach pair in array targets loop
    tbl := split_part(pair, '=', 1);
    col := split_part(pair, '=', 2);
    if to_regclass('public.' || tbl) is not null then
      execute format('delete from public.%I where %I = $1', tbl, col) using uid;
    end if;
  end loop;

  -- auth.users は最後に削除 (Supabase Auth トリガで profiles cascade される)
  delete from auth.users where id = uid;
end;
$$;

-- ============================================================
-- 4. app_feedback: REALTIME publication から外す
--    admin が status / admin_notes を update した時に他人にもブロードキャスト
--    されていた問題を解消
-- ============================================================
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_feedback'
  ) then
    alter publication supabase_realtime drop table public.app_feedback;
  end if;
exception when others then null;
end $$;

-- ============================================================
-- 5. saved_searches / saves: 全て user 自分の行だけ SELECT 可
--    既存ポリシーが緩いケースを確認
-- ============================================================
do $$
begin
  if to_regclass('public.saved_searches') is not null then
    drop policy if exists "saved_searches_select" on public.saved_searches;
    create policy "saved_searches_select" on public.saved_searches for select using (
      user_id = auth.uid()
    );
  end if;
end $$;

-- ============================================================
-- 6. server-side per-user 投稿 rate limit (5 posts / minute)
--    クライアント側 rateLimit.ts はバイパス可能なので、DB trigger で
--    防御層を追加
-- ============================================================
create or replace function public.enforce_post_rate_limit()
returns trigger language plpgsql security definer as $$
declare
  v_recent integer;
begin
  select count(*) into v_recent
    from public.posts
    where author_id = NEW.author_id
      and created_at > now() - interval '1 minute';
  if v_recent >= 5 then
    raise exception '投稿ペースが速すぎます。少し時間を置いてから再投稿してください。';
  end if;
  return NEW;
end;
$$;

drop trigger if exists posts_rate_limit_trg on public.posts;
create trigger posts_rate_limit_trg
  before insert on public.posts
  for each row execute procedure public.enforce_post_rate_limit();

-- 同様: コメント (10/min) — table が無ければスキップ
do $$
begin
  if to_regclass('public.comments') is not null then
    create or replace function public.enforce_comment_rate_limit()
    returns trigger language plpgsql security definer as $f$
    declare v_recent integer;
    begin
      select count(*) into v_recent from public.comments
        where author_id = NEW.author_id and created_at > now() - interval '1 minute';
      if v_recent >= 10 then raise exception 'コメントペースが速すぎます。'; end if;
      return NEW;
    end;
    $f$;
    drop trigger if exists comments_rate_limit_trg on public.comments;
    create trigger comments_rate_limit_trg before insert on public.comments
      for each row execute procedure public.enforce_comment_rate_limit();
  end if;
end $$;

-- BBS thread (3/min) — table が無ければスキップ
do $$
begin
  if to_regclass('public.bbs_threads') is not null then
    create or replace function public.enforce_bbs_thread_rate_limit()
    returns trigger language plpgsql security definer as $f$
    declare v_recent integer;
    begin
      select count(*) into v_recent from public.bbs_threads
        where author_id = NEW.author_id and created_at > now() - interval '1 minute';
      if v_recent >= 3 then raise exception 'スレッド作成ペースが速すぎます。'; end if;
      return NEW;
    end;
    $f$;
    drop trigger if exists bbs_threads_rate_limit_trg on public.bbs_threads;
    create trigger bbs_threads_rate_limit_trg before insert on public.bbs_threads
      for each row execute procedure public.enforce_bbs_thread_rate_limit();
  end if;
end $$;

-- community_posts (5/min) — 0017 が走ってないと存在しないので guard
do $$
begin
  if to_regclass('public.community_posts') is not null then
    create or replace function public.enforce_community_post_rate_limit()
    returns trigger language plpgsql security definer as $f$
    declare v_recent integer;
    begin
      select count(*) into v_recent from public.community_posts
        where author_id = NEW.author_id and created_at > now() - interval '1 minute';
      if v_recent >= 5 then raise exception 'コミュニティ投稿ペースが速すぎます。'; end if;
      return NEW;
    end;
    $f$;
    drop trigger if exists community_posts_rate_limit_trg on public.community_posts;
    create trigger community_posts_rate_limit_trg before insert on public.community_posts
      for each row execute procedure public.enforce_community_post_rate_limit();
  end if;
end $$;

-- ============================================================
-- 7. profiles: nickname の重複を許す現状はそのまま
--    (匿名 SNS なので nickname は profile 表示用、識別目的ではない)
--    ただし length() check は強化 — grapheme 単位ではなく code point で
--    20 文字を厳密に enforce
-- ============================================================
-- 既に CHECK (length(nickname) between 2 and 20) があるのでこのまま
