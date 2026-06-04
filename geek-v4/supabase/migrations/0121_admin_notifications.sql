-- ============================================================
-- 0121_admin_notifications.sql
-- ============================================================
-- 運営者向けリアルタイム通知の土台 (指示書 4.4 の中核「通報が入ったらすぐわかる」)。
--   admin_notifications テーブル + supabase_realtime publication 登録 +
--   report_cases INSERT トリガで通知を自動投入する。
--
-- 設計根拠: docs/ADMIN_CONSOLE.md §5.8
--
-- ★ 判断: notifications(一般ユーザー向け, user_id単一参照, 本人RLS, user:${id}channel)
--   とは別テーブルにする。admin 通知は「全 admin/moderator が見る」「admin限定RLS」で
--   要件が根本的に異なるため。複数 admin の個別既読は read_by(jsonb 配列)で表現。
--
-- 依存: 0118(report_cases) / 0120(is_admin/can_view_admin)。番号順適用前提。
-- 冪等・top-level定義・SQL editor手動適用前提・未適用でも client は polling に degrade。
-- ============================================================

-- ------------------------------------------------------------
-- 1) admin_notifications テーブル
-- ------------------------------------------------------------
create table if not exists public.admin_notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                 -- 'report_case' | 'report_spike' | 'system' 等
  title       text not null,
  body        text,
  target_type text,                           -- 'post' | 'user' | 'comment' | 'report_case'
  target_id   uuid,
  severity    text not null default 'medium' check (severity in ('critical','high','medium','low')),
  -- 複数 admin の個別既読: 既読にした admin の uuid(text) を配列で保持
  read_by     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_notifications_created_idx
  on public.admin_notifications (created_at desc);
create index if not exists admin_notifications_kind_idx
  on public.admin_notifications (kind, created_at desc);

alter table public.admin_notifications enable row level security;

-- viewer 以上(can_view_admin)が閲覧可。トリガ(SECURITY DEFINER)は RLS を越えて insert する。
drop policy if exists "admin_notif_select" on public.admin_notifications;
create policy "admin_notif_select" on public.admin_notifications for select
  using (public.can_view_admin());

-- 手動 insert は admin のみ(通常はトリガ経由)。
drop policy if exists "admin_notif_insert" on public.admin_notifications;
create policy "admin_notif_insert" on public.admin_notifications for insert
  with check (public.is_admin());

-- ------------------------------------------------------------
-- 2) 既読化 RPC (自分の uuid を read_by に追加)
-- ------------------------------------------------------------
create or replace function public.mark_admin_notification_read(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not public.can_view_admin() then
    raise exception 'forbidden: admin view only' using errcode = '42501';
  end if;
  update public.admin_notifications
     set read_by = case
                     when read_by @> jsonb_build_array(auth.uid()::text) then read_by
                     else read_by || jsonb_build_array(auth.uid()::text)
                   end
   where id = p_id;
end;
$fn$;

-- ------------------------------------------------------------
-- 3) report_cases INSERT → admin_notifications を投入するトリガ
-- ------------------------------------------------------------
-- 新しい通報ケースが立つたびに運営へ通知。severity=critical は強調タイトル。
-- ※ severity 引き上げ(UPDATE)時の再通知は過剰通知になりやすいので、まず INSERT のみ。
create or replace function public.notify_admins_on_report_case()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  insert into public.admin_notifications (kind, title, body, target_type, target_id, severity)
  values (
    'report_case',
    case when new.severity = 'critical' then '🚨 重大な通報が届きました' else '新しい通報が届きました' end,
    'severity=' || new.severity || ' / ' || coalesce(new.report_count, 1)::text || '件',
    'report_case',
    new.id,
    new.severity
  );
  return new;
end;
$fn$;

drop trigger if exists report_cases_notify_admins_trg on public.report_cases;
create trigger report_cases_notify_admins_trg
  after insert on public.report_cases
  for each row execute procedure public.notify_admins_on_report_case();

-- ------------------------------------------------------------
-- 4) supabase_realtime publication 登録 (admin-feed channel 用)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.admin_notifications') is not null then
    begin
      execute 'alter publication supabase_realtime add table public.admin_notifications';
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5) grants
-- ------------------------------------------------------------
grant execute on function public.mark_admin_notification_read(uuid) to authenticated;

-- ------------------------------------------------------------
-- 完了マーカー
-- ------------------------------------------------------------
select '0121_admin_notifications 完了: admin_notifications + 既読RPC + report_cases通知トリガ + realtime publication登録' as result;
