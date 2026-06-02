-- ============================================================
-- 0108: コミュニティ通報キュー (community-level reports queue)
-- ============================================================
-- 目的:
--   コミュニティの mod (owner / admin) が、自分のコミュニティに attach
--   されている投稿への通報 (public.reports) を一覧で確認し、
--   「対応済み」にできるようにする。
--
-- 設計上の制約:
--   - public.reports には INSERT policy (rp_insert) しか無く、SELECT policy が
--     存在しない。よって mod でも reports を直接 SELECT できない。
--     → 集計取得は SECURITY DEFINER RPC (get_community_reports) でのみ行う。
--   - posts は community_id 列を持たない (post_communities 中間テーブル 0023)。
--     reports.post_id -> post_communities.community_id で対象コミュニティを判定。
--   - is_community_mod(uuid) helper は 0068 で定義済 (owner / admin 判定)。
--   - 「対応済み」状態は community_resolved_reports に (community_id, post_id) で
--     保持。get_community_reports はここに存在する post を EXCLUDE する。
--
-- 全 statement は idempotent:
--   create table if not exists / drop policy if exists -> create /
--   create or replace function。RLS-safe。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) community_resolved_reports: 「対応済み」マーク
-- ============================================================
-- (community_id, post_id) で 1 投稿の通報を「このコミュニティでは対応済み」と
-- 記録する。resolved_by は対応した mod。idempotent upsert で何度押しても安全。
create table if not exists public.community_resolved_reports (
  community_id uuid not null references public.communities(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz not null default now(),
  primary key (community_id, post_id)
);

create index if not exists community_resolved_reports_community_idx
  on public.community_resolved_reports (community_id, resolved_at desc);

alter table public.community_resolved_reports enable row level security;

-- mod だけが「対応済み」一覧を SELECT 可
drop policy if exists "crr_mod_read" on public.community_resolved_reports;
create policy "crr_mod_read" on public.community_resolved_reports
  for select using (
    public.is_community_mod(community_id)
  );

-- mod だけが「対応済み」を INSERT 可 (resolved_by は本人)
drop policy if exists "crr_mod_insert" on public.community_resolved_reports;
create policy "crr_mod_insert" on public.community_resolved_reports
  for insert with check (
    public.is_community_mod(community_id)
    and resolved_by = auth.uid()
  );

-- ============================================================
-- 2) get_community_reports: コミュニティ単位の通報集計 (mod 限定)
-- ============================================================
-- reports -> post_communities を community_id で join し、投稿ごとに集計:
--   post_id, report_count, reasons (text[]), latest_reported_at,
--   content_preview (left(content,140)), author_id
-- community_resolved_reports に存在する post は EXCLUDE。
-- reports に SELECT policy が無いため SECURITY DEFINER で実行する。
-- 入口で is_community_mod を確認し、非 mod は 42501 で弾く。
create or replace function public.get_community_reports(p_community_id uuid)
returns table (
  post_id uuid,
  report_count bigint,
  reasons text[],
  latest_reported_at timestamptz,
  content_preview text,
  author_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_community_mod(p_community_id) then
    raise exception 'mod only' using errcode = '42501';
  end if;

  return query
  select
    r.post_id,
    count(*)::bigint as report_count,
    array_agg(distinct r.reason) as reasons,
    max(r.created_at) as latest_reported_at,
    left(p.content, 140) as content_preview,
    p.author_id
  from public.reports r
  join public.post_communities pc
    on pc.post_id = r.post_id
   and pc.community_id = p_community_id
  join public.posts p
    on p.id = r.post_id
  where r.post_id is not null
    and not exists (
      select 1 from public.community_resolved_reports crr
      where crr.community_id = p_community_id
        and crr.post_id = r.post_id
    )
  group by r.post_id, p.content, p.author_id
  order by max(r.created_at) desc;
end;
$$;

comment on function public.get_community_reports(uuid) is
  'コミュニティ単位の未対応通報を集計して返す (mod 限定 / SECURITY DEFINER)。reports に SELECT policy が無いためここでのみ読む。';

-- ============================================================
-- 3) resolve_community_report: 通報を「対応済み」にする (mod 限定 / idempotent)
-- ============================================================
create or replace function public.resolve_community_report(
  p_community_id uuid,
  p_post_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_community_mod(p_community_id) then
    raise exception 'mod only' using errcode = '42501';
  end if;

  insert into public.community_resolved_reports (community_id, post_id, resolved_by)
  values (p_community_id, p_post_id, auth.uid())
  on conflict (community_id, post_id) do update
    set resolved_by = excluded.resolved_by,
        resolved_at = now();
end;
$$;

comment on function public.resolve_community_report(uuid, uuid) is
  '指定投稿の通報をこのコミュニティで対応済みにする (mod 限定 / idempotent upsert)。';

-- ============================================================
-- 4) GRANT
-- ============================================================
grant execute on function public.get_community_reports(uuid) to authenticated;
grant execute on function public.resolve_community_report(uuid, uuid) to authenticated;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0108_community_reports_queue 完了: community_resolved_reports + 2 RPC' as result;
