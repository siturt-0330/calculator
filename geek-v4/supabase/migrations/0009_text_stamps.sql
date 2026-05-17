-- ============================================================
-- 0009: テキストスタンプの拡張
--  1. BBS返信へのリアクション (bbs_reply_reactions)
--  2. ユーザー作成スタンプ (user_stamps)
--  3. 24時間集計通知トリガー (既存 notify_on_reaction を上書き)
-- ============================================================

-- ============================================================
-- 1. BBS_REPLY_REACTIONS
--    掲示板の返信に対するテキストスタンプ
-- ============================================================
create table if not exists public.bbs_reply_reactions (
  reply_id uuid not null references public.bbs_replies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  meme text not null check (length(meme) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (reply_id, user_id, meme)
);

create index if not exists bbs_reply_reactions_reply_idx on public.bbs_reply_reactions(reply_id);
create index if not exists bbs_reply_reactions_user_idx  on public.bbs_reply_reactions(user_id);

alter table public.bbs_reply_reactions enable row level security;

drop policy if exists "brr_read"   on public.bbs_reply_reactions;
drop policy if exists "brr_insert" on public.bbs_reply_reactions;
drop policy if exists "brr_delete" on public.bbs_reply_reactions;
create policy "brr_read"   on public.bbs_reply_reactions for select using (true);
create policy "brr_insert" on public.bbs_reply_reactions for insert with check (auth.uid() = user_id);
create policy "brr_delete" on public.bbs_reply_reactions for delete using (auth.uid() = user_id);

-- ============================================================
-- 2. USER_STAMPS
--    ユーザーが作った独自のテキストスタンプ
--    is_public=true なら全体で共有、false なら自分専用
-- ============================================================
create table if not exists public.user_stamps (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (length(text) between 1 and 40),
  category text not null default 'カスタム',
  use_count integer not null default 0,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  unique (creator_id, text)
);

create index if not exists user_stamps_public_idx on public.user_stamps(is_public, use_count desc);
create index if not exists user_stamps_creator_idx on public.user_stamps(creator_id);

alter table public.user_stamps enable row level security;

drop policy if exists "us_read"   on public.user_stamps;
drop policy if exists "us_insert" on public.user_stamps;
drop policy if exists "us_update" on public.user_stamps;
drop policy if exists "us_delete" on public.user_stamps;
create policy "us_read"   on public.user_stamps for select using (is_public or auth.uid() = creator_id);
create policy "us_insert" on public.user_stamps for insert with check (auth.uid() = creator_id);
create policy "us_update" on public.user_stamps for update using (auth.uid() = creator_id);
create policy "us_delete" on public.user_stamps for delete using (auth.uid() = creator_id);

-- ============================================================
-- 3. 24時間集計通知 (post_reactions)
-- ============================================================
create or replace function public.notify_on_reaction()
returns trigger language plpgsql security definer as $$
declare
  author uuid;
  existing_id uuid;
  new_count int;
begin
  select author_id into author from public.posts where id = NEW.post_id;
  if author is null or author = NEW.user_id then return null; end if;

  -- 24時間以内に同じ post + meme の通知があれば集計
  select id into existing_id
  from public.notifications
  where user_id = author
    and type = 'like'
    and (data->>'post_id') = NEW.post_id::text
    and (data->>'meme') = NEW.meme
    and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;

  if existing_id is not null then
    select coalesce((data->>'count')::int, 1) + 1 into new_count
    from public.notifications where id = existing_id;
    update public.notifications set
      data       = jsonb_set(data, '{count}', to_jsonb(new_count)),
      message    = new_count || '人が「' || NEW.meme || '」と反応しました',
      read       = false,
      created_at = now()
    where id = existing_id;
  else
    insert into public.notifications(user_id, type, message, data)
    values (
      author, 'like',
      '誰かが「' || NEW.meme || '」と反応しました',
      jsonb_build_object('post_id', NEW.post_id, 'meme', NEW.meme, 'count', 1)
    );
  end if;
  -- use_count もしカスタムスタンプなら +1
  update public.user_stamps set use_count = use_count + 1 where text = NEW.meme;
  return null;
end;
$$;

drop trigger if exists reactions_notify_trigger on public.post_reactions;
create trigger reactions_notify_trigger
  after insert on public.post_reactions
  for each row execute procedure public.notify_on_reaction();

-- ============================================================
-- 4. 同じく BBS_REPLY 用
-- ============================================================
create or replace function public.notify_on_bbs_reply_reaction()
returns trigger language plpgsql security definer as $$
declare
  reply_author uuid;
  thread_id uuid;
  thread_title text;
  existing_id uuid;
  new_count int;
begin
  select author_id, thread_id into reply_author, thread_id
    from public.bbs_replies where id = NEW.reply_id;
  if reply_author is null or reply_author = NEW.user_id then return null; end if;
  select title into thread_title from public.bbs_threads where id = thread_id;

  select id into existing_id
  from public.notifications
  where user_id = reply_author
    and type = 'like'
    and (data->>'reply_id') = NEW.reply_id::text
    and (data->>'meme') = NEW.meme
    and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;

  if existing_id is not null then
    select coalesce((data->>'count')::int, 1) + 1 into new_count
    from public.notifications where id = existing_id;
    update public.notifications set
      data       = jsonb_set(data, '{count}', to_jsonb(new_count)),
      message    = new_count || '人が「' || NEW.meme || '」と反応しました (掲示板)',
      read       = false,
      created_at = now()
    where id = existing_id;
  else
    insert into public.notifications(user_id, type, message, data)
    values (
      reply_author, 'like',
      '誰かが「' || NEW.meme || '」と反応しました (' || coalesce(thread_title, '掲示板') || ')',
      jsonb_build_object('reply_id', NEW.reply_id, 'thread_id', thread_id, 'meme', NEW.meme, 'count', 1)
    );
  end if;
  update public.user_stamps set use_count = use_count + 1 where text = NEW.meme;
  return null;
end;
$$;

drop trigger if exists bbs_reply_reactions_notify_trigger on public.bbs_reply_reactions;
create trigger bbs_reply_reactions_notify_trigger
  after insert on public.bbs_reply_reactions
  for each row execute procedure public.notify_on_bbs_reply_reaction();

-- ============================================================
-- 5. Realtime publication 追加
-- ============================================================
do $$
declare t text;
begin
  for t in select unnest(array['bbs_reply_reactions','user_stamps']) loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
