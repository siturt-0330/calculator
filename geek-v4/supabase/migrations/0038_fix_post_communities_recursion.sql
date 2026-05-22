-- ============================================================
-- 0038_fix_post_communities_recursion.sql
-- ============================================================
-- 0037 で posts / post_communities の SELECT policy が相互に
-- exists(...) を呼んでしまい、RLS 評価が無限再帰する事故が発生。
-- (42P17: infinite recursion detected in policy for relation
--  "post_communities")
--
-- 修正: 両方の policy を SECURITY DEFINER ヘルパ
-- public.can_view_post(uuid) (migration 0023 で定義済) に集約する。
-- can_view_post は SECURITY DEFINER なので、その内部の SELECT は
-- RLS をバイパスし、policy 評価のループを断ち切る。
-- ============================================================

-- ----- posts SELECT policy を can_view_post ベースに -----
do $$
begin
  if to_regclass('public.posts') is null then
    raise notice 'skip: posts not found';
    return;
  end if;

  -- 0037 で作った可能性のあるポリシーを drop
  execute 'drop policy if exists "posts_read" on public.posts';
  execute 'drop policy if exists "posts_select" on public.posts';
  execute 'drop policy if exists "posts_select_visibility" on public.posts';

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    -- can_view_post は SECURITY DEFINER で内部の post_communities アクセスは
    -- RLS をバイパスするため、ここで再帰は起きない。
    execute 'create policy "posts_select_visibility" on public.posts for select
               using (public.can_view_post(id) or author_id = auth.uid())';
  else
    raise notice 'fallback: can_view_post missing → posts_select using(true)';
    execute 'create policy "posts_select_visibility" on public.posts for select using (true)';
  end if;
end $$;

-- ----- post_communities SELECT policy を can_view_post ベースに -----
do $$
begin
  if to_regclass('public.post_communities') is null then
    raise notice 'skip: post_communities not found';
    return;
  end if;

  execute 'drop policy if exists "post_communities_select" on public.post_communities';

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    -- 紐付け情報の可視性 = 紐付け先 post を見られるかどうか
    execute 'create policy "post_communities_select" on public.post_communities for select
               using (public.can_view_post(post_id))';
  else
    -- 旧挙動 (全公開) にフォールバック
    execute 'create policy "post_communities_select" on public.post_communities for select using (true)';
  end if;
end $$;

-- ----- can_view_post 自体が無い環境向けに安全網として定義 -----
-- (migration 0023 で作られているはずだが、complete_schema.sql で初期化された
--  環境では存在しない可能性があるため)
do $$
begin
  if to_regclass('public.posts') is null then return; end if;
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    -- 既存定義を SECURITY DEFINER で再作成 (search_path 固定 + 再帰防止)
    null;
  end if;

  create or replace function public.can_view_post(p_post_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
  as $fn$
    select case
      when p.visibility = 'private' then p.author_id = auth.uid()
      when p.visibility = 'public' then true
      when p.visibility = 'community_only' then exists (
        select 1 from public.post_communities pc
         where pc.post_id = p.id
           and public.is_community_member(pc.community_id)
      )
      when p.visibility = 'community_public' then true
      else false
    end
    from public.posts p where p.id = p_post_id;
  $fn$;
end $$;

select '0038_fix_post_communities_recursion 完了' as result;
