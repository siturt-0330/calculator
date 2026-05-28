-- ============================================================
-- 0082_child_visibility.sql — 子テーブル SELECT RLS の厳格化
-- ============================================================
-- 背景 (Audit A#1, A#3):
--   posts の SELECT visibility は 0023 / 0037 / 0038 で
--   public.can_view_post(uuid) ヘルパに集約され、private / community_only /
--   community_public を考慮した RLS で守られている。
--
--   しかし子テーブル (post に紐づく派生情報) の SELECT policy は依然
--   `using (true)` のままで、 親 post の可視性を踏み倒して漏れていた:
--     - comments              (0001)  : 全 comment 内容が漏洩 → private/community_only post のコメントが見える
--     - bbs_replies           (0001)  : 0075 で thread_id=posts.id に統合済。 BBS 統合スレの reply が同様に漏洩
--     - post_reactions        (0008)  : 誰がどの post に reaction したかが漏洩
--     - votes                 (0005)  : downvoter (-1) の身元が全公開 → 報復投票 / 嫌がらせの温床
--     - post_added_tags       (0004)  : 他人が追加したタグ情報が、 親 post を見られない user にも漏洩
--
-- 修正方針:
--   各子テーブルの SELECT policy を public.can_view_post(post_id) に
--   委譲する。 can_view_post は SECURITY DEFINER で内部の posts/
--   post_communities アクセスは RLS をバイパス済 (0038 で再帰回避) →
--   policy 評価のループは起きない。
--
--   votes は追加で「downvoter プライバシー」も配慮:
--     - 自分の vote は常に見える
--     - post 作者は自分の post の全 vote を見られる (downvote 集計用途は score 列が別途持つ)
--     - admin は全 vote を見られる (modmail / abuse 調査用)
--     - それ以外には他人の vote は見せない (downvoter を晒さない)
--
-- 既存ポリシー名:
--   - comments_read         (0001 → 0061 で `using (public.author_visible(author_id))` に再定義)
--   - bbs_replies_read      (0001 → 0061 同上)
--   - post_reactions_read   (0008, `using (true)`)
--   - votes_read            (0005, `using (true)`)
--   - post_added_tags_select(0004, `using (true)`)  ← 名前が _read ではなく _select
--
-- shadowban フィルタとの合成:
--   comments / bbs_replies は 0061 で `public.author_visible(author_id)` を
--   かけているが、 ここでは `can_view_post AND author_visible` の AND で再構築する。
--   admin bypass は posts_admin_all (0027) と同じく comments/bbs_replies に
--   admin_all policy が無いので、 admin も自分の visibility 範囲内でしか見えない
--   状態を維持する (admin 観点では 0027 の posts_admin_all 経由で post 自体は
--   見えるので、 親 post を見られる admin なら can_view_post(...) = true で通る)。
--
-- 冪等性:
--   - drop policy if exists → create policy のセットで idempotent
--   - 各 table を to_regclass で存在確認 (CI / 部分セットアップで死なない)
--   - is_admin() / can_view_post() / author_visible() の存在確認 (0027 / 0038 / 0061)
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- Step 0: 依存ヘルパの存在チェック (修復不能なら notice で skip)
-- ============================================================
do $$
declare
  v_missing text := '';
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    v_missing := v_missing || ' can_view_post';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    v_missing := v_missing || ' is_admin';
  end if;
  if v_missing <> '' then
    raise notice '0082: missing helper(s):%, will fallback per-table', v_missing;
  end if;
end $$;

-- ============================================================
-- Step 1: comments — 親 post を見られる人だけが comment を見られる
-- ============================================================
-- 0061 で `using (public.author_visible(author_id))` に再定義済。
-- ここで can_view_post(post_id) と AND 合成して可視性を強化する。
do $$
begin
  if to_regclass('public.comments') is null then
    raise notice '0082: skip comments — table not found';
    return;
  end if;

  execute 'drop policy if exists "comments_read" on public.comments';

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) and exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'author_visible'
  ) then
    execute 'create policy "comments_read" on public.comments for select
               using (public.can_view_post(post_id) and public.author_visible(author_id))';
  elsif exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    -- shadowban helper が無い環境 (古い CI) では can_view_post のみで運用
    execute 'create policy "comments_read" on public.comments for select
               using (public.can_view_post(post_id))';
  else
    -- helper が両方無い場合は最低限「自分の post の comment」 + 「自分のコメント」だけ
    -- に絞る (緩めすぎず厳しすぎず、 復旧 migration 待ちの一時状態)
    raise notice '0082: comments fallback — restrict to author of post or self';
    execute 'create policy "comments_read" on public.comments for select using (
      auth.uid() = author_id
      or exists (select 1 from public.posts p where p.id = comments.post_id and p.author_id = auth.uid())
    )';
  end if;
end $$;

-- ============================================================
-- Step 2: post_reactions — 親 post を見られる人だけが reaction を見られる
-- ============================================================
do $$
begin
  if to_regclass('public.post_reactions') is null then
    raise notice '0082: skip post_reactions — table not found';
    return;
  end if;

  execute 'drop policy if exists "post_reactions_read" on public.post_reactions';

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    execute 'create policy "post_reactions_read" on public.post_reactions for select
               using (public.can_view_post(post_id))';
  else
    -- fallback: 自分の reaction か自分の post の reaction だけ
    raise notice '0082: post_reactions fallback';
    execute 'create policy "post_reactions_read" on public.post_reactions for select using (
      auth.uid() = user_id
      or exists (select 1 from public.posts p where p.id = post_reactions.post_id and p.author_id = auth.uid())
    )';
  end if;
end $$;

-- ============================================================
-- Step 3: post_added_tags — 親 post を見られる人だけが added tag を見られる
-- ============================================================
-- 注: 0004 のポリシー名は `post_added_tags_select` (他のテーブルは _read)。
--    将来の grep 一貫性のため `post_added_tags_read` で再作成しつつ、
--    旧名も drop しておく。
do $$
begin
  if to_regclass('public.post_added_tags') is null then
    raise notice '0082: skip post_added_tags — table not found';
    return;
  end if;

  execute 'drop policy if exists "post_added_tags_select" on public.post_added_tags';
  execute 'drop policy if exists "post_added_tags_read"   on public.post_added_tags';

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    execute 'create policy "post_added_tags_read" on public.post_added_tags for select
               using (public.can_view_post(post_id))';
  else
    raise notice '0082: post_added_tags fallback';
    execute 'create policy "post_added_tags_read" on public.post_added_tags for select using (
      auth.uid() = added_by
      or exists (select 1 from public.posts p where p.id = post_added_tags.post_id and p.author_id = auth.uid())
    )';
  end if;
end $$;

-- ============================================================
-- Step 4: votes — downvoter プライバシー + 親 post 可視性
-- ============================================================
-- 仕様:
--   - 自分の vote は常に見える (UI で「自分は up/down 済」を出すため)
--   - post 作者は自分の post の全 vote を見られる (報復 abuse 調査用に行使可)
--   - admin は全 vote を見られる (modmail / abuse 調査)
--   - 他人の vote は隠す (downvoter を晒さない → Reddit と同等の体験)
do $$
begin
  if to_regclass('public.votes') is null then
    raise notice '0082: skip votes — table not found';
    return;
  end if;

  execute 'drop policy if exists "votes_read" on public.votes';

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    execute 'create policy "votes_read" on public.votes for select using (
      user_id = auth.uid()
      or exists (select 1 from public.posts p where p.id = votes.post_id and p.author_id = auth.uid())
      or public.is_admin()
    )';
  else
    -- is_admin が無い環境 (CI / 部分セットアップ) では admin 経路を外す
    raise notice '0082: votes fallback — no is_admin helper';
    execute 'create policy "votes_read" on public.votes for select using (
      user_id = auth.uid()
      or exists (select 1 from public.posts p where p.id = votes.post_id and p.author_id = auth.uid())
    )';
  end if;
end $$;

-- ============================================================
-- Step 5: bbs_replies — 親 thread = posts.id (0075 で 1:1 UUID 統合済)
-- ============================================================
-- bbs_replies テーブルは 0075 で comments に移行済 (rollback 用に keep)。
-- thread_id は 0001 では bbs_threads.id を参照していたが、 0075 で
-- bbs_threads → posts に同じ UUID で移行されたため、 thread_id は posts.id と
-- 1:1 で対応する。 よって can_view_post(thread_id) で親 post 可視性を判定できる。
do $$
begin
  if to_regclass('public.bbs_replies') is null then
    raise notice '0082: skip bbs_replies — table not found (0075+ 環境では正常)';
    return;
  end if;

  execute 'drop policy if exists "bbs_replies_read" on public.bbs_replies';
  execute 'drop policy if exists "br_read"          on public.bbs_replies';  -- complete_schema 経路

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) and exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'author_visible'
  ) then
    execute 'create policy "bbs_replies_read" on public.bbs_replies for select
               using (public.can_view_post(thread_id) and public.author_visible(author_id))';
  elsif exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_view_post'
  ) then
    execute 'create policy "bbs_replies_read" on public.bbs_replies for select
               using (public.can_view_post(thread_id))';
  else
    raise notice '0082: bbs_replies fallback';
    execute 'create policy "bbs_replies_read" on public.bbs_replies for select using (
      auth.uid() = author_id
    )';
  end if;
end $$;

select '0082_child_visibility 完了 — 子テーブル SELECT を親 post 可視性で厳格化' as result;
