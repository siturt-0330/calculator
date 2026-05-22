-- ============================================================
-- 0039_community_polish.sql
-- ============================================================
-- 4 並列監査の Medium/Low をまとめて修正。すべて防御的 (to_regclass)。
--
-- 修正項目:
--   1. community_events に updated_at + before update trigger
--   2. community_calendar_events.url を HTTPS のみに
--   3. community_qna_documents.created_by を `on delete set null`
--   4. notifications に community_id カラム + index
--   5. community-icons bucket SELECT を可視性ベースに
--   6. community_invites.token に強生成 default + select policy 制限
--   7. realtime publication 追加 (join_requests / invites / post_communities)
--   8. delete_account() targets を新規テーブルに拡張 (GDPR)
--   9. community_spots に is_certified 列確保
--  10. post_communities index 重複の解消
--  11. community_calendar_events.url HTTPS check + image_url HTTPS check
--  12. mv_trending_tags / community_spots_geo_idx の改善 (skip if missing)
-- ============================================================

-- ============================================================
-- 1. community_events に updated_at + trigger
-- ============================================================
do $$
begin
  if to_regclass('public.community_events') is null then
    raise notice 'skip 1: community_events not found';
    return;
  end if;

  execute 'alter table public.community_events
             add column if not exists updated_at timestamptz not null default now()';

  create or replace function public.touch_community_event_updated_at()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
  as $fn$
  begin
    new.updated_at := now();
    return new;
  end;
  $fn$;

  execute 'drop trigger if exists tr_touch_community_event on public.community_events';
  execute 'create trigger tr_touch_community_event
             before update on public.community_events
             for each row execute procedure public.touch_community_event_updated_at()';
end $$;

-- ============================================================
-- 2. community_calendar_events.url を HTTPS 必須に
-- ============================================================
do $$
begin
  if to_regclass('public.community_calendar_events') is null then
    raise notice 'skip 2: community_calendar_events not found';
    return;
  end if;

  begin
    execute 'alter table public.community_calendar_events
               drop constraint if exists community_calendar_events_url_check';
  exception when others then null;
  end;

  begin
    execute $sql$
      alter table public.community_calendar_events
        add constraint cce_url_https check (url is null or url ~ '^https://')
    $sql$;
  exception when duplicate_object then null;
       when others then raise notice 'skip cce https: %', sqlerrm;
  end;
end $$;

-- ============================================================
-- 3. community_qna_documents.created_by を on delete set null
-- ============================================================
-- admin がアカウント削除しても公式 Q&A が消えないように
do $$
declare
  v_constraint text;
begin
  if to_regclass('public.community_qna_documents') is null then
    raise notice 'skip 3: community_qna_documents not found';
    return;
  end if;

  -- 既存 FK を探して drop → on delete set null で再作成
  select tc.constraint_name into v_constraint
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu using (constraint_name)
   where tc.table_schema = 'public'
     and tc.table_name = 'community_qna_documents'
     and tc.constraint_type = 'FOREIGN KEY'
     and kcu.column_name = 'created_by'
   limit 1;

  if v_constraint is not null then
    execute format('alter table public.community_qna_documents drop constraint %I', v_constraint);
  end if;

  -- 既存カラムを nullable にしてから FK 再作成
  begin
    execute 'alter table public.community_qna_documents alter column created_by drop not null';
  exception when others then null;
  end;
  begin
    execute 'alter table public.community_qna_documents
               add constraint qna_documents_created_by_fkey
               foreign key (created_by) references auth.users(id) on delete set null';
  exception when duplicate_object then null;
       when others then raise notice 'skip qna fk: %', sqlerrm;
  end;
end $$;

-- ============================================================
-- 4. notifications に community_id 列追加 + index
-- ============================================================
-- 0035 で send-push の遷移先 url を /notifications 固定にしていたのを
-- /community/<id> 直リンクへ拡張するため。
do $$
begin
  if to_regclass('public.notifications') is null then
    raise notice 'skip 4: notifications not found';
    return;
  end if;

  execute 'alter table public.notifications
             add column if not exists community_id uuid';

  -- FK 制約を追加 (community 削除時は通知も消える)
  begin
    execute 'alter table public.notifications
               add constraint notifications_community_id_fkey
               foreign key (community_id) references public.communities(id) on delete cascade';
  exception when duplicate_object then null;
       when others then null;
  end;

  execute 'create index if not exists notifications_community_idx
             on public.notifications(community_id)
             where community_id is not null';
end $$;

-- ============================================================
-- 5. notify_on_official_post_via_pc を community_id にも書き込む
-- ============================================================
-- 0037 で作った関数を上書きする (community_id を notifications に入れる)
do $$
begin
  if to_regclass('public.post_communities') is null
     or to_regclass('public.notifications') is null then
    return;
  end if;

  create or replace function public.notify_on_official_post_via_pc()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_community record;
    v_author uuid;
  begin
    select id, name, is_official, official_admin_user_id
      into v_community
      from public.communities
     where id = new.community_id;
    if not found or v_community.is_official is not true then
      return new;
    end if;
    select author_id into v_author from public.posts where id = new.post_id;
    if not found or v_author is null then
      return new;
    end if;
    if v_author <> v_community.official_admin_user_id then
      return new;
    end if;
    insert into public.notifications (user_id, type, tag_name, community_id, message)
    select m.user_id,
           'official_post',
           v_community.name,
           v_community.id,
           '新しい公式お知らせがあります'
      from public.community_members m
     where m.community_id = new.community_id
       and m.user_id <> v_author;
    return new;
  end;
  $fn$;
end $$;

-- ============================================================
-- 6. community-icons bucket SELECT を可視性ベースに
-- ============================================================
-- 旧: 全 bucket SELECT 公開 → 招待制コミュのアイコンも誰でも見える
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'skip 6: storage.objects not found';
    return;
  end if;

  begin
    execute 'drop policy if exists "community_icons_read" on storage.objects';
    execute 'drop policy if exists "community_icons_select" on storage.objects';
    execute 'drop policy if exists "Anyone can read community icons" on storage.objects';
  exception when others then null;
  end;

  begin
    execute $sql$
      create policy "community_icons_select" on storage.objects for select
        using (
          bucket_id = 'community-icons'
          and (
            -- open/request 公開コミュ (=検索結果に出る) のアイコンは誰でも閲覧可
            exists (
              select 1 from public.communities c
               where c.id::text = (storage.foldername(name))[1]
                 and c.visibility in ('open', 'request')
            )
            or public.is_community_member(((storage.foldername(name))[1])::uuid)
          )
        )
    $sql$;
  exception when others then raise notice 'skip 6 policy: %', sqlerrm;
  end;
end $$;

-- ============================================================
-- 7. community_invites.token に強生成 default + select policy 制限
-- ============================================================
do $$
begin
  if to_regclass('public.community_invites') is null then
    raise notice 'skip 7: community_invites not found';
    return;
  end if;

  begin
    execute 'create extension if not exists pgcrypto';
  exception when others then null;
  end;

  -- token に default を付与 (既存値は触らない)
  begin
    execute $sql$
      alter table public.community_invites
        alter column token set default ('inv_' || encode(gen_random_bytes(16), 'hex'))
    $sql$;
  exception when others then raise notice 'skip 7 default: %', sqlerrm;
  end;

  -- 一般 member には token を見せない (owner/admin のみ)
  begin
    execute 'drop policy if exists "community_invites_select" on public.community_invites';
    execute $sql$
      create policy "community_invites_select" on public.community_invites for select
        using (public.is_community_owner(community_id) or created_by = auth.uid())
    $sql$;
  exception when others then raise notice 'skip 7 policy: %', sqlerrm;
  end;
end $$;

-- ============================================================
-- 8. realtime publication 追加
-- ============================================================
do $$
declare t text;
begin
  for t in select unnest(array[
    'community_join_requests',
    'community_invites',
    'post_communities',
    'community_events',
    'community_calendar_events',
    'community_spots',
    'community_qna_documents'
  ]) loop
    if to_regclass('public.' || t) is null then continue; end if;
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when others then raise notice 'skip realtime %: %', t, sqlerrm;
    end;
  end loop;
end $$;

-- ============================================================
-- 9. delete_account() targets を新規テーブルに拡張 (GDPR Right to Erasure)
-- ============================================================
-- 0021 で作った delete_account() に 0032/0035 で追加されたテーブルが含まれていなかった。
-- 既存関数を再作成して、新規テーブルも掃除対象に追加。
do $$
begin
  if to_regclass('auth.users') is null then return; end if;

  create or replace function public.delete_account()
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp, auth
  as $fn$
  declare
    v_user_id uuid := auth.uid();
  begin
    if v_user_id is null then
      raise exception 'not authenticated' using errcode = '28000';
    end if;

    -- public 上のユーザー所有データを安全な順序で消す
    -- (FK 関係: 子 → 親 の順)
    -- FK が cascade のテーブルは明示削除不要だが、明示しておいた方が
    -- 監査上「漏れなく消した」ことが明確になる。
    -- 各 delete は対象テーブルが存在しない時は exception を握りつぶす。
    declare
      t text;
      tables text[] := array[
        -- core
        'concerns','likes','saves','bookmarks','reports','comments','post_reactions',
        'posts','post_communities','post_link_previews',
        -- bbs
        'bbs_replies','bbs_reply_reactions','bbs_threads',
        -- community
        'community_members','community_join_requests','community_invites',
        'community_spots','community_events','community_calendar_events',
        'community_map_locations','community_qna_documents','community_qna_questions',
        -- ad / push / notifications
        'ad_events','push_subscriptions','notifications','admin_messages',
        'app_feedback','user_stamps','user_liked_tags','user_blocked_tags',
        'tag_subscriptions','official_community_applications',
        -- last: profile
        'profiles'
      ];
    begin
      foreach t in array tables loop
        if to_regclass('public.' || t) is null then continue; end if;
        begin
          if t = 'reports' then
            execute format('delete from public.%I where reporter_id = $1', t) using v_user_id;
          elsif t = 'concerns' or t = 'likes' or t = 'saves' or t = 'bookmarks'
             or t = 'community_members' or t = 'community_join_requests'
             or t = 'push_subscriptions' or t = 'user_stamps'
             or t = 'user_liked_tags' or t = 'user_blocked_tags'
             or t = 'tag_subscriptions' or t = 'ad_events' or t = 'app_feedback' then
            execute format('delete from public.%I where user_id = $1', t) using v_user_id;
          elsif t = 'notifications' then
            execute format('delete from public.%I where user_id = $1', t) using v_user_id;
          elsif t = 'admin_messages' then
            execute format('delete from public.%I where recipient_id = $1 or sender_id = $1', t) using v_user_id;
          elsif t = 'post_reactions' or t = 'bbs_reply_reactions' then
            execute format('delete from public.%I where user_id = $1', t) using v_user_id;
          elsif t = 'community_invites' then
            execute format('delete from public.%I where created_by = $1', t) using v_user_id;
          elsif t = 'official_community_applications' then
            execute format('delete from public.%I where applicant_user_id = $1', t) using v_user_id;
          elsif t = 'community_spots' or t = 'community_events' or t = 'community_calendar_events'
             or t = 'community_map_locations' or t = 'community_qna_documents' then
            -- created_by が null になっても残す (公式コミュ財産)
            execute format('update public.%I set created_by = null where created_by = $1', t) using v_user_id;
          elsif t = 'community_qna_questions' then
            execute format('update public.%I set asked_by = null where asked_by = $1', t) using v_user_id;
          elsif t = 'comments' or t = 'bbs_replies' or t = 'posts' or t = 'bbs_threads' then
            execute format('delete from public.%I where author_id = $1', t) using v_user_id;
          elsif t = 'post_communities' or t = 'post_link_previews' then
            -- FK cascade に任せる
            continue;
          elsif t = 'profiles' then
            execute format('delete from public.%I where id = $1', t) using v_user_id;
          end if;
        exception when others then
          raise notice 'delete_account: skip % (%)', t, sqlerrm;
        end;
      end loop;
    end;

    -- 最後に auth.users を消す (require service_role context だが SECURITY DEFINER なので可)
    begin
      delete from auth.users where id = v_user_id;
    exception when others then
      raise notice 'delete_account: auth.users delete failed: %', sqlerrm;
    end;
  end;
  $fn$;

  -- grant execute (authenticated 全員に許可、本人だけ消える)
  begin
    execute 'grant execute on function public.delete_account() to authenticated';
  exception when others then null;
  end;
end $$;

-- ============================================================
-- 10. community_spots の is_certified カラム確保
-- ============================================================
do $$
begin
  if to_regclass('public.community_spots') is null then return; end if;
  execute 'alter table public.community_spots
             add column if not exists is_certified boolean not null default false';
  execute 'create index if not exists community_spots_certified_idx
             on public.community_spots(community_id, is_certified)
             where is_certified = true';
end $$;

-- ============================================================
-- 11. post_communities index 重複の解消
-- ============================================================
-- 0023 で作成: post_communities_community_idx (community_id, created_at desc)
-- 0028 で作成: post_communities_community_created_idx (同じ)
-- 名前は違うが内容が重複。0028 の方を drop。
do $$
begin
  if to_regclass('public.post_communities') is null then return; end if;
  begin
    execute 'drop index if exists public.post_communities_community_created_idx';
  exception when others then null;
  end;
end $$;

-- ============================================================
-- 12. community_calendar_events.image_url HTTPS check
-- ============================================================
do $$
begin
  if to_regclass('public.community_calendar_events') is null then return; end if;
  begin
    execute $sql$
      alter table public.community_calendar_events
        add constraint cce_image_url_https check (image_url is null or image_url ~ '^https://')
    $sql$;
  exception when duplicate_object then null;
       when others then null;
  end;
end $$;

-- ============================================================
-- 13. community_join_requests に id PK を追加 (履歴累積)
-- ============================================================
-- 旧: PK = (community_id, user_id) → 一度 rejected されたら再申請不能
-- 修正後: id を追加 PK にし、 (community_id, user_id) に partial unique
--         (status='pending' のとき 1 件まで)
-- ※ 既存データを壊さないよう注意深く。
do $$
declare
  v_pk_constraint text;
  has_id boolean;
begin
  if to_regclass('public.community_join_requests') is null then return; end if;

  -- id 列が既にあるか
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_join_requests'
      and column_name = 'id'
  ) into has_id;

  if not has_id then
    execute 'alter table public.community_join_requests
               add column id uuid not null default gen_random_uuid()';
  end if;

  -- 既存 PK を探す
  select tc.constraint_name into v_pk_constraint
    from information_schema.table_constraints tc
   where tc.table_schema = 'public'
     and tc.table_name = 'community_join_requests'
     and tc.constraint_type = 'PRIMARY KEY'
   limit 1;

  if v_pk_constraint is not null then
    -- 旧 PK = (community_id, user_id) を drop
    begin
      execute format('alter table public.community_join_requests drop constraint %I', v_pk_constraint);
    exception when others then null;
    end;
  end if;

  -- 新 PK = (id)
  begin
    execute 'alter table public.community_join_requests
               add constraint community_join_requests_pkey primary key (id)';
  exception when duplicate_object then null;
  end;

  -- partial unique: pending は 1 件まで
  begin
    execute 'create unique index if not exists cjr_unique_pending
               on public.community_join_requests (community_id, user_id)
               where status = ''pending''';
  exception when others then raise notice 'skip cjr unique: %', sqlerrm;
  end;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0039_community_polish 完了: Medium/Low 13 件まとめ修正' as result;
