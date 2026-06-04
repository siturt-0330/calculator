-- ============================================================
-- 0123_open_moderation_to_moderators.sql
-- ============================================================
-- RBAC Phase2: 通報対応(report_cases + キューRPC)を moderator にも開放する。
-- 設計根拠: docs/ADMIN_CONSOLE.md §5.7 (権限マトリクス)。
--
--   - report_cases の RLS を is_admin() → is_moderator() に開放。
--   - get_report_queue / assign_report_case / resolve_report_case の gate を
--     is_admin() → is_moderator() に(関数再定義。body は 0118 と同一、gate行のみ変更)。
--   is_moderator() は admin_role in ('moderator','admin') なので admin も引き続き通る。
--
-- ★ 重い権限(apply_enforcement / set_admin_role / 広告 / shadowban)は admin のまま
--   (moderator には開放しない)。moderator は「通報のトリアージ・担当・解決」まで。
--
-- 依存: 0118(report_cases/RPC) / 0120(is_moderator)。冪等・top-level・手動適用前提。
-- ============================================================

-- ------------------------------------------------------------
-- 1) report_cases RLS: admin → moderator 以上に開放
-- ------------------------------------------------------------
drop policy if exists "report_cases_admin_all" on public.report_cases;
drop policy if exists "report_cases_mod_all" on public.report_cases;
create policy "report_cases_mod_all" on public.report_cases for all
  using (public.is_moderator()) with check (public.is_moderator());

-- ------------------------------------------------------------
-- 2) get_report_queue() — gate を is_moderator() に(body は 0118 と同一)
-- ------------------------------------------------------------
create or replace function public.get_report_queue(
  p_status text default 'open',
  p_limit  int  default 50
)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_limit  int;
  v_result json;
begin
  if not public.is_moderator() then
    raise exception 'forbidden: moderator only' using errcode = '42501';
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
          'author_id', p.author_id,           -- admin/moderator gate 済なので実値を返す
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
-- 3) assign_report_case() — gate を is_moderator() に(body は 0118 と同一)
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
  if not public.is_moderator() then
    raise exception 'forbidden: moderator only' using errcode = '42501';
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
-- 4) resolve_report_case() — gate を is_moderator() に(body は 0118 と同一)
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
  if not public.is_moderator() then
    raise exception 'forbidden: moderator only' using errcode = '42501';
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
-- 完了マーカー
-- ------------------------------------------------------------
select '0123_open_moderation_to_moderators 完了: report_cases RLS + 通報3RPC を is_moderator() に開放(措置/広告/RBAC は admin のまま)' as result;
