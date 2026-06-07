-- ============================================================
-- 0129_revoke_author_id.sql — de-anon Phase2 / Stage 5 (BACKSTOP・最後に適用)
-- ------------------------------------------------------------
-- ★★★ 適用順序が重要。これを早く流すと フィード/コメント/admin が
--     "permission denied for column author_id" で壊れる。必ず最後に。
--
-- 前提 (すべて満たしてから適用):
--   (1) client 改修が web + native(eas update / OTA) に行き渡っている
--       = どの稼働中バイナリも posts/comments の author_id を SELECT/eq しない。
--       (この PR の client 変更: POSTS_SELECT_COLS から author_id 除去、コメントは
--        get_post_comments RPC、表示は avatar+pseudonym_id+is_own。)
--   (2) admin の author_id 読取を definer RPC 化した migration (0128) を適用済み。
--       (admin は authenticated なので、これが無いと REVOKE で運営画面が壊れる。)
--
-- 効果: 直 REST (.select('author_id') / .eq('author_id')) で匿名投稿者の
--   author_id を引けなくなる = 「author_id → profiles_public → nickname」の
--   逆引き経路を DB 層で恒久遮断 (0127 の profiles_public REVOKE と二重で封鎖)。
--
-- 非対象 (REVOKE しない):
--   - INSERT/UPDATE 権限 (createPost/createComment が author_id を書く)。RLS で保護済。
--   - service_role / SECURITY DEFINER RPC (get_feed_page 等 / admin RPC)。列権限の影響外。
--
-- rollback (壊れたら即戻す):
--   grant select (author_id) on public.posts    to anon, authenticated;
--   grant select (author_id) on public.comments to anon, authenticated;
-- 冪等: REVOKE は重複実行で error にならない。
-- ============================================================

revoke select (author_id) on public.posts    from anon;
revoke select (author_id) on public.posts    from authenticated;
revoke select (author_id) on public.comments from anon;
revoke select (author_id) on public.comments from authenticated;

select '0129 完了 — posts/comments.author_id の anon/authenticated 列SELECTを REVOKE (deanon backstop)。前提: client OTA 反映済 + 0128 admin RPC 適用済であること。' as note;
