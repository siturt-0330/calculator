-- ============================================================
-- 0037_community_critical_fixes.sql
-- ============================================================
-- 4 並列セキュリティ + UX 監査で発見された Critical / High 級バグを
-- DB レイヤでまとめて修正。
--
-- 修正項目:
--   1. notifications.type CHECK に 'official_post' を追加
--      (旧 CHECK で official_post が弾かれて公式通知が全部失敗していた)
--   2. notify_on_official_community_post trigger を dead table から
--      post_communities AFTER INSERT に張り替え
--      (旧版は使われていない community_posts テーブルに付いていた)
--   3. posts.visibility を効かせる SELECT policy を導入
--      (旧 posts_read = using(true) で private/community_only が全公開)
--   4. post_communities_insert に is_community_member 必須
--      (今までは post の author なら任意 community に attach 可能で spam 自由)
--   5. post_communities AFTER INSERT/DELETE トリガで
--      communities.post_count + last_post_at を保守
--      (0017 の同名 trigger は dead table 用で post_count が永遠に 0)
--   6. community 削除時に orphan 化した community_only 投稿を private に降格
--      (誰にも見えない post を残さない)
--   7. community_members_select を request コミュもメンバー限定に
--      (匿名性: 鍵付きコミュのメンバー一覧が誰でも逆引きできていた)
--   8. post_communities SELECT を visibility ベースで絞る
--      (旧 select using(true) で private/community_only の紐付けが公開)
--   9. verification_token を gen_random_bytes(16) で再生成
--      (旧 md5(random()) 16桁 = 64bit エントロピーで予測可能)
--  10. community_join_requests に status 遷移 trigger
--      (owner が任意に status を pending → approved/rejected に行き来できた)
--
-- 全て defensive (to_regclass / exception handler) で書き、対象テーブルが
-- 無い環境では skip notice を出す。
-- ============================================================

-- ============================================================
-- 1. notifications.type CHECK に 'official_post' を追加
-- ============================================================
do $$
begin
  if to_regclass('public.notifications') is null then
    raise notice 'skip 1: notifications not found';
    return;
  end if;

  -- 既存 CHECK を drop して再作成 (制約名は通常 notifications_type_check)
  begin
    execute 'alter table public.notifications drop constraint if exists notifications_type_check';
  exception when others then null;
  end;

  begin
    execute $sql$
      alter table public.notifications
        add constraint notifications_type_check
        check (type in ('like', 'comment', 'follow', 'reply', 'event', 'official_post', 'mention', 'announcement'))
    $sql$;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- 2. notify_on_official_community_post trigger を post_communities に張り替え
-- ============================================================
-- 旧 trigger は community_posts に付いていたが、投稿の実体は posts +
-- post_communities に移行している。よって post_communities INSERT を
-- フックにして、posts から author_id を取って公式 admin 判定を行う。

do $$
begin
  if to_regclass('public.post_communities') is null
     or to_regclass('public.posts') is null
     or to_regclass('public.communities') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.community_members') is null then
    raise notice 'skip 2: prerequisite tables missing';
    return;
  end if;

  -- 旧 trigger (community_posts 版) を消す
  begin
    execute 'drop trigger if exists tr_notify_official_post on public.community_posts';
  exception when undefined_table then null;
  end;
  begin
    execute 'drop trigger if exists notify_on_official_community_post_trg on public.community_posts';
  exception when undefined_table then null;
  end;

  -- 新規 trigger function
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

    -- 公式コミュかつ author == official_admin の post のみ通知
    if v_author <> v_community.official_admin_user_id then
      return new;
    end if;

    -- メンバー全員 (投稿者本人は除く) に通知 enqueue
    insert into public.notifications (user_id, type, tag_name, message)
    select m.user_id,
           'official_post',
           v_community.name,
           '新しい公式お知らせがあります'
      from public.community_members m
     where m.community_id = new.community_id
       and m.user_id <> v_author;

    return new;
  end;
  $fn$;

  -- post_communities INSERT で発火
  execute 'drop trigger if exists tr_notify_official_post_via_pc on public.post_communities';
  execute 'create trigger tr_notify_official_post_via_pc
             after insert on public.post_communities
             for each row execute procedure public.notify_on_official_post_via_pc()';
end $$;

-- ============================================================
-- 3. posts の SELECT policy を visibility ベースに再定義
-- ============================================================
-- 旧 posts_read = using(true) で private や community_only も全員から SELECT 可能。
-- can_view_post() ヘルパ (0023) は実体作成済みなのでそれを使う。

do $$
begin
  if to_regclass('public.posts') is null then
    raise notice 'skip 3: posts not found';
    return;
  end if;

  execute 'drop policy if exists "posts_read" on public.posts';
  execute 'drop policy if exists "posts_select" on public.posts';
  execute 'drop policy if exists "posts_select_visibility" on public.posts';

  -- can_view_post を使う形にする (存在すれば)
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    execute $sql$
      create policy "posts_select_visibility" on public.posts for select
        using (
          visibility = 'public'
          or visibility = 'community_public'
          or (visibility = 'private' and author_id = auth.uid())
          or (visibility = 'community_only' and exists (
            select 1 from public.post_communities pc
             where pc.post_id = posts.id
               and public.is_community_member(pc.community_id)
          ))
          or author_id = auth.uid()
        )
    $sql$;
  else
    -- can_view_post / is_community_member が無い環境 → 元に近い動作で safe-revert
    execute 'create policy "posts_select_visibility" on public.posts for select using (true)';
    raise notice 'fallback: can_view_post / is_community_member missing → using(true)';
  end if;
end $$;

-- ============================================================
-- 4. post_communities INSERT に is_community_member 必須
-- ============================================================
-- 旧 policy: posts の author なら任意 community に attach 可能
-- 修正後: author かつ自分が member の community のみ attach 可能

do $$
begin
  if to_regclass('public.post_communities') is null
     or to_regclass('public.posts') is null then
    raise notice 'skip 4: post_communities / posts not found';
    return;
  end if;

  execute 'drop policy if exists "post_communities_insert" on public.post_communities';

  -- is_community_member が無い環境 → author だけチェック (旧挙動)
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_community_member'
  ) then
    execute $sql$
      create policy "post_communities_insert" on public.post_communities for insert
        with check (
          exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
          and public.is_community_member(community_id)
        )
    $sql$;
  else
    execute $sql$
      create policy "post_communities_insert" on public.post_communities for insert
        with check (
          exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
        )
    $sql$;
  end if;
end $$;

-- ============================================================
-- 5. post_communities AFTER INSERT/DELETE で communities.post_count + last_post_at 保守
-- ============================================================
-- 旧 0017 の trigger は dead table community_posts 用。post_communities 用が
-- 無いため post_count が永遠に増えない。

do $$
begin
  if to_regclass('public.post_communities') is null
     or to_regclass('public.communities') is null
     or to_regclass('public.posts') is null then
    raise notice 'skip 5: prerequisite tables missing';
    return;
  end if;

  create or replace function public.handle_post_community_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_created_at timestamptz;
  begin
    if tg_op = 'INSERT' then
      -- post.created_at を取得 (last_post_at の候補)
      select created_at into v_created_at from public.posts where id = new.post_id;
      update public.communities
         set post_count = post_count + 1,
             last_post_at = greatest(coalesce(last_post_at, 'epoch'::timestamptz), coalesce(v_created_at, now()))
       where id = new.community_id;
      return new;
    elsif tg_op = 'DELETE' then
      update public.communities
         set post_count = greatest(0, post_count - 1)
       where id = old.community_id;
      return old;
    end if;
    return null;
  end;
  $fn$;

  execute 'drop trigger if exists tr_post_community_change on public.post_communities';
  execute 'create trigger tr_post_community_change
             after insert or delete on public.post_communities
             for each row execute procedure public.handle_post_community_change()';
end $$;

-- ============================================================
-- 6. community 削除時に orphan 化した community_only 投稿を private に降格
-- ============================================================
-- community が消えると post_communities が cascade で消える。残された
-- visibility='community_only' の posts は、attach 先が無いので RLS で
-- 誰にも見えなくなる (author 本人も見られない)。これを 'private' に
-- 降格して author だけは閲覧できるようにする。

do $$
begin
  if to_regclass('public.post_communities') is null
     or to_regclass('public.posts') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip 6: prerequisite tables missing';
    return;
  end if;

  create or replace function public.demote_orphan_community_posts()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  begin
    -- old.community_id に紐付いていた posts のうち、他の community にも
    -- attach されていない community_only の post を private に降格
    update public.posts p
       set visibility = 'private'
     where p.visibility = 'community_only'
       and exists (
         -- まだ削除前の post_communities にこの post が含まれていたか
         -- (削除 trigger なので cascade で消える前にこの行が走る)
         select 1 from public.post_communities pc
          where pc.post_id = p.id
            and pc.community_id = old.id
       )
       and not exists (
         -- 他の community にも attach されているなら降格しない
         select 1 from public.post_communities pc2
          where pc2.post_id = p.id
            and pc2.community_id <> old.id
       );
    return old;
  end;
  $fn$;

  execute 'drop trigger if exists tr_demote_orphan_community_posts on public.communities';
  execute 'create trigger tr_demote_orphan_community_posts
             before delete on public.communities
             for each row execute procedure public.demote_orphan_community_posts()';
end $$;

-- ============================================================
-- 7. community_members SELECT を「自分 or オープンコミュメンバー or 自分の所属コミュ」に絞る
-- ============================================================
-- 旧: open/request 両方のメンバーを全公開 → 鍵付き request コミュの
-- メンバーが誰でも逆引きできていた

do $$
begin
  if to_regclass('public.community_members') is null
     or to_regclass('public.communities') is null then
    raise notice 'skip 7: prerequisite tables missing';
    return;
  end if;

  execute 'drop policy if exists "community_members_select" on public.community_members';
  execute $sql$
    create policy "community_members_select" on public.community_members for select using (
      user_id = auth.uid()
      or community_id in (
        -- open コミュは「メンバーが居る」事実だけ全員に見せる (UI で count 表示)
        select id from public.communities where visibility = 'open'
      )
      or public.is_community_member(community_id)
    )
  $sql$;
end $$;

-- ============================================================
-- 8. post_communities SELECT を visibility ベースで絞る
-- ============================================================
-- 旧 select using(true) で「private/community_only post がどのコミュに
-- 紐付いているか」が全員に見えていた。
-- 修正後: 該当 post を見られる人だけ、紐付け情報も見られる。

do $$
begin
  if to_regclass('public.post_communities') is null
     or to_regclass('public.posts') is null then
    raise notice 'skip 8: post_communities / posts not found';
    return;
  end if;

  execute 'drop policy if exists "post_communities_select" on public.post_communities';

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_community_member'
  ) then
    execute $sql$
      create policy "post_communities_select" on public.post_communities for select
        using (
          exists (
            select 1 from public.posts p
             where p.id = post_id
               and (
                 p.visibility in ('public', 'community_public')
                 or (p.visibility = 'community_only' and public.is_community_member(post_communities.community_id))
                 or p.author_id = auth.uid()
               )
          )
        )
    $sql$;
  else
    -- helper 関数が無い環境では public/public のみ公開
    execute $sql$
      create policy "post_communities_select" on public.post_communities for select
        using (
          exists (
            select 1 from public.posts p
             where p.id = post_id
               and (p.visibility in ('public', 'community_public') or p.author_id = auth.uid())
          )
        )
    $sql$;
  end if;
end $$;

-- ============================================================
-- 9. verification_token を gen_random_bytes(16) で再生成
-- ============================================================
-- 旧: md5(random()::text || clock_timestamp())::text の先頭 16 桁 (64bit)
-- 修正後: gen_random_bytes(16) → hex で 128bit のエントロピー

do $$
begin
  if to_regclass('public.official_community_applications') is null then
    raise notice 'skip 9: official_community_applications not found';
    return;
  end if;

  -- 関数が無い環境では pgcrypto を有効化
  begin
    execute 'create extension if not exists pgcrypto';
  exception when others then null;
  end;

  create or replace function public.gen_verification_token()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  begin
    if new.verification_token is null or new.verification_token = '' then
      new.verification_token := 'geek-verify-' || encode(gen_random_bytes(16), 'hex');
    end if;
    -- verified 後は token を NULL に reset して再利用不可に
    if tg_op = 'UPDATE'
       and new.verification_status = 'verified'
       and (old.verification_status is null or old.verification_status <> 'verified') then
      new.verification_token := null;
    end if;
    return new;
  end;
  $fn$;

  execute 'drop trigger if exists official_apps_gen_token on public.official_community_applications';
  execute 'create trigger official_apps_gen_token
             before insert or update on public.official_community_applications
             for each row execute procedure public.gen_verification_token()';
end $$;

-- ============================================================
-- 10. community_join_requests に status 遷移 trigger
-- ============================================================
-- 旧: owner が UPDATE 自由 (banned / 任意の status へ書き換え可能、ただし CHECK で弾かれる)
-- 申請者本人は UPDATE 不可だが、approved 後の community_members 自動 INSERT も無い
-- 修正後: 遷移を pending → approved/rejected/cancelled のみに制限 + approved 時に
--         community_members に自動 INSERT

do $$
begin
  if to_regclass('public.community_join_requests') is null
     or to_regclass('public.community_members') is null then
    raise notice 'skip 10: community_join_requests not found';
    return;
  end if;

  create or replace function public.guard_join_request_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  begin
    -- 同じ status への UPDATE は no-op として許可
    if new.status = old.status then return new; end if;

    -- pending → {approved, rejected, cancelled} のみ
    if old.status = 'pending' and new.status not in ('approved', 'rejected', 'cancelled') then
      raise exception 'guard: status must transition pending → approved/rejected/cancelled (got %)', new.status
        using errcode = '22023';
    end if;
    -- それ以外の状態からの遷移は禁止 (履歴を改ざんさせない)
    if old.status <> 'pending' then
      raise exception 'guard: cannot mutate non-pending request (was %)', old.status
        using errcode = '22023';
    end if;

    -- approved → community_members に自動 INSERT
    if new.status = 'approved' then
      insert into public.community_members (community_id, user_id, role)
      values (new.community_id, new.user_id, 'member')
      on conflict (community_id, user_id) do nothing;
    end if;

    return new;
  end;
  $fn$;

  execute 'drop trigger if exists tr_guard_join_request_update on public.community_join_requests';
  execute 'create trigger tr_guard_join_request_update
             before update on public.community_join_requests
             for each row execute procedure public.guard_join_request_update()';
end $$;

-- ============================================================
-- 11. 既存 dead trigger / 旧 table の参照を整理
-- ============================================================
-- community_posts は廃止済み (lib/api/communities.ts コメント参照)。
-- テーブル自体は壊さず、依存 trigger だけ drop しておく。

do $$
begin
  if to_regclass('public.community_posts') is null then
    raise notice 'skip 11: community_posts not found (already cleaned)';
    return;
  end if;

  -- 旧通知 trigger を念のため drop
  begin
    execute 'drop trigger if exists tr_notify_official_post on public.community_posts';
  exception when others then null;
  end;

  -- 旧 count trigger も drop
  begin
    execute 'drop trigger if exists tr_community_posts_count on public.community_posts';
    execute 'drop trigger if exists handle_community_post_change_trg on public.community_posts';
  exception when others then null;
  end;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0037_community_critical_fixes 完了: Critical 4 + High 6 を修正' as result;
