-- ============================================================
-- 0106_enforce_account_state_writes.sql
-- ------------------------------------------------------------
-- 真因 (workflow 監査 P1):
--   account_state ('suspended'/'warned') が「書き込み禁止」の制裁として運用上は
--   admin から設定される (lib/api/admin.ts suspendUser) のに、コンテンツ系テーブルの
--   INSERT RLS は全て identity (auth.uid()=author_id) のみで gate しており、
--   account_state を一切参照していなかった。
--   さらに client 側のハードブロック (authStore.checkAccountState) を「ログイン許可+
--   バナー」方針へ変更したため、停止ユーザの書き込みを止める唯一の砦が消えた。
--   → 停止ユーザが posts/comments/likes/concerns 等を自由に作成できてしまう。
--
-- 対策 (既存ポリシーを壊さない追加方式):
--   既存の INSERT ポリシーを再作成すると述語を 1 つ取りこぼすだけで全投稿が壊れるため、
--   *additive* な BEFORE INSERT トリガで「現在ユーザの account_state が
--   suspended / warned なら 42501 で拒否」する。これなら既存 RLS には一切触れない。
--   - 対象は full-stop 状態の suspended / warned のみ (restricted は「1日3件まで」等の
--     ソフト制限なので別途・将来対応。ここでは全面ブロックしない)。
--   - auth.uid() が NULL (service_role / system 文脈) は素通り。
--   - 存在しない table はスキップ (information_schema で存在確認) して冪等・堅牢に。
-- ============================================================

create or replace function public.enforce_account_state_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  st text;
begin
  -- service_role / system (auth.uid() = NULL) は対象外
  if auth.uid() is null then
    return new;
  end if;
  select account_state into st from public.profiles where id = auth.uid();
  if st in ('suspended', 'warned') then
    raise exception 'guard: アカウント制限中のため、この操作は実行できません (account_state=%)', st
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

-- 対象テーブルに BEFORE INSERT トリガを貼る (存在するものだけ)。
do $$
declare
  t text;
  tables text[] := array[
    'posts', 'comments', 'likes', 'post_reactions',
    'concerns', 'comment_concerns',
    'bbs_threads', 'bbs_replies', 'community_posts'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('drop trigger if exists zz_enforce_account_state on public.%I', t);
      execute format(
        'create trigger zz_enforce_account_state before insert on public.%I '
        || 'for each row execute function public.enforce_account_state_write()', t);
    end if;
  end loop;
end $$;

select '0106_enforce_account_state_writes 完了' as result;
