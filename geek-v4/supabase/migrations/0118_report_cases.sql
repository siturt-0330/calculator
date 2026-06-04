-- ============================================================
-- 0118_report_cases.sql
-- ============================================================
-- 通報(reports)を「対象(投稿)単位のケース」に集約し、運営のモデレーション
-- ワークフロー(優先度 / 担当 / ステータス / 解決)を載せる。
-- さらに監査ログ(moderation_log)を append-only(INSERT専用)に強化する。
--
-- 設計根拠: docs/ADMIN_CONSOLE.md
--   §5.1 通報ケース / §5.4 監査ログ完全化 / §6.2 優先度集約 / §6.3 append-only監査
--
-- 既存 reports(0001) は温存。reports INSERT トリガで report_cases を upsert する。
-- get_report_queue() RPC で admin が優先度順にキューを取得する
--   (reports は 0020 で admin SELECT 可だが、集約 + ワークフロー状態は RPC で提供)。
--
-- 冪等: create table if not exists / create or replace / drop policy if exists。
-- 関数は top-level 定義 (SQL editor の nested do-block 誤分割対策。0113/0114 と同方針)。
-- 全て本番 SQL editor で手動適用する前提 (Netlify は migration を流さない)。
--   未適用でもクライアントは既存 reports 直読 / concern 集計ビューに fallback できる。
-- ============================================================

-- ------------------------------------------------------------
-- 0) severity 導出ヘルパ (外部調査 §6.2 の severity 階層)
-- ------------------------------------------------------------
-- 通報理由 → 深刻度カテゴリ。reason は client(useReport)では
--   spam / harassment / inappropriate / misinfo / other 等の text。
create or replace function public.report_reason_severity(p_reason text)
returns text language sql immutable as $fn$
  select case lower(coalesce(p_reason, ''))
    when 'csam'          then 'critical'
    when 'violence'      then 'critical'
    when 'harassment'    then 'high'
    when 'inappropriate' then 'high'
    when 'scam'          then 'high'
    when 'misinfo'       then 'medium'
    when 'spam'          then 'medium'
    else 'low'
  end;
$fn$;

-- severity → 数値 weight (大きいほど優先)。
create or replace function public.report_severity_weight(p_sev text)
returns int language sql immutable as $fn$
  select case p_sev
    when 'critical' then 1000
    when 'high'     then 100
    when 'medium'   then 10
    else 1
  end;
$fn$;

-- ------------------------------------------------------------
-- 1) report_cases — 対象(投稿)単位の通報ケース
-- ------------------------------------------------------------
create table if not exists public.report_cases (
  id                uuid primary key default gen_random_uuid(),
  target_type       text not null default 'post' check (target_type in ('post','user','comment')),
  target_id         uuid not null,
  status            text not null default 'open' check (status in ('open','triaged','in_review','resolved','rejected')),
  severity          text not null default 'low'  check (severity in ('critical','high','medium','low')),
  report_count      int  not null default 0,
  reasons           text[] not null default '{}',
  assignee_id       uuid references auth.users(id) on delete set null,
  first_reported_at timestamptz not null default now(),
  last_reported_at  timestamptz not null default now(),
  resolved_by       uuid references auth.users(id) on delete set null,
  resolved_at       timestamptz,
  resolution        text check (resolution in ('content_removed','user_actioned','no_action','duplicate')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 未解決(open/triaged/in_review)は 1 対象につき 1 ケースに束ねる(重複対応の排除)。
-- resolved/rejected は履歴として複数残ってよい。
create unique index if not exists report_cases_open_target_uniq
  on public.report_cases (target_type, target_id)
  where status not in ('resolved','rejected');

create index if not exists report_cases_queue_idx
  on public.report_cases (status, severity, last_reported_at desc);
create index if not exists report_cases_assignee_idx
  on public.report_cases (assignee_id) where assignee_id is not null;

alter table public.report_cases enable row level security;

-- admin のみ全アクセス。moderator への開放は RBAC 導入 migration (0120 予定) で
-- is_moderator() に拡張する。当面は admin gate + RPC 経由。
drop policy if exists "report_cases_admin_all" on public.report_cases;
create policy "report_cases_admin_all" on public.report_cases for all
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 2) reports INSERT トリガ → report_cases を upsert (集約)
-- ------------------------------------------------------------
create or replace function public.bump_report_case()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_sev text;
begin
  v_sev := public.report_reason_severity(new.reason::text);
  -- 未解決の既存ケースがあれば加算
  update public.report_cases
     set report_count = report_count + 1,
         reasons = (
           select array_agg(distinct x)
           from unnest(reasons || array[coalesce(new.reason::text, 'other')]) x
         ),
         last_reported_at = now(),
         -- より深刻な severity が来たら引き上げる(下げはしない)
         severity = case
                      when public.report_severity_weight(v_sev) > public.report_severity_weight(severity)
                      then v_sev else severity
                    end,
         updated_at = now()
   where target_type = 'post'
     and target_id = new.post_id
     and status not in ('resolved','rejected');

  if not found then
    insert into public.report_cases
      (target_type, target_id, status, severity, report_count, reasons, first_reported_at, last_reported_at)
    values
      ('post', new.post_id, 'open', v_sev, 1, array[coalesce(new.reason::text, 'other')], now(), now());
  end if;

  return new;
end;
$fn$;

drop trigger if exists reports_bump_case_trg on public.reports;
create trigger reports_bump_case_trg
  after insert on public.reports
  for each row execute procedure public.bump_report_case();

-- ------------------------------------------------------------
-- 3) get_report_queue() — admin が優先度順にキューを取得
-- ------------------------------------------------------------
-- priority = severity_weight + report_count*5 + recency_bonus(直近ほど高)。
-- critical は severity_weight=1000 で常に最上位に来る(ハードルール相当)。
create or replace function public.get_report_queue(
  p_status text default 'open',
  p_limit  int  default 50
)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_limit  int;
  v_result json;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  select coalesce(json_agg(t order by t.prio desc, t.last_reported_at desc), '[]'::json)
    into v_result
  from (
    select
      rc.id,
      rc.target_type,
      rc.target_id,
      rc.status,
      rc.severity,
      rc.report_count,
      rc.reasons,
      rc.assignee_id,
      rc.first_reported_at,
      rc.last_reported_at,
      rc.resolved_at,
      rc.resolution,
      (
        public.report_severity_weight(rc.severity)
        + rc.report_count * 5
        + greatest(0, 100 - (extract(epoch from (now() - rc.last_reported_at)) / 3600))::int
      ) as prio,
      (
        select json_build_object(
          'id', p.id,
          'content', left(coalesce(p.content, ''), 280),
          'author_id', p.author_id,           -- admin gate 済なので実値を返す
          'visibility', p.visibility,
          'created_at', p.created_at,
          'likes_count', p.likes_count,
          'concern_count', p.concern_count
        )
        from public.posts p
        where p.id = rc.target_id
      ) as post
    from public.report_cases rc
    where (p_status = 'all' or rc.status = p_status)
    order by prio desc, rc.last_reported_at desc
    limit v_limit
  ) t;

  return coalesce(v_result, '[]'::json);
end;
$fn$;

-- ------------------------------------------------------------
-- 4) assign_report_case() — 担当アサイン (省略時は自分)
-- ------------------------------------------------------------
create or replace function public.assign_report_case(
  p_case_id  uuid,
  p_assignee uuid default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_target uuid;
  v_who    uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  v_who := coalesce(p_assignee, auth.uid());

  update public.report_cases
     set assignee_id = v_who,
         status = case when status = 'open' then 'triaged' else status end,
         updated_at = now()
   where id = p_case_id
   returning target_id into v_target;

  if v_target is null then
    raise exception 'report_case not found: %', p_case_id;
  end if;

  insert into public.moderation_log (admin_id, action, target_type, target_id, reason, metadata)
  values (
    auth.uid(), 'note', 'post', v_target, 'report case assigned',
    jsonb_build_object('case_id', p_case_id, 'assignee', v_who)
  );
end;
$fn$;

-- ------------------------------------------------------------
-- 5) resolve_report_case() — ケースを解決/却下し監査ログに記録
-- ------------------------------------------------------------
create or replace function public.resolve_report_case(
  p_case_id    uuid,
  p_resolution text,
  p_reason     text default ''
)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_target uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  if p_resolution not in ('content_removed','user_actioned','no_action','duplicate') then
    raise exception 'invalid resolution: %', p_resolution;
  end if;
  -- no_action / duplicate は rejected、それ以外は resolved 扱い
  v_status := case when p_resolution in ('no_action','duplicate') then 'rejected' else 'resolved' end;

  update public.report_cases
     set status = v_status,
         resolution = p_resolution,
         resolved_by = auth.uid(),
         resolved_at = now(),
         updated_at = now()
   where id = p_case_id
   returning target_id into v_target;

  if v_target is null then
    raise exception 'report_case not found: %', p_case_id;
  end if;

  insert into public.moderation_log (admin_id, action, target_type, target_id, reason, metadata)
  values (
    auth.uid(), 'note', 'post', v_target, coalesce(nullif(p_reason, ''), 'report case resolved'),
    jsonb_build_object('case_id', p_case_id, 'resolution', p_resolution, 'status', v_status)
  );
end;
$fn$;

-- ------------------------------------------------------------
-- 6) moderation_log を append-only に強化 (外部調査 §6.3)
-- ------------------------------------------------------------
-- 旧: for all (admin が UPDATE/DELETE できてしまう) → SELECT + INSERT に分離。
-- UPDATE/DELETE policy を作らない = 全ロールで拒否 = 改ざん不可。
drop policy if exists "moderation_log_admin_all"    on public.moderation_log;
drop policy if exists "moderation_log_admin_select" on public.moderation_log;
drop policy if exists "moderation_log_admin_insert" on public.moderation_log;
create policy "moderation_log_admin_select" on public.moderation_log for select
  using (public.is_admin());
create policy "moderation_log_admin_insert" on public.moderation_log for insert
  with check (public.is_admin() and admin_id = auth.uid());

-- ------------------------------------------------------------
-- 7) 既存 reports を report_cases へ backfill (一度だけ・冪等)
-- ------------------------------------------------------------
-- 未解決ケースが未だ無い対象だけを集約 insert。再実行しても where not exists で重複しない。
insert into public.report_cases
  (target_type, target_id, status, severity, report_count, reasons, first_reported_at, last_reported_at)
select
  'post',
  r.post_id,
  'open',
  (array_agg(
     public.report_reason_severity(r.reason::text)
     order by public.report_severity_weight(public.report_reason_severity(r.reason::text)) desc
   ))[1],
  count(*),
  array_agg(distinct coalesce(r.reason::text, 'other')),
  min(r.created_at),
  max(r.created_at)
from public.reports r
where r.post_id is not null
  and not exists (
    select 1 from public.report_cases rc
    where rc.target_type = 'post' and rc.target_id = r.post_id
      and rc.status not in ('resolved','rejected')
  )
group by r.post_id;

-- ------------------------------------------------------------
-- 8) grants
-- ------------------------------------------------------------
grant execute on function public.report_reason_severity(text) to authenticated;
grant execute on function public.report_severity_weight(text) to authenticated;
grant execute on function public.get_report_queue(text, int) to authenticated;
grant execute on function public.assign_report_case(uuid, uuid) to authenticated;
grant execute on function public.resolve_report_case(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 完了マーカー
-- ------------------------------------------------------------
select '0118_report_cases 完了: report_cases + 集約トリガ + get_report_queue/assign/resolve RPC + moderation_log append-only化 + backfill' as result;
