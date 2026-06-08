-- ============================================================
-- 0136: Reddit 流モデレーション — ①処置理由の本人通知 ②コミュニティ通報キューの de-anon 硬化
-- ============================================================
-- 背景 (deep-research: Reddit のモデレーション透明性):
--   Reddit は「投稿削除 / キック / BAN」を行うと、対象本人に理由つきで通知する
--   (removal reasons)。GEEK は mod_action_logs に記録するだけで本人に届かなかった。
--   また 0108 の get_community_reports は author_id を無条件で返しており、UI を
--   繋いだ瞬間に匿名投稿の作者が mod に特定できる de-anon ホールになる。
--
-- 本 migration:
--   1) notifications.type CHECK に 'mod_action' を追加 (0101 の集合 + mod_action)。
--   2) helper notify_mod_action_target(): 対象本人へ処置通知を作る。
--      ★mod の身元 (mod_user_id) は通知に含めない (匿名性・報復防止)。
--   3) trigger notify_on_mod_action(): ban/kick/promote/demote/transfer_owner 時に対象へ通知。
--      0068/0069/0135 の RPC を編集できないため mod_action_logs の AFTER INSERT で横付けする。
--      ※対象は mod が一覧で顔(nickname)を見て選んだ既知メンバーなので target_user_id を
--        ログに持つことは de-anon ではない (従来どおり)。連打スパムは 10 秒 dedup で抑止。
--   4) コンテンツ削除 RPC mod_delete_post / _comment / _bbs_reply:
--      ★author を server 内のローカル変数で取得して通知し、author_id を mod が読める
--        mod_action_logs には残さない (匿名投稿の作者を mod に晒さない)。
--        → これが「削除は client 直 DELETE のまま log に target_user_id を足す」案を
--          採らなかった理由 (足すと mod_action_logs_mod_read 経由で de-anon 回帰)。
--   5) get_community_reports を author_id を返さない形に作り直す (de-anon ホール封鎖)。
--      0108 未適用環境でも動くよう community_resolved_reports と resolve RPC も
--      defensive に再定義する (silent degrade 対策)。
--
-- ★本番は Supabase SQL エディタで手動適用が必要 (他 migration と同様)。
-- 全 statement は idempotent。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) notifications.type CHECK に 'mod_action' を追加
--    (0101 の集合を維持したまま追加。drop → add パターンを踏襲)
-- ============================================================
do $$
begin
  if to_regclass('public.notifications') is null then
    raise notice 'skip: notifications table not found';
    return;
  end if;

  begin
    execute 'alter table public.notifications drop constraint if exists notifications_type_check';
  exception when others then null;
  end;

  begin
    execute $sql$
      alter table public.notifications
        add constraint notifications_type_check
        check (type in (
          'like',
          'comment',
          'follow',
          'reply',
          'event',
          'official_post',
          'mention',
          'announcement',
          'join_request',
          'mod_action'
        ))
    $sql$;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- 2) helper: モデレーション処置を「対象本人」へ通知
-- ============================================================
-- ★mod_user_id (誰が処置したか) は通知に一切含めない。匿名 SNS なので
--   「誰に消されたか」を晒すと報復・特定に繋がる。理由 (reason) のみ伝える。
-- security definer:
--   notifications の RLS は notifications_own (user_id = auth.uid()) なので、
--   処置を実行した mod のセッションから「対象 (別ユーザー)」の通知行を作るには
--   RLS を貫通する必要がある。
create or replace function public.notify_mod_action_target(
  p_target_user_id uuid,
  p_community_id uuid,
  p_action text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name text;
  v_suffix text;
  v_msg text;
begin
  if p_target_user_id is null then
    return;
  end if;

  select name into v_name from public.communities where id = p_community_id;
  if v_name is null then
    v_name := 'コミュニティ';
  end if;

  v_suffix := case
    when p_reason is not null and length(btrim(p_reason)) > 0
      then '（理由: ' || left(p_reason, 200) || '）'
    else ''
  end;

  v_msg := case p_action
    when 'delete_post'      then '「' || v_name || '」であなたの投稿が削除されました' || v_suffix
    when 'delete_comment'   then '「' || v_name || '」であなたのコメントが削除されました' || v_suffix
    when 'delete_bbs_reply' then '「' || v_name || '」であなたの掲示板の返信が削除されました' || v_suffix
    when 'kick'             then '「' || v_name || '」から退出処理されました' || v_suffix
    when 'ban'              then '「' || v_name || '」から参加禁止 (BAN) になりました' || v_suffix
    when 'promote'          then '「' || v_name || '」の管理人に任命されました'
    when 'demote'           then '「' || v_name || '」の管理人権限が解除されました'
    when 'transfer_owner'   then '「' || v_name || '」のオーナーに任命されました'
    else 'コミュニティ管理からのお知らせ' || v_suffix
  end;

  insert into public.notifications (user_id, type, message, data)
  values (
    p_target_user_id,
    'mod_action',
    v_msg,
    jsonb_build_object(
      'community_id', p_community_id,
      'action', p_action,
      'reason', p_reason
      -- ★mod_user_id は意図的に含めない (匿名性・報復防止)
    )
  );
exception when others then
  -- 通知作成の失敗は呼び出し元の処置を巻き戻さない (best-effort)
  null;
end;
$$;

comment on function public.notify_mod_action_target(uuid, uuid, text, text) is
  'モデレーション処置を対象本人へ通知 (mod の身元は含めない / SECURITY DEFINER)。';

-- ============================================================
-- 3) trigger: メンバー対象の処置 (ban/kick/promote/demote/transfer) 時に本人へ通知
-- ============================================================
-- mod_action_logs への AFTER INSERT で発火 (0068/0069/0135 の RPC を編集せず横付け)。
--   - 対象は「mod が一覧で選んだ既知メンバー」なので target_user_id 通知は de-anon ではない。
--   - delete_post / delete_comment / delete_bbs_reply はここでは扱わない
--     (それらは RPC 内で author を直接通知し、target_user_id をログに残さない=匿名維持)。
--   - unban は通知しない。
--   ★スパム抑止: 同一 (target, community, action) の通知が直近 10 秒にあれば skip
--     (ban→unban→ban 連打や kick 連打による通知/realtime フラッドを防ぐ)。
--     ※コンテンツ削除は別投稿ごとに正当なので dedup しない (helper を直接呼ぶ経路)。
create or replace function public.notify_on_mod_action()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.action in ('ban', 'kick', 'promote', 'demote', 'transfer_owner')
     and new.target_user_id is not null
     and new.target_user_id <> new.mod_user_id then
    if not exists (
      select 1 from public.notifications n
      where n.user_id = new.target_user_id
        and n.type = 'mod_action'
        and n.created_at > now() - interval '10 seconds'
        and (n.data ->> 'community_id') = new.community_id::text
        and (n.data ->> 'action') = new.action
    ) then
      perform public.notify_mod_action_target(
        new.target_user_id, new.community_id, new.action, new.reason
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_mod_action on public.mod_action_logs;
create trigger trg_notify_on_mod_action
  after insert on public.mod_action_logs
  for each row execute function public.notify_on_mod_action();

-- ============================================================
-- 4) コンテンツ削除 RPC (mod / admin)。author を server 内で解決して通知。
-- ============================================================
-- 認可:
--   対象が属するコミュニティのいずれかで mod (owner/admin)、または platform admin。
-- ★匿名性:
--   author_id は v_author ローカル変数でのみ扱い、mod_action_logs には書かない
--   (mod_action_logs_mod_read 経由で匿名作者が特定されるのを防ぐ)。
-- 順序:
--   author / community を確定 → 投稿削除 → log (target は残さず action/reason のみ)
--   → 本人へ通知。log を delete の後に書くのは「削除成功時のみ記録」のため。

-- 4-1) 投稿削除
create or replace function public.mod_delete_post(
  p_post_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_author uuid;
  v_comm uuid;
  v_is_admin boolean;
begin
  v_is_admin := coalesce(public.is_admin(), false);

  -- mod 権限のあるコミュニティを優先的に確定 (決定的順序で安定化)
  select pc.community_id into v_comm
  from public.post_communities pc
  where pc.post_id = p_post_id
    and public.is_community_mod(pc.community_id)
  order by pc.community_id
  limit 1;

  if v_comm is null then
    if not v_is_admin then
      raise exception 'mod only' using errcode = '42501';
    end if;
    -- admin はコミュニティ mod でなくても削除可。log/通知用に所属コミュを 1 つ拾う
    select pc.community_id into v_comm
    from public.post_communities pc
    where pc.post_id = p_post_id
    order by pc.community_id
    limit 1;
  end if;

  select author_id into v_author from public.posts where id = p_post_id;

  delete from public.posts where id = p_post_id;

  -- ★実際に削除できたときだけ log/通知 (0 行削除=既に消えている場合は何もしない)
  if found and v_comm is not null then
    insert into public.mod_action_logs (community_id, mod_user_id, action, reason)
    values (v_comm, auth.uid(), 'delete_post', p_reason);
    perform public.notify_mod_action_target(v_author, v_comm, 'delete_post', p_reason);
  end if;
end;
$$;

-- 4-2) コメント削除
create or replace function public.mod_delete_comment(
  p_comment_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_author uuid;
  v_post uuid;
  v_comm uuid;
  v_is_admin boolean;
begin
  v_is_admin := coalesce(public.is_admin(), false);

  select post_id, author_id into v_post, v_author
  from public.comments where id = p_comment_id;
  if v_post is null then
    return; -- 既に無い
  end if;

  select pc.community_id into v_comm
  from public.post_communities pc
  where pc.post_id = v_post
    and public.is_community_mod(pc.community_id)
  order by pc.community_id
  limit 1;

  if v_comm is null then
    if not v_is_admin then
      raise exception 'mod only' using errcode = '42501';
    end if;
    select pc.community_id into v_comm
    from public.post_communities pc
    where pc.post_id = v_post
    order by pc.community_id
    limit 1;
  end if;

  delete from public.comments where id = p_comment_id;

  if found and v_comm is not null then
    insert into public.mod_action_logs (community_id, mod_user_id, action, reason)
    values (v_comm, auth.uid(), 'delete_comment', p_reason);
    perform public.notify_mod_action_target(v_author, v_comm, 'delete_comment', p_reason);
  end if;
end;
$$;

-- 4-3) 掲示板 (BBS) 返信削除
create or replace function public.mod_delete_bbs_reply(
  p_reply_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_author uuid;
  v_thread uuid;
  v_comm uuid;
  v_is_admin boolean;
begin
  v_is_admin := coalesce(public.is_admin(), false);

  select thread_id, author_id into v_thread, v_author
  from public.bbs_replies where id = p_reply_id;
  if v_thread is null then
    return;
  end if;

  select community_id into v_comm from public.bbs_threads where id = v_thread;

  -- 全体スレ (community_id null) は mod 削除不可 → admin のみ。
  if v_comm is null or not public.is_community_mod(v_comm) then
    if not v_is_admin then
      raise exception 'mod only' using errcode = '42501';
    end if;
  end if;

  delete from public.bbs_replies where id = p_reply_id;

  if found and v_comm is not null then
    insert into public.mod_action_logs (community_id, mod_user_id, action, reason)
    values (v_comm, auth.uid(), 'delete_bbs_reply', p_reason);
    perform public.notify_mod_action_target(v_author, v_comm, 'delete_bbs_reply', p_reason);
  end if;
end;
$$;

-- ============================================================
-- 5) コミュニティ通報キューの de-anon 硬化 + defensive 再定義
-- ============================================================
-- 5-0) community_resolved_reports (0108)。未適用環境でも動くよう defensive に作る。
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

drop policy if exists "crr_mod_read" on public.community_resolved_reports;
create policy "crr_mod_read" on public.community_resolved_reports
  for select using (public.is_community_mod(community_id));

drop policy if exists "crr_mod_insert" on public.community_resolved_reports;
create policy "crr_mod_insert" on public.community_resolved_reports
  for insert with check (
    public.is_community_mod(community_id) and resolved_by = auth.uid()
  );

-- 5-1) get_community_reports を author_id を返さない形に作り直す。
--      ★戻り値の列構成が変わる (author_id 削除) ため drop してから再作成。
--      UI は post_id ベースで「投稿を開く / 削除 / 対応済み」する。匿名投稿の作者を
--      mod に晒さないため author_id は返さない (削除は mod_delete_post が server 内で解決)。
drop function if exists public.get_community_reports(uuid);
create function public.get_community_reports(p_community_id uuid)
returns table (
  post_id uuid,
  report_count bigint,
  reasons text[],
  latest_reported_at timestamptz,
  content_preview text
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
    left(p.content, 140) as content_preview
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
  group by r.post_id, p.content
  order by max(r.created_at) desc;
end;
$$;

comment on function public.get_community_reports(uuid) is
  'コミュニティ単位の未対応通報を集計 (mod 限定 / SECURITY DEFINER)。★author_id は返さない (匿名維持)。';

-- 5-2) resolve_community_report (0108 と同一。defensive 再定義)
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

-- ============================================================
-- 6) GRANT
-- ============================================================
grant execute on function public.notify_mod_action_target(uuid, uuid, text, text) to authenticated;
grant execute on function public.mod_delete_post(uuid, text) to authenticated;
grant execute on function public.mod_delete_comment(uuid, text) to authenticated;
grant execute on function public.mod_delete_bbs_reply(uuid, text) to authenticated;
grant execute on function public.get_community_reports(uuid) to authenticated;
grant execute on function public.resolve_community_report(uuid, uuid) to authenticated;

select '0136 完了 — 処置通知(trigger+helper) + コンテンツ削除RPC(匿名維持) + 通報キュー de-anon 硬化' as note;
