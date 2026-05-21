-- ============================================================
-- 0032: 公式コミュニティ機能
-- ============================================================
-- コンセプト:
--   - 一般コミュニティはこれまで通り「匿名 SNS の中の小さな部屋」
--   - 公式コミュニティは「公式認証された組織/個人が運営する場」
--     ・公式バッジが付く
--     ・公式登録の申請には開発者 (admin) の承認が必要
--     ・承認された場合、そのコミュニティの「管理者」だけは匿名解除
--       (一般メンバーは引き続き匿名)
--     ・公式コミュニティ専用機能:
--         - Q&A コーナー (NotebookLM 風 — 管理者が登録したドキュメントだけから回答)
--         - カレンダー (イベント告知)
--         - 地図 (聖地巡礼 / 観光地マッピング — 地域活性化)
-- ============================================================

-- ============================================================
-- communities テーブル拡張
-- ============================================================
alter table public.communities
  add column if not exists is_official boolean not null default false,
  add column if not exists official_admin_user_id uuid references auth.users(id) on delete set null,
  add column if not exists official_admin_display_name text,    -- 匿名解除された実名
  add column if not exists official_organization text,           -- 所属組織 (例: "○○市役所", "TVアニメ○○製作委員会")
  add column if not exists official_approved_at timestamptz,
  add column if not exists official_features text[] not null default '{}';
  -- official_features: 'qna' | 'calendar' | 'map' を含む。post は全コミュニティで使えるのでここには載せない

create index if not exists communities_is_official_idx
  on public.communities(is_official) where is_official = true;

comment on column public.communities.is_official is
  '公式コミュニティかどうか。true の場合、official_admin_user_id が匿名解除される';
comment on column public.communities.official_features is
  '有効化された機能: qna / calendar / map のサブセット';

-- ============================================================
-- official_community_applications
-- 公式登録申請
-- ============================================================
create table if not exists public.official_community_applications (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  applicant_real_name text not null check (length(applicant_real_name) between 1 and 80),
  applicant_organization text not null check (length(applicant_organization) between 1 and 120),
  applicant_email text check (applicant_email is null or applicant_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  applicant_url text check (applicant_url is null or applicant_url ~ '^https?://'),  -- 公式 web サイトの URL (本人確認のため)
  purpose text not null check (length(purpose) between 10 and 2000),  -- 申請理由
  requested_features text[] not null default '{}'::text[],            -- 申請する機能 (qna/calendar/map)
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  reviewer_notes text default '',
  created_at timestamptz not null default now(),
  -- 1 コミュニティにつき pending の申請は 1 件まで (履歴は残す)
  -- → partial unique index で実装 (下記)
  -- 同一コミュニティで approved 履歴があっても再申請は許可 (機能変更など)
  unique (community_id, applicant_user_id, created_at)
);

create unique index if not exists official_applications_one_pending_per_community
  on public.official_community_applications(community_id)
  where status = 'pending';

create index if not exists official_applications_applicant_idx
  on public.official_community_applications(applicant_user_id, created_at desc);
create index if not exists official_applications_status_idx
  on public.official_community_applications(status, created_at desc);

alter table public.official_community_applications enable row level security;

-- 申請者は自分の申請を見られる
drop policy if exists "applicant_select_own" on public.official_community_applications;
create policy "applicant_select_own"
  on public.official_community_applications for select
  using (applicant_user_id = auth.uid());

-- admin は全件見られる
drop policy if exists "admin_select_all" on public.official_community_applications;
create policy "admin_select_all"
  on public.official_community_applications for select
  using (public.is_admin());

-- コミュニティ owner だけが申請を作れる
drop policy if exists "owner_insert" on public.official_community_applications;
create policy "owner_insert"
  on public.official_community_applications for insert
  with check (
    applicant_user_id = auth.uid()
    and exists (
      select 1 from public.community_members m
      where m.community_id = official_community_applications.community_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

-- admin だけが update できる (承認 / 却下)
drop policy if exists "admin_update" on public.official_community_applications;
create policy "admin_update"
  on public.official_community_applications for update
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- 申請 RPC
-- ============================================================
create or replace function public.apply_for_official_community(
  p_community_id uuid,
  p_real_name text,
  p_organization text,
  p_email text,
  p_url text,
  p_purpose text,
  p_requested_features text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_application_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- owner チェック
  if not exists (
    select 1 from public.community_members
    where community_id = p_community_id
      and user_id = v_user_id
      and role = 'owner'
  ) then
    raise exception 'NOT_COMMUNITY_OWNER';
  end if;

  -- 既に official なら新規申請を拒否
  if exists (
    select 1 from public.communities
    where id = p_community_id and is_official = true
  ) then
    raise exception 'ALREADY_OFFICIAL';
  end if;

  -- pending 中の申請があれば重複拒否
  if exists (
    select 1 from public.official_community_applications
    where community_id = p_community_id and status = 'pending'
  ) then
    raise exception 'PENDING_APPLICATION_EXISTS';
  end if;

  insert into public.official_community_applications (
    community_id, applicant_user_id,
    applicant_real_name, applicant_organization, applicant_email, applicant_url,
    purpose, requested_features
  ) values (
    p_community_id, v_user_id,
    p_real_name, p_organization, p_email, p_url,
    p_purpose, coalesce(p_requested_features, '{}'::text[])
  )
  returning id into v_application_id;

  return v_application_id;
end;
$$;

grant execute on function public.apply_for_official_community(uuid, text, text, text, text, text, text[]) to authenticated;

-- ============================================================
-- 承認 RPC (admin 専用)
-- ============================================================
create or replace function public.approve_official_community_application(
  p_application_id uuid,
  p_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app record;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  select * into v_app
    from public.official_community_applications
   where id = p_application_id and status = 'pending'
   for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;

  -- communities を公式化
  update public.communities set
    is_official = true,
    official_admin_user_id = v_app.applicant_user_id,
    official_admin_display_name = v_app.applicant_real_name,
    official_organization = v_app.applicant_organization,
    official_approved_at = now(),
    official_features = v_app.requested_features
  where id = v_app.community_id;

  update public.official_community_applications set
    status = 'approved',
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    reviewer_notes = coalesce(p_notes, '')
  where id = p_application_id;
end;
$$;

grant execute on function public.approve_official_community_application(uuid, text) to authenticated;

-- ============================================================
-- 却下 RPC (admin 専用)
-- ============================================================
create or replace function public.reject_official_community_application(
  p_application_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.official_community_applications set
    status = 'rejected',
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    reviewer_notes = p_reason
  where id = p_application_id and status = 'pending';

  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
end;
$$;

grant execute on function public.reject_official_community_application(uuid, text) to authenticated;

-- ============================================================
-- community_qna_documents
-- 公式コミュニティの管理者が登録するナレッジ (NotebookLM の source 相当)
-- Q&A はこのドキュメント群からのみ回答する
-- ============================================================
create table if not exists public.community_qna_documents (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  content text not null check (length(content) between 1 and 50000),
  -- chunk 化 + embedding は edge function で後段処理。
  -- ここではナレッジ raw を保持し、search_tsv で keyword 検索を併用。
  search_tsv tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'B')
  ) stored,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qna_docs_community_idx on public.community_qna_documents(community_id, created_at desc);
create index if not exists qna_docs_search_idx on public.community_qna_documents using gin(search_tsv);

alter table public.community_qna_documents enable row level security;

-- 誰でも読める (Q&A の root として参照されるため)。但しコミュニティが official じゃない場合は無意味。
drop policy if exists "qna_docs_select_anyone" on public.community_qna_documents;
create policy "qna_docs_select_anyone" on public.community_qna_documents for select using (true);

-- official_admin_user_id のみ書ける
drop policy if exists "qna_docs_admin_write" on public.community_qna_documents;
create policy "qna_docs_admin_write" on public.community_qna_documents for all
  using (
    exists (
      select 1 from public.communities c
      where c.id = community_qna_documents.community_id
        and c.is_official = true
        and c.official_admin_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.communities c
      where c.id = community_qna_documents.community_id
        and c.is_official = true
        and c.official_admin_user_id = auth.uid()
    )
  );

-- ============================================================
-- community_qna_questions
-- 一般ユーザーの質問 + AI 回答ログ
-- ============================================================
create table if not exists public.community_qna_questions (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  question text not null check (length(question) between 3 and 500),
  answer text,
  source_doc_ids uuid[] default '{}'::uuid[],   -- 回答の根拠になったドキュメント
  asked_by uuid not null references auth.users(id) on delete set null,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'answered', 'no_source', 'error'))
);

create index if not exists qna_questions_community_idx
  on public.community_qna_questions(community_id, asked_at desc);

alter table public.community_qna_questions enable row level security;

drop policy if exists "qna_q_select_member" on public.community_qna_questions;
create policy "qna_q_select_member" on public.community_qna_questions for select using (
  exists (select 1 from public.community_members where community_id = community_qna_questions.community_id and user_id = auth.uid())
);

drop policy if exists "qna_q_insert_member" on public.community_qna_questions;
create policy "qna_q_insert_member" on public.community_qna_questions for insert
  with check (
    asked_by = auth.uid()
    and exists (
      select 1 from public.community_members m
      join public.communities c on c.id = m.community_id
      where m.community_id = community_qna_questions.community_id
        and m.user_id = auth.uid()
        and c.is_official = true
        and 'qna' = any(c.official_features)
    )
  );

-- ============================================================
-- community_calendar_events
-- ============================================================
create table if not exists public.community_calendar_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  description text default '' check (length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text default '',
  url text check (url is null or url ~ '^https?://'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists cal_events_community_idx
  on public.community_calendar_events(community_id, starts_at);

alter table public.community_calendar_events enable row level security;
drop policy if exists "cal_select_anyone" on public.community_calendar_events;
create policy "cal_select_anyone" on public.community_calendar_events for select using (true);

drop policy if exists "cal_admin_write" on public.community_calendar_events;
create policy "cal_admin_write" on public.community_calendar_events for all
  using (
    exists (select 1 from public.communities c
            where c.id = community_calendar_events.community_id
              and c.is_official = true
              and c.official_admin_user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.communities c
            where c.id = community_calendar_events.community_id
              and c.is_official = true
              and c.official_admin_user_id = auth.uid())
  );

-- ============================================================
-- community_map_locations
-- 聖地巡礼 / 観光地 / 撮影スポット
-- ============================================================
create table if not exists public.community_map_locations (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text default '' check (length(description) <= 2000),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  address text default '',
  image_url text check (image_url is null or image_url ~ '^https?://'),
  category text default 'spot' check (category in ('spot', 'shop', 'food', 'lodging', 'event', 'other')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists map_loc_community_idx
  on public.community_map_locations(community_id);

alter table public.community_map_locations enable row level security;
drop policy if exists "map_select_anyone" on public.community_map_locations;
create policy "map_select_anyone" on public.community_map_locations for select using (true);

drop policy if exists "map_admin_write" on public.community_map_locations;
create policy "map_admin_write" on public.community_map_locations for all
  using (
    exists (select 1 from public.communities c
            where c.id = community_map_locations.community_id
              and c.is_official = true
              and c.official_admin_user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.communities c
            where c.id = community_map_locations.community_id
              and c.is_official = true
              and c.official_admin_user_id = auth.uid())
  );

-- ============================================================
-- admin が pending 申請を見るための view
-- ============================================================
create or replace view public.admin_pending_official_apps_v as
select
  app.id,
  app.community_id,
  c.name as community_name,
  c.icon_emoji,
  c.icon_color,
  c.member_count,
  c.post_count,
  app.applicant_user_id,
  app.applicant_real_name,
  app.applicant_organization,
  app.applicant_email,
  app.applicant_url,
  app.purpose,
  app.requested_features,
  app.created_at
from public.official_community_applications app
join public.communities c on c.id = app.community_id
where app.status = 'pending'
order by app.created_at asc;

grant select on public.admin_pending_official_apps_v to authenticated;

-- ============================================================
-- ナレッジから answer を検索する RPC
-- (LLM は edge function で呼ぶ前提。ここでは tsvector + ILIKE で
--  ランクの高いドキュメントを返すだけ。)
-- ============================================================
create or replace function public.qna_search_documents(
  p_community_id uuid,
  p_query text,
  p_limit int default 5
)
returns table (
  id uuid,
  title text,
  content text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id, d.title, d.content,
    ts_rank(d.search_tsv, plainto_tsquery('simple', p_query)) as rank
  from public.community_qna_documents d
  where d.community_id = p_community_id
    and (
      d.search_tsv @@ plainto_tsquery('simple', p_query)
      or d.title ilike '%' || p_query || '%'
      or d.content ilike '%' || p_query || '%'
    )
  order by rank desc, d.created_at desc
  limit p_limit;
$$;

grant execute on function public.qna_search_documents(uuid, text, int) to authenticated;
