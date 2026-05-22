-- ============================================================
-- 0036_security_critical_fixes.sql
-- ============================================================
-- セキュリティ監査で発見された Critical/High 脆弱性をまとめて修正。
--
-- 設計方針:
--   - 各セクションは to_regclass() で対象テーブルの存在を確認してから実行する
--     (complete_schema.sql ベースや一部 migration 未適用の環境でも壊れない)
--   - すべて冪等 (drop ... if exists / create or replace) で繰り返し実行可能
--
-- 修正項目:
--   1. profiles の特権列 (is_admin / trust_score / account_state / counts) を
--      本人 UPDATE で改ざんできないよう guard trigger を追加
--   2. admin 用 view (admin_pending_official_apps_v / admin_reported_posts_v /
--      admin_problem_users_v) を security_invoker + is_admin() で保護
--   3. post_link_previews の cache poisoning 対策
--   4. community_members_insert ポリシーの OR 優先順位ミス修正
--   5. community_join_requests に status='pending' 制約追加
--   6. tags_insert に trust_score >= 20 を要求
--   7. concerns / reports の rate limit + mass-report 抑制
--   8. ad_events の user_id null 許可を廃止
--   9. community_qna_documents / events / map_locations の SELECT 制限
--  10. SECURITY DEFINER 関数の search_path 固定漏れを ALTER で補正
--  11. official_community_applications.applicant_url を HTTPS 必須に
-- ============================================================

-- ============================================================
-- 1. profiles 特権列の改ざん防止 (profiles は必ず存在する前提)
-- ============================================================
do $$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'skip section 1: public.profiles not found';
    return;
  end if;

  create or replace function public.guard_profile_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_is_admin boolean := false;
  begin
    -- is_admin() が定義されていれば admin 判定
    begin
      v_is_admin := coalesce(public.is_admin(), false);
    exception when undefined_function then
      v_is_admin := false;
    end;

    if v_is_admin then
      return new;
    end if;

    if new.is_admin is distinct from old.is_admin then
      raise exception 'guard: is_admin can only be changed by admin' using errcode = '42501';
    end if;
    if new.trust_score is distinct from old.trust_score then
      raise exception 'guard: trust_score is maintained by the system' using errcode = '42501';
    end if;
    if new.account_state is distinct from old.account_state then
      raise exception 'guard: account_state is maintained by the system' using errcode = '42501';
    end if;
    if new.post_count is distinct from old.post_count then
      raise exception 'guard: post_count is maintained by triggers' using errcode = '42501';
    end if;
    if new.comment_count is distinct from old.comment_count then
      raise exception 'guard: comment_count is maintained by triggers' using errcode = '42501';
    end if;
    if new.like_received_count is distinct from old.like_received_count then
      raise exception 'guard: like_received_count is maintained by triggers' using errcode = '42501';
    end if;
    if new.concern_received_count is distinct from old.concern_received_count then
      raise exception 'guard: concern_received_count is maintained by triggers' using errcode = '42501';
    end if;
    if new.plan is distinct from old.plan then
      raise exception 'guard: plan changes via billing flow only' using errcode = '42501';
    end if;

    return new;
  end;
  $fn$;

  drop trigger if exists guard_profile_update_trg on public.profiles;
  create trigger guard_profile_update_trg
    before update on public.profiles
    for each row execute procedure public.guard_profile_update();
end $$;

-- ============================================================
-- 2. admin view の保護 (security_invoker + is_admin チェック)
-- ============================================================

-- 2-1. admin_pending_official_apps_v
do $$
begin
  if to_regclass('public.official_community_applications') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip 2-1: official_community_applications / communities not found';
    return;
  end if;

  drop view if exists public.admin_pending_official_apps_v;
  execute $sql$
    create view public.admin_pending_official_apps_v
    with (security_invoker = on, security_barrier = on)
    as
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
      app.verification_token,
      app.verification_status,
      app.verification_method,
      app.verification_attempted_at,
      app.created_at
    from public.official_community_applications app
    join public.communities c on c.id = app.community_id
    where app.status = 'pending'
      and public.is_admin()
    order by app.created_at asc
  $sql$;

  revoke all on public.admin_pending_official_apps_v from public;
  grant select on public.admin_pending_official_apps_v to authenticated;
end $$;

-- 2-2. admin_reported_posts_v
do $$
begin
  if to_regclass('public.posts') is null or to_regclass('public.concerns') is null then
    raise notice 'skip 2-2: posts / concerns not found';
    return;
  end if;

  drop view if exists public.admin_reported_posts_v;
  execute $sql$
    create view public.admin_reported_posts_v
    with (security_invoker = on, security_barrier = on)
    as
    select
      p.id as post_id,
      p.author_id,
      p.content,
      p.visibility,
      p.created_at as post_created_at,
      p.likes_count,
      p.concern_count,
      count(c.user_id) as reports_count,
      max(c.created_at) as last_reported_at
    from public.posts p
    join public.concerns c on c.post_id = p.id
    where public.is_admin()
    group by p.id
  $sql$;

  revoke all on public.admin_reported_posts_v from public;
  grant select on public.admin_reported_posts_v to authenticated;
end $$;

-- 2-3. admin_problem_users_v
do $$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'skip 2-3: profiles not found';
    return;
  end if;

  drop view if exists public.admin_problem_users_v;
  execute $sql$
    create view public.admin_problem_users_v
    with (security_invoker = on, security_barrier = on)
    as
    select
      pr.id,
      pr.nickname,
      pr.account_state,
      pr.trust_score,
      pr.post_count,
      pr.concern_received_count,
      pr.created_at,
      count(distinct c.post_id) as flagged_posts_count
    from public.profiles pr
    left join public.posts p on p.author_id = pr.id
    left join public.concerns c on c.post_id = p.id
    where public.is_admin()
      and (pr.concern_received_count > 0
           or pr.account_state in ('caution', 'restricted', 'warned', 'suspended'))
    group by pr.id
  $sql$;

  revoke all on public.admin_problem_users_v from public;
  grant select on public.admin_problem_users_v to authenticated;
end $$;

-- ============================================================
-- 3. post_link_previews の cache poisoning 対策
-- ============================================================
do $$
begin
  if to_regclass('public.post_link_previews') is null then
    raise notice 'skip section 3: post_link_previews not found';
    return;
  end if;

  -- (a) inserter_id 列を追加
  execute 'alter table public.post_link_previews
             add column if not exists inserter_id uuid references auth.users(id) on delete set null';

  -- (b) サイズ CHECK 制約 (重複追加は exception で skip)
  begin
    execute 'alter table public.post_link_previews
               add constraint plp_title_len check (title is null or length(title) <= 300)';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter table public.post_link_previews
               add constraint plp_desc_len check (description is null or length(description) <= 800)';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter table public.post_link_previews
               add constraint plp_image_url_len check (image_url is null or length(image_url) <= 800)';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter table public.post_link_previews
               add constraint plp_site_name_len check (site_name is null or length(site_name) <= 100)';
  exception when duplicate_object then null;
  end;

  -- (c) INSERT ポリシー: 信頼ユーザのみ + 既存上書き禁止
  execute 'drop policy if exists "plp_insert" on public.post_link_previews';
  execute $sql$
    create policy "plp_insert" on public.post_link_previews for insert
      with check (
        auth.uid() is not null
        and exists (
          select 1 from public.profiles
           where id = auth.uid()
             and coalesce(trust_score, 0) >= 20
        )
        and inserter_id = auth.uid()
        and not exists (
          select 1 from public.post_link_previews existing
           where existing.url = post_link_previews.url
        )
      )
  $sql$;

  -- (d) UPDATE は作成者のみ
  execute 'drop policy if exists "plp_update" on public.post_link_previews';
  execute $sql$
    create policy "plp_update" on public.post_link_previews for update
      using (inserter_id = auth.uid())
      with check (inserter_id = auth.uid())
  $sql$;

  -- (e) rate limit trigger
  create or replace function public.enforce_plp_rate_limit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_count int;
  begin
    if new.inserter_id is null then
      return new;
    end if;
    select count(*) into v_count
      from public.post_link_previews
     where inserter_id = new.inserter_id
       and fetched_at > now() - interval '1 hour';
    if v_count >= 60 then
      raise exception 'rate-limit: link previews 60/hour' using errcode = '53300';
    end if;
    return new;
  end;
  $fn$;

  execute 'drop trigger if exists plp_rate_limit_trg on public.post_link_previews';
  execute 'create trigger plp_rate_limit_trg
             before insert on public.post_link_previews
             for each row execute procedure public.enforce_plp_rate_limit()';
end $$;

-- ============================================================
-- 4. community_members_insert ポリシーの OR 優先順位修正
-- ============================================================
do $$
begin
  if to_regclass('public.community_members') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip section 4: community_members / communities not found';
    return;
  end if;

  execute 'drop policy if exists "community_members_insert" on public.community_members';
  execute 'drop policy if exists "community_members_insert_self_open" on public.community_members';
  execute 'drop policy if exists "community_members_insert_by_owner" on public.community_members';

  execute $sql$
    create policy "community_members_insert_self_open" on public.community_members
      for insert with check (
        user_id = auth.uid()
        and community_id in (
          select id from public.communities where visibility = 'open'
        )
      )
  $sql$;

  execute $sql$
    create policy "community_members_insert_by_owner" on public.community_members
      for insert with check (
        public.is_community_owner(community_id)
      )
  $sql$;
end $$;

-- ============================================================
-- 5. community_join_requests に status='pending' 制約追加
-- ============================================================
do $$
begin
  if to_regclass('public.community_join_requests') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip section 5: community_join_requests / communities not found';
    return;
  end if;

  execute 'drop policy if exists "community_join_requests_insert" on public.community_join_requests';
  execute $sql$
    create policy "community_join_requests_insert" on public.community_join_requests for insert
      with check (
        user_id = auth.uid()
        and status = 'pending'
        and community_id in (
          select id from public.communities where visibility = 'request'
        )
      )
  $sql$;
end $$;

-- ============================================================
-- 6. tags_insert に trust_score >= 20 を要求
-- ============================================================
do $$
begin
  if to_regclass('public.tags') is null or to_regclass('public.profiles') is null then
    raise notice 'skip section 6: tags / profiles not found';
    return;
  end if;

  execute 'drop policy if exists "tags_insert" on public.tags';
  execute $sql$
    create policy "tags_insert" on public.tags for insert
      with check (
        auth.uid() is not null
        and exists (
          select 1 from public.profiles
           where id = auth.uid()
             and coalesce(trust_score, 0) >= 20
        )
      )
  $sql$;

  execute 'drop policy if exists "tags_update_admin_only" on public.tags';
  execute $sql$
    create policy "tags_update_admin_only" on public.tags for update
      using (public.is_admin()) with check (public.is_admin())
  $sql$;
end $$;

-- ============================================================
-- 7. concerns の rate limit + mass-report 抑制
-- ============================================================
do $$
begin
  if to_regclass('public.concerns') is null or to_regclass('public.profiles') is null then
    raise notice 'skip section 7: concerns / profiles not found';
    return;
  end if;

  create or replace function public.enforce_concerns_rate_limit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_recent int;
    v_user_age interval;
    v_trust int;
  begin
    select count(*) into v_recent
      from public.concerns
     where user_id = new.user_id
       and created_at > now() - interval '1 hour';
    if v_recent >= 30 then
      raise exception 'rate-limit: concerns 30/hour' using errcode = '53300';
    end if;

    select now() - created_at, trust_score
      into v_user_age, v_trust
      from public.profiles
     where id = new.user_id;
    if v_user_age < interval '24 hours' then
      raise exception 'concerns: account too new (must be 24h+ old)' using errcode = '53300';
    end if;
    if coalesce(v_trust, 0) < 10 then
      raise exception 'concerns: trust_score too low' using errcode = '42501';
    end if;

    return new;
  end;
  $fn$;

  execute 'drop trigger if exists concerns_rate_limit_trg on public.concerns';
  execute 'create trigger concerns_rate_limit_trg
             before insert on public.concerns
             for each row execute procedure public.enforce_concerns_rate_limit()';
end $$;

-- ============================================================
-- 7-2. reports にユニーク制約と rate limit を追加
-- ============================================================
do $$
begin
  if to_regclass('public.reports') is null then
    raise notice 'skip section 7-2: reports not found';
    return;
  end if;

  begin
    execute 'alter table public.reports
               add constraint reports_unique_per_reporter unique (reporter_id, post_id)';
  exception
    when duplicate_object then null;
    when duplicate_table then null;
    when invalid_table_definition then null;
    when unique_violation then null;
  end;

  create or replace function public.enforce_reports_rate_limit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_recent int;
  begin
    select count(*) into v_recent
      from public.reports
     where reporter_id = new.reporter_id
       and created_at > now() - interval '1 hour';
    if v_recent >= 20 then
      raise exception 'rate-limit: reports 20/hour' using errcode = '53300';
    end if;
    return new;
  end;
  $fn$;

  execute 'drop trigger if exists reports_rate_limit_trg on public.reports';
  execute 'create trigger reports_rate_limit_trg
             before insert on public.reports
             for each row execute procedure public.enforce_reports_rate_limit()';
end $$;

-- ============================================================
-- 8. ad_events の user_id null 許可を廃止
-- ============================================================
do $$
begin
  if to_regclass('public.ad_events') is null then
    raise notice 'skip section 8: ad_events not found';
    return;
  end if;

  execute 'drop policy if exists "ad_events_insert_own" on public.ad_events';
  execute $sql$
    create policy "ad_events_insert_own" on public.ad_events for insert
      with check (user_id = auth.uid())
  $sql$;
end $$;

-- ============================================================
-- 9. community_qna_documents / events / map_locations の可視性制限
-- ============================================================

-- 9-1. community_qna_documents
do $$
begin
  if to_regclass('public.community_qna_documents') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip 9-1: community_qna_documents / communities not found';
    return;
  end if;

  execute 'drop policy if exists "qna_docs_select_anyone" on public.community_qna_documents';
  execute 'drop policy if exists "qna_docs_select_open_or_member" on public.community_qna_documents';
  execute $sql$
    create policy "qna_docs_select_open_or_member" on public.community_qna_documents
      for select using (
        exists (
          select 1 from public.communities c
           where c.id = community_id
             and (c.is_official = true or c.visibility = 'open')
        )
        or public.is_community_member(community_id)
      )
  $sql$;
end $$;

-- 9-2. community_calendar_events
do $$
begin
  if to_regclass('public.community_calendar_events') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip 9-2: community_calendar_events / communities not found';
    return;
  end if;

  execute 'drop policy if exists "calendar_select_anyone" on public.community_calendar_events';
  execute 'drop policy if exists "calendar_select_open_or_member" on public.community_calendar_events';
  execute $sql$
    create policy "calendar_select_open_or_member" on public.community_calendar_events
      for select using (
        exists (
          select 1 from public.communities c
           where c.id = community_id
             and (c.is_official = true or c.visibility = 'open')
        )
        or public.is_community_member(community_id)
      )
  $sql$;
end $$;

-- 9-3. community_map_locations
do $$
begin
  if to_regclass('public.community_map_locations') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip 9-3: community_map_locations / communities not found';
    return;
  end if;

  execute 'drop policy if exists "map_select_anyone" on public.community_map_locations';
  execute 'drop policy if exists "map_select_open_or_member" on public.community_map_locations';
  execute $sql$
    create policy "map_select_open_or_member" on public.community_map_locations
      for select using (
        exists (
          select 1 from public.communities c
           where c.id = community_id
             and (c.is_official = true or c.visibility = 'open')
        )
        or public.is_community_member(community_id)
      )
  $sql$;
end $$;

-- ============================================================
-- 10. SECURITY DEFINER 関数の search_path 固定漏れ補正
-- ============================================================
-- 動的にすべての public schema の security definer 関数を一括補正
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name,
           p.proname as func_name,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef = true
       and (p.proconfig is null
            or not exists (
              select 1 from unnest(p.proconfig) cfg
               where cfg like 'search_path=%'
            ))
  loop
    begin
      execute format(
        'alter function %I.%I(%s) set search_path = public, pg_temp',
        r.schema_name, r.func_name, r.args
      );
    exception when others then
      raise notice 'skip alter on %.%(%): %', r.schema_name, r.func_name, r.args, sqlerrm;
    end;
  end loop;
end $$;

-- ============================================================
-- 11. official_community_applications.applicant_url を HTTPS 必須に
-- ============================================================
do $$
begin
  if to_regclass('public.official_community_applications') is null then
    raise notice 'skip section 11: official_community_applications not found';
    return;
  end if;

  begin
    execute 'alter table public.official_community_applications
               drop constraint if exists official_community_applications_applicant_url_check';
  exception when others then null;
  end;

  begin
    execute 'alter table public.official_community_applications
               add constraint official_apps_url_https
               check (applicant_url is null or applicant_url ~ ''^https://'')';
  exception
    when duplicate_object then null;
    when others then raise notice 'skip add https constraint: %', sqlerrm;
  end;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0036_security_critical_fixes 完了: 各セクションは to_regclass で安全に skip' as result;
