-- ============================================================
-- POST REACTIONS (ミームスタンプ・共有リアクション)
-- ============================================================
create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  meme text not null check (length(meme) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, meme)
);

create index if not exists post_reactions_post_idx on public.post_reactions(post_id);
create index if not exists post_reactions_user_idx on public.post_reactions(user_id);

alter table public.post_reactions enable row level security;

drop policy if exists "post_reactions_read"   on public.post_reactions;
drop policy if exists "post_reactions_insert" on public.post_reactions;
drop policy if exists "post_reactions_delete" on public.post_reactions;

create policy "post_reactions_read"   on public.post_reactions for select using (true);
create policy "post_reactions_insert" on public.post_reactions for insert with check (auth.uid() = user_id);
create policy "post_reactions_delete" on public.post_reactions for delete using (auth.uid() = user_id);

-- ============================================================
-- 通知トリガー: いいね・コメントが付いたとき投稿主に通知
-- ============================================================
create or replace function public.notify_on_like()
returns trigger language plpgsql security definer as $$
declare
  author uuid;
  liker_nick text;
begin
  select author_id into author from public.posts where id = NEW.post_id;
  if author is null or author = NEW.user_id then return null; end if;
  select nickname into liker_nick from public.profiles where id = NEW.user_id;
  insert into public.notifications(user_id, type, message, data)
    values (author, 'like', coalesce(liker_nick, '誰か') || ' があなたの投稿にいいねしました', jsonb_build_object('post_id', NEW.post_id));
  return null;
end;
$$;

drop trigger if exists likes_notify_trigger on public.likes;
create trigger likes_notify_trigger
  after insert on public.likes
  for each row execute procedure public.notify_on_like();

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer as $$
declare
  author uuid;
  commenter_nick text;
begin
  select author_id into author from public.posts where id = NEW.post_id;
  if author is null or author = NEW.author_id then return null; end if;
  select nickname into commenter_nick from public.profiles where id = NEW.author_id;
  insert into public.notifications(user_id, type, message, data)
    values (author, 'comment', coalesce(commenter_nick, '誰か') || ' があなたの投稿にコメントしました', jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id));
  return null;
end;
$$;

drop trigger if exists comments_notify_trigger on public.comments;
create trigger comments_notify_trigger
  after insert on public.comments
  for each row execute procedure public.notify_on_comment();

create or replace function public.notify_on_reaction()
returns trigger language plpgsql security definer as $$
declare
  author uuid;
  user_nick text;
begin
  select author_id into author from public.posts where id = NEW.post_id;
  if author is null or author = NEW.user_id then return null; end if;
  select nickname into user_nick from public.profiles where id = NEW.user_id;
  insert into public.notifications(user_id, type, message, data)
    values (author, 'like', coalesce(user_nick, '誰か') || ' があなたの投稿にリアクション「' || NEW.meme || '」を付けました', jsonb_build_object('post_id', NEW.post_id, 'meme', NEW.meme));
  return null;
end;
$$;

drop trigger if exists reactions_notify_trigger on public.post_reactions;
create trigger reactions_notify_trigger
  after insert on public.post_reactions
  for each row execute procedure public.notify_on_reaction();

-- ============================================================
-- REALTIME PUBLICATION (これがないとクライアントが変更を受信できない)
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- すでに publication に入っている可能性があるので alter は try/catch 相当に
do $$
declare
  t text;
begin
  for t in select unnest(array['post_reactions','bbs_replies','comments','posts','notifications','likes']) loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      -- すでに publication に追加済み → 無視
      null;
    end;
  end loop;
end $$;
