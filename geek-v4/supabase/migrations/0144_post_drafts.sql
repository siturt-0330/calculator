-- ============================================================
-- 0144_post_drafts.sql — 投稿下書き保存 (サーバー側)
-- ============================================================
-- ローカル (MMKV) と並行して、サーバー側にも下書きを保存する。
-- クロスデバイスで下書きが引き継がれる。
-- content: 投稿本文 (最大 10000 文字)
-- meta: タグ・コミュニティ等のメタデータ (JSON)
-- 自動 TTL: 30日経過した下書きは削除
-- ============================================================

create table if not exists public.post_drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  content    text check (length(content) <= 10000),
  title      text check (length(title) <= 200),
  tag_names  text[] default '{}',
  media_urls text[] default '{}',
  meta       jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.post_drafts enable row level security;

create policy "drafts_self_all" on public.post_drafts
  for all using (auth.uid() = user_id);

create index if not exists idx_drafts_user_updated
  on public.post_drafts (user_id, updated_at desc);

-- upsert draft
create or replace function public.upsert_post_draft(
  p_draft_id  uuid default null,
  p_content   text default null,
  p_title     text default null,
  p_tag_names text[] default '{}',
  p_meta      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then return null; end if;
  if p_draft_id is not null then
    update public.post_drafts
    set content    = coalesce(p_content, content),
        title      = coalesce(p_title, title),
        tag_names  = coalesce(p_tag_names, tag_names),
        meta       = coalesce(p_meta, meta),
        updated_at = now()
    where id = p_draft_id and user_id = auth.uid()
    returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.post_drafts (user_id, content, title, tag_names, meta)
  values (auth.uid(), p_content, p_title, coalesce(p_tag_names,'{}'), coalesce(p_meta,'{}'))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.upsert_post_draft(uuid, text, text, text[], jsonb) to authenticated;

-- delete draft
create or replace function public.delete_post_draft(p_draft_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.post_drafts where id = p_draft_id and user_id = auth.uid();
$$;

grant execute on function public.delete_post_draft(uuid) to authenticated;

-- get my drafts
create or replace function public.get_my_drafts(p_limit int default 20)
returns table(id uuid, content text, title text, tag_names text[], meta jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select id, content, title, tag_names, meta, updated_at
  from public.post_drafts
  where user_id = auth.uid()
  order by updated_at desc
  limit least(coalesce(p_limit,20), 50);
$$;

grant execute on function public.get_my_drafts(int) to authenticated;

-- TTL cleanup (pg_cron: 毎日)
-- select cron.schedule('cleanup-drafts', '0 5 * * *',
--   $$ delete from public.post_drafts where updated_at < now() - interval '30 days' $$);

select '0144_post_drafts 完了 — 投稿下書きテーブル + upsert/delete/list RPCs' as note;
