-- ============================================================
-- 0084: 通知の自己 spam 対策 + poll vote 整合性 (Audit B#6 / B#7)
-- ============================================================
-- B#6: notifications_own (FOR ALL) は INSERT も許可してしまうため、
--      クライアントから type='official_post' 等を user_id=self で挿入すると
--      send-push が自分の全 device に push を発火させてしまう。
--      → SELECT/UPDATE/DELETE のみ self 許可。INSERT は SECURITY DEFINER
--        な trigger (notify_on_like, notify_on_comment, etc.) からのみ。
--
-- B#7: pv_insert は option_id が poll_id 配下の option かを検査しない。
--      → poll A に対して poll B の option_id を投票で書ける = カウント汚染。
--      → WITH CHECK で poll_options.poll_id == poll_votes.poll_id を強制。
--
-- Note: SECURITY DEFINER な trigger は RLS を default で bypass するため、
--       INSERT 権限を revoke しても通常の通知配送は影響を受けない。

-- ============================================================
-- Step 1: notifications — disallow direct user INSERT
-- ============================================================
drop policy if exists "notifications_own" on public.notifications;
drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_update_own" on public.notifications;
drop policy if exists "notifications_delete_own" on public.notifications;

create policy "notifications_select_own"
  on public.notifications
  for select
  using (auth.uid() = user_id);

create policy "notifications_update_own"
  on public.notifications
  for update
  using (auth.uid() = user_id);

create policy "notifications_delete_own"
  on public.notifications
  for delete
  using (auth.uid() = user_id);

-- INSERT は SECURITY DEFINER trigger (notify_on_*) からのみ。
-- authenticated role の INSERT 権限を剥奪する (idempotent: 既に剥奪済でも no-op)。
revoke insert on public.notifications from authenticated;

-- ============================================================
-- Step 2: poll_votes — option_id が poll_id 配下であることを強制
-- ============================================================
drop policy if exists "pv_insert" on public.poll_votes;

create policy "pv_insert"
  on public.poll_votes
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.poll_options
      where id = poll_votes.option_id
        and poll_id = poll_votes.poll_id
    )
  );
