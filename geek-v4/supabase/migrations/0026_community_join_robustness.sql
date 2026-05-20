-- ============================================================
-- 0025_community_join_robustness.sql
-- ============================================================
-- 目的: コミュニティ参加 (community_members INSERT / community_join_requests
--       INSERT) の RLS 違反エラーを根本的に防ぐ。
--
-- 既存ポリシー (0017):
--   community_members_insert:
--     with check (
--       user_id = auth.uid() and (
--         community_id in (select id from public.communities where visibility = 'open')
--         or public.is_community_owner(community_id)
--       )
--       or public.is_community_owner(community_id)
--     )
--   community_join_requests_insert:
--     with check (
--       user_id = auth.uid()
--       and community_id in (select id from public.communities where visibility = 'request')
--     )
--
-- 既知の失敗パターン (0024 communities と同じ):
--   - JWT 失効 / 古いセッション / client が user_id を空のまま送る等
--     で auth.uid() != user_id になり RLS で弾かれる。
--   - join_community_by_id RPC は security definer で OK だが、
--     client 経由の community_join_requests INSERT は client が user_id を
--     セットしているので、JWT がずれると失敗する。
--
-- 0024 で communities INSERT に施したのと同じ防御を施す:
--   1) user_id の DEFAULT を auth.uid() にする
--   2) BEFORE INSERT trigger で user_id を auth.uid() に強制
--   3) RLS は「auth.uid() IS NOT NULL かつ コミュニティ可視性ルール」だけにする
-- ============================================================

-- ============================================================
-- (A) community_members
-- ============================================================

-- 1) DEFAULT を追加
alter table public.community_members
  alter column user_id set default auth.uid();

-- 2) BEFORE INSERT trigger: user_id / role を強制
create or replace function public.community_members_normalize_insert()
returns trigger language plpgsql security definer as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required to join community';
  end if;

  -- owner / admin が他人を追加するケースを判定:
  --   既に当該コミュニティに owner/admin として所属しているなら任意の user_id を許可
  if new.user_id is null
     or new.user_id <> auth.uid() then
    if exists (
      select 1 from public.community_members m
      where m.community_id = new.community_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    ) then
      -- owner/admin が他人を入れる場合: user_id は client の指定を尊重
      -- ただし null だったら自分を入れる
      if new.user_id is null then
        new.user_id := auth.uid();
      end if;
    else
      -- 一般ユーザーは必ず自分を入れる: client が他人の id をセットしていても
      -- なりすまし不可
      new.user_id := auth.uid();
    end if;
  end if;

  -- role: owner / admin が指定したもの以外は強制的に 'member' にする
  --   - 自分自身を追加する一般 join は必ず 'member'
  --   - owner が招待する場合だけ admin / owner を許可する
  if new.user_id = auth.uid() then
    if new.role is null or new.role not in ('owner', 'admin', 'member') then
      new.role := 'member';
    end if;
    -- 自分自身を owner / admin として登録する事は handle_new_community trigger
    -- (作成時) 経由でしか起きない。手動 INSERT で自分を owner にする抜け穴を塞ぐ:
    if new.role in ('owner', 'admin') then
      -- 既に当該コミュニティに owner / admin として存在しないなら、平 member に降格
      if not exists (
        select 1 from public.community_members m
        where m.community_id = new.community_id
          and m.user_id = auth.uid()
          and m.role in ('owner', 'admin')
      ) then
        -- 例外: handle_new_community が直前に挿入したばかりの owner は通したい。
        -- そのケースは "communities への INSERT trigger が呼ぶ" ので
        -- pg_trigger_depth() > 1 で識別できる (= trigger 連鎖の中)。
        if pg_trigger_depth() <= 1 then
          new.role := 'member';
        end if;
      end if;
    end if;
  else
    -- 他人を追加するケースは owner/admin であることを確認済み (上のブロック)
    if new.role is null or new.role not in ('admin', 'member') then
      new.role := 'member';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists community_members_normalize_insert on public.community_members;
create trigger community_members_normalize_insert
  before insert on public.community_members
  for each row execute procedure public.community_members_normalize_insert();

-- 3) RLS を緩和:
--    - trigger が user_id / role を強制するので、client 起点の RLS では
--      「ログインしている」+「コミュニティの visibility が許す」だけチェック
drop policy if exists "community_members_insert" on public.community_members;
create policy "community_members_insert" on public.community_members for insert with check (
  auth.uid() is not null
  and (
    -- open community に自分を追加
    community_id in (select id from public.communities where visibility = 'open')
    -- owner / admin が任意の visibility のコミュニティに任意のユーザーを追加
    or public.is_community_admin(community_id)
    -- handle_new_community trigger 経由 (= communities INSERT 直後の自動 owner 追加)
    -- は security definer なので RLS をバイパスするため明示は不要
  )
);

-- ============================================================
-- (B) community_join_requests
-- ============================================================

-- 1) DEFAULT
alter table public.community_join_requests
  alter column user_id set default auth.uid();

-- 2) BEFORE INSERT trigger: user_id を auth.uid() に強制 + status を pending に固定
create or replace function public.community_join_requests_normalize_insert()
returns trigger language plpgsql security definer as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required to request join';
  end if;
  new.user_id := auth.uid();
  -- 申請時点の status は必ず pending — owner だけが後で approve/reject する
  new.status := 'pending';
  return new;
end;
$$;

drop trigger if exists community_join_requests_normalize_insert on public.community_join_requests;
create trigger community_join_requests_normalize_insert
  before insert on public.community_join_requests
  for each row execute procedure public.community_join_requests_normalize_insert();

-- 3) INSERT RLS を緩和: 「ログインしている」+「request 制コミュニティ」だけ
drop policy if exists "community_join_requests_insert" on public.community_join_requests;
create policy "community_join_requests_insert" on public.community_join_requests for insert with check (
  auth.uid() is not null
  and community_id in (select id from public.communities where visibility = 'request')
);

-- ============================================================
-- (C) join_community_by_id RPC を冪等 & グレースフルに
-- ============================================================
-- 既存の join_community_by_id (0019) は visibility が request の時に
-- raise exception するが、client 側でこれを「失敗」として扱ってしまう問題がある。
-- request 制への遷移は別 API (requestJoinCommunity) でやるべきなので、ここで
-- エラーメッセージを日本語化して PostgREST から直接返す。
create or replace function public.join_community_by_id(c_id uuid)
returns void language plpgsql security definer as $$
declare
  v_visibility text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using
      message = 'ログイン情報を確認できませんでした。再度ログインしてください。',
      hint = 'auth.uid() returned null — JWT may be missing/expired';
  end if;
  select visibility into v_visibility from public.communities where id = c_id;
  if v_visibility is null then
    raise exception 'community_not_found' using
      message = 'コミュニティが見つかりません。',
      hint = 'no row with that id';
  end if;
  if v_visibility = 'open' then
    insert into public.community_members(community_id, user_id, role)
    values (c_id, auth.uid(), 'member')
    on conflict (community_id, user_id) do nothing;
  elsif v_visibility = 'invite' then
    raise exception 'invite_only' using
      message = 'このコミュニティは招待制です。招待リンクから参加してください。';
  else
    -- request
    raise exception 'requires_approval' using
      message = 'このコミュニティは参加申請が必要です。';
  end if;
end;
$$;
