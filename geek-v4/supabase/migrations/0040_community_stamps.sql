-- ============================================================
-- 0040_community_stamps.sql
-- ============================================================
-- コミュニティ固有スタンプ機能。
--
-- 仕様:
--   - コミュニティのメンバーのみがスタンプを作成できる
--   - そのスタンプは「そのコミュニティに紐付いた投稿 (post_communities)」
--     に対してのみリアクションとして使える
--   - スタンプの実体は 1-40 文字のテキスト (絵文字 / 短文) + 任意の画像 URL
--   - 同一コミュ内でテキストの重複は禁止 (作成者違いの混乱を回避)
--
-- 既存パターン継承元:
--   - 0008 post_reactions: 複合 PK + RLS + 24h 集計トリガ
--   - 0011 user_stamps: クリエイター・use_count・realtime publication
--
-- すべて防御的 (to_regclass / exception handler)。
-- ============================================================

-- ============================================================
-- 1. community_stamps テーブル
-- ============================================================
do $$
begin
  if to_regclass('public.communities') is null then
    raise notice 'skip 1: communities not found';
    return;
  end if;

  -- スタンプ本体
  create table if not exists public.community_stamps (
    id uuid primary key default gen_random_uuid(),
    community_id uuid not null references public.communities(id) on delete cascade,
    creator_id uuid references auth.users(id) on delete set null,
    -- ラベル: "おつ" "草" 等の短文 or 単独絵文字
    label text not null check (length(label) between 1 and 40),
    -- 任意の画像 URL (Storage の community-stamps bucket、絵文字代替)
    image_url text,
    -- 利用集計
    use_count integer not null default 0,
    created_at timestamptz not null default now(),
    -- 同コミュ内で label 重複禁止
    unique (community_id, label)
  );

  -- 索引: コミュ単位の use_count 降順取得用
  create index if not exists community_stamps_community_use_idx
    on public.community_stamps (community_id, use_count desc, created_at desc);

  alter table public.community_stamps enable row level security;

  -- ----- RLS -----
  -- SELECT: コミュメンバー or 公開コミュ閲覧者は誰でも見える
  --         (open / request コミュの場合は member じゃなくても見られる)
  --         invite コミュは member だけ
  drop policy if exists "community_stamps_select" on public.community_stamps;
  create policy "community_stamps_select" on public.community_stamps for select
    using (
      exists (
        select 1 from public.communities c
         where c.id = community_id
           and c.visibility in ('open', 'request')
      )
      or public.is_community_member(community_id)
    );

  -- INSERT: コミュメンバーのみ作成可
  drop policy if exists "community_stamps_insert" on public.community_stamps;
  create policy "community_stamps_insert" on public.community_stamps for insert
    with check (
      creator_id = auth.uid()
      and public.is_community_member(community_id)
    );

  -- UPDATE: 作成者本人のみ (label/image_url 編集)
  drop policy if exists "community_stamps_update" on public.community_stamps;
  create policy "community_stamps_update" on public.community_stamps for update
    using (creator_id = auth.uid())
    with check (creator_id = auth.uid());

  -- DELETE: 作成者 or コミュオーナー
  drop policy if exists "community_stamps_delete" on public.community_stamps;
  create policy "community_stamps_delete" on public.community_stamps for delete
    using (
      creator_id = auth.uid()
      or public.is_community_owner(community_id)
    );
end $$;

-- ============================================================
-- 2. community_stamp_reactions テーブル
-- ============================================================
-- 「ある投稿に対して、誰がどのコミュスタンプで反応したか」
-- post_reactions と同じパターンの複合 PK で重複防止。
do $$
begin
  if to_regclass('public.community_stamps') is null
     or to_regclass('public.posts') is null then
    raise notice 'skip 2: prerequisite tables missing';
    return;
  end if;

  create table if not exists public.community_stamp_reactions (
    post_id uuid not null references public.posts(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    stamp_id uuid not null references public.community_stamps(id) on delete cascade,
    -- デノーマライズ: 集計クエリで join を省略するため
    community_id uuid not null references public.communities(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (post_id, user_id, stamp_id)
  );

  create index if not exists csr_post_idx
    on public.community_stamp_reactions (post_id, created_at desc);
  create index if not exists csr_stamp_idx
    on public.community_stamp_reactions (stamp_id);
  create index if not exists csr_user_idx
    on public.community_stamp_reactions (user_id);

  alter table public.community_stamp_reactions enable row level security;

  -- SELECT: 該当 post を見られる人ならリアクションも見られる
  drop policy if exists "csr_select" on public.community_stamp_reactions;
  create policy "csr_select" on public.community_stamp_reactions for select
    using (
      exists (
        select 1 from public.posts p
         where p.id = post_id
           and (
             p.visibility in ('public', 'community_public')
             or p.author_id = auth.uid()
             or (p.visibility = 'community_only' and public.is_community_member(community_id))
           )
      )
    );

  -- INSERT: 制約 4 種を満たす場合のみ
  --   1. user_id = auth.uid()  (なりすまし防止)
  --   2. stamp が community のもの
  --   3. user が community のメンバー (スタンプ使えるのは内輪)
  --   4. post が community に attach されている (post_communities 経由)
  drop policy if exists "csr_insert" on public.community_stamp_reactions;
  create policy "csr_insert" on public.community_stamp_reactions for insert
    with check (
      user_id = auth.uid()
      and exists (
        select 1 from public.community_stamps s
         where s.id = stamp_id
           and s.community_id = community_stamp_reactions.community_id
      )
      and public.is_community_member(community_id)
      and exists (
        select 1 from public.post_communities pc
         where pc.post_id = community_stamp_reactions.post_id
           and pc.community_id = community_stamp_reactions.community_id
      )
    );

  -- DELETE: 自分のリアクションのみ
  drop policy if exists "csr_delete" on public.community_stamp_reactions;
  create policy "csr_delete" on public.community_stamp_reactions for delete
    using (user_id = auth.uid());
end $$;

-- ============================================================
-- 3. use_count を保守する trigger
-- ============================================================
do $$
begin
  if to_regclass('public.community_stamps') is null
     or to_regclass('public.community_stamp_reactions') is null then
    return;
  end if;

  create or replace function public.handle_community_stamp_reaction_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  begin
    if tg_op = 'INSERT' then
      update public.community_stamps
         set use_count = use_count + 1
       where id = new.stamp_id;
      return new;
    elsif tg_op = 'DELETE' then
      update public.community_stamps
         set use_count = greatest(0, use_count - 1)
       where id = old.stamp_id;
      return old;
    end if;
    return null;
  end;
  $fn$;

  execute 'drop trigger if exists tr_community_stamp_reaction_change on public.community_stamp_reactions';
  execute 'create trigger tr_community_stamp_reaction_change
             after insert or delete on public.community_stamp_reactions
             for each row execute procedure public.handle_community_stamp_reaction_change()';
end $$;

-- ============================================================
-- 4. リアクション通知 (24h 集計、post_reactions と同じパターン)
-- ============================================================
do $$
begin
  if to_regclass('public.community_stamp_reactions') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.posts') is null then
    return;
  end if;

  create or replace function public.notify_on_community_stamp_reaction()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_author uuid;
    v_label text;
  begin
    select author_id into v_author from public.posts where id = new.post_id;
    if v_author is null or v_author = new.user_id then
      -- 自分自身へのリアクションは通知しない
      return new;
    end if;
    select label into v_label from public.community_stamps where id = new.stamp_id;

    -- 24h 内に既に同じ post への同じ stamp の通知があれば skip (集約)
    -- 簡略化のため tag_name に stamp label を入れる
    if exists (
      select 1 from public.notifications
       where user_id = v_author
         and type = 'reply'  -- "reply" を流用 (型 enum 拡張は別 migration)
         and tag_name = coalesce(v_label, '')
         and created_at > now() - interval '24 hours'
    ) then
      return new;
    end if;

    insert into public.notifications (user_id, type, tag_name, message)
    values (v_author, 'reply', coalesce(v_label, ''), 'あなたの投稿にスタンプが付きました');
    return new;
  end;
  $fn$;

  execute 'drop trigger if exists tr_notify_csr on public.community_stamp_reactions';
  execute 'create trigger tr_notify_csr
             after insert on public.community_stamp_reactions
             for each row execute procedure public.notify_on_community_stamp_reaction()';
end $$;

-- ============================================================
-- 5. realtime publication
-- ============================================================
do $$
declare t text;
begin
  for t in select unnest(array['community_stamps', 'community_stamp_reactions']) loop
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
-- 6. delete_account() に新規テーブルを追加
-- ============================================================
-- 0039 で作った delete_account() を再作成して community_stamps /
-- community_stamp_reactions も掃除対象に追加。
-- (作成済みスタンプは creator_id = NULL で残してコミュ財産として保護、
--  リアクションは cascade で消える)
do $$
begin
  if to_regclass('auth.users') is null then return; end if;
  -- 関数自体は 0039 の定義を上書きする (新規 2 テーブルだけ追加)
  -- 旧版を残すため、既存版の本体は壊さず、終端で community_stamp_reactions
  -- だけ削除するパッチ関数を追加する設計でも可。今回はシンプルに上書き。
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

    declare
      t text;
      tables text[] := array[
        'concerns','likes','saves','bookmarks','reports','comments','post_reactions',
        'community_stamp_reactions',  -- ← 新規追加
        'posts','post_communities','post_link_previews',
        'bbs_replies','bbs_reply_reactions','bbs_threads',
        'community_members','community_join_requests','community_invites',
        'community_stamps',           -- ← 新規追加
        'community_spots','community_events','community_calendar_events',
        'community_map_locations','community_qna_documents','community_qna_questions',
        'ad_events','push_subscriptions','notifications','admin_messages',
        'app_feedback','user_stamps','user_liked_tags','user_blocked_tags',
        'tag_subscriptions','official_community_applications',
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
             or t = 'tag_subscriptions' or t = 'ad_events' or t = 'app_feedback'
             or t = 'community_stamp_reactions' then
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
          elsif t = 'community_stamps' or t = 'community_spots' or t = 'community_events'
             or t = 'community_calendar_events' or t = 'community_map_locations'
             or t = 'community_qna_documents' then
            -- creator_id が null になっても残す (コミュ財産として保護)
            execute format('update public.%I set creator_id = null where creator_id = $1', t) using v_user_id;
          elsif t = 'community_qna_questions' then
            execute format('update public.%I set asked_by = null where asked_by = $1', t) using v_user_id;
          elsif t = 'comments' or t = 'bbs_replies' or t = 'posts' or t = 'bbs_threads' then
            execute format('delete from public.%I where author_id = $1', t) using v_user_id;
          elsif t = 'post_communities' or t = 'post_link_previews' then
            continue;
          elsif t = 'profiles' then
            execute format('delete from public.%I where id = $1', t) using v_user_id;
          end if;
        exception when others then
          raise notice 'delete_account: skip % (%)', t, sqlerrm;
        end;
      end loop;
    end;
    begin
      delete from auth.users where id = v_user_id;
    exception when others then
      raise notice 'delete_account: auth.users delete failed: %', sqlerrm;
    end;
  end;
  $fn$;
end $$;

-- ============================================================
-- 完了マーカー
-- ============================================================
select '0040_community_stamps 完了: community_stamps + community_stamp_reactions + trigger + realtime + delete_account 拡張' as result;
