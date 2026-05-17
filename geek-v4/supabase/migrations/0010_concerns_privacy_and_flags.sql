-- ============================================================
-- 0010: concerns プライバシーモード + feature_flags + post_link_preview
-- ============================================================

-- ============================================================
-- 1. CONCERNS: is_private カラム追加
--    is_private = true なら、本人のフィルタ用としてだけ機能し
--    投稿の concern_count や 投稿者の concern_received_count に影響しない
-- ============================================================
alter table public.concerns add column if not exists is_private boolean not null default true;

-- concern_count を更新するトリガーを、is_private=false の concern だけカウントするように更新
create or replace function public.update_concern_count()
returns trigger language plpgsql as $$
declare
  pid uuid;
  aid uuid;
begin
  if TG_OP = 'INSERT' then
    pid := NEW.post_id;
  else
    pid := OLD.post_id;
  end if;
  update public.posts
    set concern_count = (
      select count(*) from public.concerns where post_id = pid and not is_private
    )
    where id = pid;
  select author_id into aid from public.posts where id = pid;
  if aid is not null then
    update public.profiles set concern_received_count = (
      select count(*) from public.concerns c
      join public.posts p on c.post_id = p.id
      where p.author_id = aid and not c.is_private
    ) where id = aid;
    perform public.refresh_account_state(aid);
  end if;
  return null;
end;
$$;

-- is_private 切り替えの UPDATE もトリガーで反映
drop trigger if exists concern_update_trg on public.concerns;
create trigger concern_update_trg
  after update of is_private on public.concerns
  for each row execute procedure public.update_concern_count();

-- 既存データの全体再計算 (is_private=false のものだけ)
update public.posts p set concern_count = (
  select count(*) from public.concerns c where c.post_id = p.id and not c.is_private
);

-- ============================================================
-- 2. FEATURE FLAGS
--    シンプルなロールアウト管理: name + enabled + percentage (0..100)
--    クライアントは user_id ハッシュで自分が枠内か判定する
-- ============================================================
create table if not exists public.feature_flags (
  name text primary key,
  description text,
  enabled boolean not null default false,
  percentage integer not null default 100 check (percentage between 0 and 100),
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
drop policy if exists "ff_read" on public.feature_flags;
create policy "ff_read" on public.feature_flags for select using (true);

-- 初期フラグをいくつか定義しておく
insert into public.feature_flags (name, description, enabled, percentage) values
  ('og_preview',         '投稿の出典URLをカード化する',         true,  100),
  ('markdown_render',    '投稿本文の軽量Markdownレンダリング',  true,  100),
  ('quick_reaction',     '投稿カード長押しで素早くリアクション', true,  100),
  ('concerns_privacy',   '気になるをこっそり付けるモード',      true,  100),
  ('profile_summary',    'マイページの自分の活動サマリー',      true,  100)
on conflict (name) do update set
  description = excluded.description,
  enabled = excluded.enabled,
  percentage = excluded.percentage,
  updated_at = now();

-- ============================================================
-- 3. POST LINK PREVIEW (OG キャッシュ)
--    URL のメタ情報を キャッシュ。同じ URL に複数回アクセスされても再フェッチを避ける
-- ============================================================
create table if not exists public.post_link_previews (
  url text primary key,
  title text,
  description text,
  image_url text,
  site_name text,
  fetched_at timestamptz not null default now()
);

create index if not exists post_link_previews_fetched_idx on public.post_link_previews(fetched_at);

alter table public.post_link_previews enable row level security;
drop policy if exists "plp_read" on public.post_link_previews;
drop policy if exists "plp_insert" on public.post_link_previews;
drop policy if exists "plp_update" on public.post_link_previews;
create policy "plp_read" on public.post_link_previews for select using (true);
create policy "plp_insert" on public.post_link_previews for insert with check (auth.uid() is not null);
create policy "plp_update" on public.post_link_previews for update using (auth.uid() is not null);

-- ============================================================
-- 4. Realtime publication 追加
-- ============================================================
do $$
declare t text;
begin
  for t in select unnest(array['feature_flags','post_link_previews']) loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
