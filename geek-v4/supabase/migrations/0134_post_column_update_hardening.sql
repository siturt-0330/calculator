-- ============================================================
-- 0134_post_column_update_hardening.sql
--   posts の「列単位 UPDATE 改竄」ホールを塞ぐ (0133 の申し送り対応)
-- ------------------------------------------------------------
-- 背景 (元から在る穴・編集機能とは独立):
--   posts_update RLS (0001 = `using(auth.uid()=author_id)`、0133 で
--   `with check(auth.uid()=author_id)` 追加) は「どの *行* を更新できるか」
--   しか制限できず、「どの *列* を更新できるか」は制限できない。
--   そのため認証済みユーザは anon key + 自分の JWT で、自分の投稿に対し
--   直接 REST で任意列を UPDATE でき、
--     update posts set likes_count=99999, score=999, hot_score=999,
--                      comments_count=999, concern_count=0,
--                      visibility='public', is_public=true where id=<自分のpost>
--   のように いいね数 / ランキングスコア / 公開範囲 を捏造できた
--   (匿名SNSで人気投稿の自演・限定公開の全体公開化)。
--   0133 は author_id / is_anonymous / trust_score_at_post / created_at を
--   BEFORE トリガで OLD 固定したが、counter 列と visibility/is_public は未対応。
--
-- 正攻法とその落とし穴:
--   列単位 GRANT で封じるのが正攻法:
--     revoke update on posts from authenticated;
--     grant  update (編集可能列のみ) on posts to authenticated;
--   ところが counter 列を維持する以下のトリガ関数は SECURITY INVOKER
--   (= いいね/コメント/気になる を押した *ユーザの権限* で posts を UPDATE する):
--     - update_likes_count    (0001 / likes)     → posts.likes_count
--     - update_comments_count (0001 / comments)  → posts.comments_count
--     - update_concern_count  (0006→0010 / concerns) → posts.concern_count
--   INVOKER のままだと、like を押した瞬間トリガが authenticated 権限で
--   `update posts set likes_count=...` を試みるが、likes_count を revoke して
--   いるので「permission denied for column likes_count」で like が壊れる。
--   → 列 GRANT の *前に* これら counter トリガ関数を SECURITY DEFINER 化する。
--   (score/hot_score: update_post_score は 0058 で drop 済 = votes 経由廃止。
--    hot_score は compute_post_hot_score = BEFORE トリガが NEW を書き換えるだけで
--    別 UPDATE を撃たない → 列権限の影響外。DEFINER 化不要。)
--
-- なぜ create or replace ではなく ALTER FUNCTION で DEFINER 化するか:
--   counter 関数の本体は 0001_schema.sql と complete_schema.sql で *差異* がある
--   (例: update_comments_count は complete_schema 版が DELETE 減算ありで
--    profiles.comment_count を触らない / 0001 版は INSERT のみで profiles を触る)。
--   どちらが live かを migration から断定できないため、本体を create or replace で
--   書き直すと live ロジックを巻き戻すリスクがある。
--   ALTER FUNCTION は *セキュリティ属性だけ* を切り替え、本体・トリガ定義は
--   一切触らないので「ロジックは現状維持」を最も忠実に満たす。
--
-- DEFINER 化の安全性 (回帰しない理由):
--   関数の所有者 (= postgres / table owner) は posts/profiles の RLS を bypass し
--   全列権限を持つ。INVOKER で *今 成功している* 書き込みは、より強い権限の owner
--   でも必ず成功する (同等以上に permissive)。auth.uid() (JWT GUC) と
--   pg_trigger_depth() は DEFINER でも不変なので、profiles の派生カウンタ
--   guard (guard_profile_update 0100/0105: auth.uid()=admin 判定 + depth>=2 許可)
--   の挙動も変わらない。counter が現に表示更新されている = これらの UPDATE は
--   既に実行できている事実から、DEFINER 化で新たに壊れる経路は無い。
--
-- 影響を受けない正規の posts 書き込み経路 (棚卸し済):
--   - updatePost (lib/api/posts.ts)        → 下記ホワイトリスト列のみ (許可)
--   - togglePostQAMode (lib/api/posts.ts)  → qa_mode (許可)
--   - automod-eval Edge Function           → is_hidden/tag_names を service_role で
--                                            書く (service_role は列権限/RLS を bypass)
--   - admin 削除 (admin_delete_post RPC)   → DELETE (UPDATE 権限とは別。revoke 対象外)
--   - admin shadowban (admin_toggle_shadowban) → profiles.shadowbanned (posts 列ではない)
--   認証ユーザが posts を直 UPDATE する経路は updatePost / togglePostQAMode のみで、
--   いずれもホワイトリスト内。非ホワイトリスト列を直 UPDATE する正規経路は無い。
--
-- 冪等: ALTER FUNCTION は pg_proc 存在チェック付き / revoke・grant は重複実行で
--   error にならない。何度流しても同じ最終状態。
--   ★本番は Supabase SQL エディタで手動適用が必要 (他 migration と同様)。
--   ★デプロイ(本番反映)はユーザ明示指示時のみ。適用前に下記「実機確認 (a)」
--     = like→count 反映 を必ずローカル/preview で確認すること。
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) counter トリガ関数を SECURITY DEFINER 化 (+ search_path 固定)
--    本体は触らず属性のみ変更。pronargs=0 でトリガ関数 (引数なし) を特定。
--    search_path 固定は DEFINER 関数の search_path 注入対策 (本体は元々
--    public.posts 等で完全修飾済みなので解決は変わらない)。
-- ----------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'update_likes_count',
    'update_comments_count',
    'update_concern_count'
  ] loop
    if exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn
        and p.pronargs = 0
    ) then
      execute format('alter function public.%I() security definer', fn);
      execute format('alter function public.%I() set search_path = public, pg_catalog', fn);
    else
      raise notice 'skip: function public.%() not found', fn;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 1.5) フェイルセーフ: 3 つの counter 関数が全て DEFINER 化できているか検証し、
--   1 つでも INVOKER のままなら revoke を *中止* して abort する。
--   (DEFINER 化漏れのまま下の revoke を実行すると like/comment/concern が
--    「permission denied」で壊れるため、その手前で確実に止める)
-- ----------------------------------------------------------------
do $$
declare
  still_invoker text;
begin
  select string_agg(p.proname, ', ') into still_invoker
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('update_likes_count', 'update_comments_count', 'update_concern_count')
    and p.pronargs = 0
    and p.prosecdef = false;
  if still_invoker is not null then
    raise exception 'abort 0134: counter 関数が SECURITY DEFINER 化されていません (%) — revoke を中止しました (counter 破壊防止)。関数名/シグネチャを確認して再実行してください。', still_invoker;
  end if;
end $$;

-- ----------------------------------------------------------------
-- 2) posts の table 全体 UPDATE を authenticated / anon から revoke
--    ★ PostgreSQL の列権限は「table 全体 GRANT があると列 GRANT は無効
--      (table 権限が全列を覆う)」ため、列を絞るには *先に* table 権限を
--      revoke してから列 GRANT を撒く順序が必須。
-- ----------------------------------------------------------------
revoke update on public.posts from authenticated;
revoke update on public.posts from anon;

-- ----------------------------------------------------------------
-- 3) 編集可能列だけを列単位 GRANT で authenticated に許可
--    = updatePost が触る 10 列 + togglePostQAMode の qa_mode。
--    これ以外 (likes_count / comments_count / concern_count / score /
--    hot_score / visibility / is_public / is_hidden / author_id 等) は
--    authenticated から直 UPDATE 不可になる。
-- ----------------------------------------------------------------
grant update (
  content,
  title,
  tag_names,
  content_warning,
  cw_category,
  media_urls,
  media_blurhashes,
  video_urls,
  video_durations,
  video_posters,
  qa_mode
) on public.posts to authenticated;

-- ----------------------------------------------------------------
-- 4) service_role は従来通り table 全体 UPDATE を維持 (防御的に明示)
--    automod-eval Edge Function が is_hidden/tag_names を書くため。
--    service_role は anon/authenticated への revoke の影響を受けないが、
--    意図を自己文書化 + 環境差吸収のため明示 grant しておく。
-- ----------------------------------------------------------------
grant update on public.posts to service_role;

-- ============================================================
-- 検証 SQL (適用後に Supabase SQL エディタで実行 = 静的確認)
-- ============================================================
-- (1) counter 関数が DEFINER + search_path 付きか
--   select p.proname, p.prosecdef as is_definer, p.proconfig
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public'
--     and p.proname in ('update_likes_count','update_comments_count','update_concern_count')
--     and p.pronargs = 0;
--   → 期待: is_definer = t / proconfig = {search_path=public\, pg_catalog}
--
-- (2) authenticated の posts UPDATE 列権限がホワイトリスト 11 列だけか / anon は 0 行か
--   select grantee, column_name
--   from information_schema.column_privileges
--   where table_schema='public' and table_name='posts'
--     and privilege_type='UPDATE' and grantee in ('authenticated','anon')
--   order by grantee, column_name;
--   → 期待: authenticated = content/title/tag_names/content_warning/cw_category/
--           media_urls/media_blurhashes/video_urls/video_durations/video_posters/qa_mode
--           (11 行)。anon = 0 行。
--
-- (3) authenticated/anon に posts の *table 全体* UPDATE が残っていないか
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name='posts'
--     and privilege_type='UPDATE' and grantee in ('authenticated','anon');
--   → 期待: 0 行 (table 全体 UPDATE は revoke 済。列単位は (2) 側にだけ出る)
--
-- ============================================================
-- 実機での振る舞い確認 (認証済みセッション / アプリで)
-- ============================================================
--   (a) ★最重要・本番反映前に必須★ いいね/気になる/コメントで
--       likes_count / concern_count / comments_count が増減する
--       (= DEFINER 化後も counter が壊れない)。ローカル/preview で目視確認。
--   (b) 自分の投稿の編集 (updatePost) と Q&A モード切替 (togglePostQAMode) が通る。
--   (c) 自分の投稿に counter/visibility を直 UPDATE すると権限エラーで弾かれる:
--         update public.posts set likes_count = 99999 where id = '<自分のpostId>';
--         → ERROR: 42501 permission denied for column likes_count
--       visibility / is_public / score / hot_score / comments_count / concern_count
--       でも同様に 42501 になることを確認。
--   (d) admin の投稿削除 (admin_delete_post) / automod hide (Edge Fn, service_role)
--       が従来通り動く。
--
-- rollback (緊急時 — 列ロックだけ解除して元の挙動に戻す):
--   grant update on public.posts to authenticated;   -- ★これで元の穴に戻る
--   -- DEFINER 化 (1) は revert しないこと: 列ロック解除前に DEFINER を戻すと
--   --   counter が壊れる。完全 revert したい場合は上の grant の *後* に
--   --   alter function ... security invoker; を流す。
-- ============================================================

select '0134 完了 — counter トリガ(update_likes_count/update_comments_count/update_concern_count) を SECURITY DEFINER 化 + posts の table UPDATE を revoke し編集可能 11 列のみ列GRANT。counter/visibility/is_public の直 REST 改竄を封じた。' as note;
