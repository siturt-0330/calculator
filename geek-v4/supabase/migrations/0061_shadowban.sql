-- ============================================================
-- 0061_shadowban.sql
-- ============================================================
-- Shadowban 機能を導入。
--
-- 仕様 (Reddit ガイド #10 / Reddit 6.9 章):
--   shadowban = ban されたユーザーには「本人にだけ通常通りに見える」が、
--   「他人には不可視」になる仕組み。スパマー認知遅延 + 再生産コスト ↑。
--
-- 影響範囲:
--   - profiles に shadowbanned カラム + 部分 index
--   - posts / bbs_replies / comments の SELECT policy を再定義
--     (既存 policy 名を尊重: posts_select_visibility / bbs_replies_read /
--      comments_read)
--   - admin_toggle_shadowban RPC (SECURITY DEFINER, is_admin() gated)
--
-- 互換性:
--   - profiles.is_admin は 0012 / 0027 で既に存在
--   - public.is_admin() helper は 0027 で定義済 (SECURITY DEFINER)
--   - public.can_view_post(uuid) は 0038 で定義済 (community 可視性)
--     → posts の policy は can_view_post + shadowban の AND で合成する
--
-- 注意: RLS の変更を含む dangerous migration。本番適用前に backup を取る。
--       supabase db dump → run これ → 動作確認 → 問題あれば 0062_revert_shadowban.sql。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) profiles.shadowbanned カラム + 部分 index
-- ============================================================
alter table public.profiles
  add column if not exists shadowbanned boolean not null default false;

-- shadowbanned=true な user は通常少数想定 → partial index で
-- index size を抑えつつ「shadowbanned ユーザー一覧」 admin query を高速化
create index if not exists profiles_shadowbanned_idx
  on public.profiles(shadowbanned) where shadowbanned = true;

comment on column public.profiles.shadowbanned is
  'Shadowban フラグ: true の時、本人だけが自分の投稿を見れる (他人には不可視)。admin_toggle_shadowban() でのみ更新可。';

-- ============================================================
-- 2) author_visible() helper
-- ============================================================
-- author の shadowbanned 状態を 1 関数に集約。各 policy で同じ式を
-- 書くと typo / drift しやすいので SECURITY DEFINER で吸収する。
--
-- 戻り値:
--   true  → 表示してよい (本人 OR 著者は shadowbanned=false)
--   false → 隠す (著者が shadowbanned=true かつ 閲覧者 != 著者)
--
-- SECURITY DEFINER にしているのは、policy 内から呼ぶときに
-- profiles の RLS を再帰的に評価せず definer 権限で読みたいため
-- (can_view_post / is_admin と同じパターン)。
create or replace function public.author_visible(p_author_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    auth.uid() = p_author_id
    or not coalesce(
      (select shadowbanned from public.profiles where id = p_author_id),
      false
    );
$$;

comment on function public.author_visible(uuid) is
  'Shadowban フィルタ: 本人 OR author が shadowbanned=false の時 true。posts/bbs_replies/comments の SELECT policy 用。';

grant execute on function public.author_visible(uuid) to authenticated, anon;

-- ============================================================
-- 3) posts SELECT policy 再定義
-- ============================================================
-- 既存 policy は 0038_fix_post_communities_recursion で
-- "posts_select_visibility" (using: can_view_post(id) or author_id = auth.uid())
-- として定義されている。
-- ここでは community visibility と shadowban filter の AND で再構築する。
--
-- 注: posts_admin_all (0027) は admin の bypass policy として併存しているので
--     touch しない (admin は引き続き全 row 見られる)。
do $$
begin
  if to_regclass('public.posts') is null then
    raise notice 'skip: public.posts not found';
    return;
  end if;

  -- 過去の posts SELECT 系 policy を一掃 (idempotent)
  execute 'drop policy if exists "posts_read" on public.posts';
  execute 'drop policy if exists "posts_select" on public.posts';
  execute 'drop policy if exists "posts_select_visibility" on public.posts';

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    -- 通常パス: community visibility AND shadowban filter
    -- author 本人は can_view_post (private 経路) と author_visible 両方で常に true。
    execute 'create policy "posts_select_visibility" on public.posts for select
               using ((public.can_view_post(id) or author_id = auth.uid()) and public.author_visible(author_id))';
  else
    -- fallback: can_view_post が無い環境では「公開 + shadowban filter」
    raise notice 'fallback: can_view_post missing → posts_select_visibility uses shadowban filter only';
    execute 'create policy "posts_select_visibility" on public.posts for select using (public.author_visible(author_id))';
  end if;
end $$;

-- ============================================================
-- 4) bbs_replies SELECT policy 再定義
-- ============================================================
-- 既存 policy "bbs_replies_read" (0001) は using(true)。
-- shadowban filter を追加して hardening。
-- bbs_replies_admin_all 系は存在しないので、admin も自分の shadowbanned=false なら通常表示。
-- (admin は管理画面で shadowbanned=true ユーザーを別途確認できる)
do $$
begin
  if to_regclass('public.bbs_replies') is null then
    raise notice 'skip: public.bbs_replies not found';
    return;
  end if;

  execute 'drop policy if exists "bbs_replies_read" on public.bbs_replies';
  execute 'drop policy if exists "br_read" on public.bbs_replies';  -- complete_schema 経路

  execute 'create policy "bbs_replies_read" on public.bbs_replies for select using (public.author_visible(author_id))';
end $$;

-- ============================================================
-- 5) comments SELECT policy 再定義
-- ============================================================
do $$
begin
  if to_regclass('public.comments') is null then
    raise notice 'skip: public.comments not found';
    return;
  end if;

  execute 'drop policy if exists "comments_read" on public.comments';

  execute 'create policy "comments_read" on public.comments for select using (public.author_visible(author_id))';
end $$;

-- ============================================================
-- 6) admin_toggle_shadowban RPC
-- ============================================================
-- admin のみ実行可。
-- profiles_admin_all (0027) があれば admin は直接 update も出来るが、
-- 監査ログ + 「shadowbanned だけを変更する」明示 API を用意する方が安全。
create or replace function public.admin_toggle_shadowban(target_id uuid, banned boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
begin
  -- admin guard (is_admin() helper を使う / 0027 で導入済)
  if v_admin is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_admin and is_admin = true
  ) then
    raise exception 'admin only';
  end if;
  if target_id is null then
    raise exception 'target_id required';
  end if;
  -- 自分自身を shadowban しようとするのは禁止 (lockout 防止)
  if target_id = v_admin then
    raise exception 'cannot shadowban yourself';
  end if;

  update public.profiles
    set shadowbanned = banned
    where id = target_id;

  -- moderation_log があれば監査ログを残す (best-effort)
  if to_regclass('public.moderation_log') is not null then
    begin
      insert into public.moderation_log(admin_id, action, target_type, target_id, reason, metadata)
      values (
        v_admin,
        case when banned then 'shadowban' else 'unshadowban' end,
        'user',
        target_id,
        '',
        jsonb_build_object('shadowbanned', banned)
      );
    exception when others then
      -- log 失敗は本処理を止めない
      raise notice 'moderation_log insert failed: %', sqlerrm;
    end;
  end if;
end;
$$;

comment on function public.admin_toggle_shadowban(uuid, boolean) is
  'Admin 専用: target ユーザーの shadowbanned フラグを切り替え。is_admin guard + 自己 ban 禁止。moderation_log に best-effort で記録。';

grant execute on function public.admin_toggle_shadowban(uuid, boolean) to authenticated;

select '0061_shadowban 完了' as result;
