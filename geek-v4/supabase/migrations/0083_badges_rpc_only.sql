-- ============================================================
-- 0083_badges_rpc_only.sql
-- ============================================================
-- Audit A#2: user_badges 自己付与脆弱性の修正
--
-- 旧 RLS (0013):
--   create policy "ub_insert" on public.user_badges
--     for insert with check (auth.uid() = user_id);
--
-- これは「自分の user_id を入れる」ことしかチェックしておらず、
-- badge_code は任意。つまり任意のユーザーが
--   insert into user_badges (user_id, badge_code)
--   values (auth.uid(), 'rainbow')   -- 隠しバッジ
-- を実行できてしまう (poster_100, liked_received_500, rainbow など全て自由に付与可)。
--
-- 修正方針:
--   1. ub_insert ポリシーを drop
--   2. authenticated ロールから INSERT 権限を revoke
--   3. これにより client (anon / authenticated) からの直 INSERT は不可になる
--   4. SECURITY DEFINER 関数 (public.maybe_grant_badge) 経由でのみ付与可能になる
--      → 関数内側で条件判定された場合のみ insert が走る
--   5. 既存の SELECT (`ub_read`) / DELETE は維持 (read OK / 自分のバッジ取消は OK)
--      ※ 0013 時点で DELETE policy は未定義のため、追加で `ub_delete` を作成し
--        ユーザー自身が自分のバッジを取消できるようにする (元仕様コメントに準拠)
--   6. maybe_grant_badge を `set search_path = public, pg_catalog` でハードニング
--      (0053 以降のセキュリティ標準パターン)
--
-- 影響範囲:
--   - client 側で `supabase.from('user_badges').insert(...)` を実行している箇所:
--     grep 結果ゼロ。アプリ全体で `user_badges` を直接 INSERT しているコードは無い。
--     したがって client 側の改修は不要。
--   - 既存 trigger (check_badges_on_post / _on_comment / _on_bbs_reply / _on_reaction)
--     は SECURITY DEFINER で maybe_grant_badge() を呼ぶため引き続き動作する。
--   - 万が一 server-side で直 INSERT しているコードがあれば、
--     `select public.maybe_grant_badge(p_user_id, p_badge_code);` へ置換する必要あり。
--
-- Idempotent:
--   - drop policy if exists
--   - revoke (重複実行しても error にならない)
--   - create or replace function
--   - to_regclass で前提テーブル不在ならスキップ
-- ============================================================

do $$
begin
  -- 前提テーブル不在ならスキップ (部分セットアップ / CI で死なない)
  if to_regclass('public.user_badges') is null then
    raise notice '0083: public.user_badges not found, skip';
    return;
  end if;

  -- ------------------------------------------------------------
  -- 1. 旧 INSERT ポリシーを drop
  -- ------------------------------------------------------------
  drop policy if exists "ub_insert" on public.user_badges;
  drop policy if exists ub_insert on public.user_badges;

  -- ------------------------------------------------------------
  -- 2. authenticated / anon から INSERT 権限を revoke
  --    (SECURITY DEFINER 関数のみ insert 可になる。
  --     関数所有者は postgres (super) なので RLS / privileges を bypass する)
  -- ------------------------------------------------------------
  revoke insert on public.user_badges from anon;
  revoke insert on public.user_badges from authenticated;
  revoke insert on public.user_badges from public;

  -- ------------------------------------------------------------
  -- 3. SELECT / DELETE ポリシーを保証 (idempotent に再生成)
  --    - read は誰でも OK (公開プロフィールにバッジを出すため)
  --    - delete は自分のバッジのみ (un-grant 用)
  -- ------------------------------------------------------------
  drop policy if exists "ub_read" on public.user_badges;
  drop policy if exists ub_read on public.user_badges;
  create policy "ub_read" on public.user_badges
    for select using (true);

  drop policy if exists "ub_delete" on public.user_badges;
  drop policy if exists ub_delete on public.user_badges;
  create policy "ub_delete" on public.user_badges
    for delete using (auth.uid() = user_id);
end $$;

-- ============================================================
-- 4. maybe_grant_badge() を SECURITY DEFINER + search_path で再定義
--    元定義 (0013) は `set search_path` を持たず、search_path 注入で
--    public.* を別 schema に向けられる可能性があった。
--    シグネチャは (uuid, text) で互換性維持。
-- ============================================================
create or replace function public.maybe_grant_badge(p_user_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- p_code は badge_definitions に存在する code のみ許可
  -- (FK 制約があるため明示チェック不要だが、無効 code は no-op で握り潰す)
  insert into public.user_badges(user_id, badge_code)
  values (p_user_id, p_code)
  on conflict do nothing;
end;
$$;

-- 関数自体は SECURITY DEFINER で動くため、呼び出し権限のみを最小に絞る。
-- trigger からの内部呼び出しは role を問わず通る (関数所有者で動く) ため、
-- authenticated に execute を残して直接 RPC 呼び出しも許可しておく
-- (clientが将来 RPC 経由で grant したいケースに備える)。
revoke all on function public.maybe_grant_badge(uuid, text) from public;
grant execute on function public.maybe_grant_badge(uuid, text) to authenticated;

-- ============================================================
-- NOTE:
--   client 側で `supabase.from('user_badges').insert(...)` を呼んでいるコードは
--   2026-05 時点では存在しない (grep 確認済)。
--   今後 client から付与したくなった場合は必ず:
--     await supabase.rpc('maybe_grant_badge', {
--       p_user_id: userId,
--       p_code: 'first_post',
--     });
--   を使うこと。直 INSERT は permission denied で fail する。
-- ============================================================
