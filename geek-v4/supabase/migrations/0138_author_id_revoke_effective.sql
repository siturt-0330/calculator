-- ============================================================
-- 0138_author_id_revoke_effective.sql
--   0129 の de-anon backstop (posts/comments.author_id 列 SELECT REVOKE) を
--   「本当に効く」形に作り直す (BACKSTOP・★最後に適用)
-- ------------------------------------------------------------
-- ◆ なぜ 0129 は no-op だったか (PostgreSQL 仕様):
--   列単位 REVOKE は「table 全体 SELECT 権限」を差し引けない。ある列の実効
--   SELECT 権限 = (table 全体 SELECT) OR (列単位 SELECT) で評価されるため、
--   table 全体 SELECT を持つロールに対して `revoke select (author_id)` を撃っても
--   table 権限側が author_id を覆い続け、author_id は読めたままになる。
--   Supabase は project 既定で `grant all on all tables in schema public to
--   anon, authenticated` を撒く (= posts/comments に table 全体 SELECT)。この
--   既定 grant を取り消す migration は存在しない (grep 済) ため、0129 の
--   `revoke select (author_id)` 4 行は実効ゼロ = 匿名投稿者の author_id は
--   依然 anon/authenticated が直 REST で読める = de-anon backstop が効いていない。
--   ※ posts/comments の RLS は `for select using (true)` (誰でも全行読める) なので、
--     author_id を守れるのは列権限だけ。RLS では列を隠せない。
--
-- ◆ 正しい形 (= 0134_post_column_update_hardening の SELECT 版):
--   「table 全体 SELECT を先に REVOKE → author_id を除く全列を列 GRANT」の順序。
--   こうすると author_id だけが列 GRANT から漏れ、table 権限も無いので読めなくなる。
--   他の全列は列 GRANT で覆われるのでフィード/検索/詳細は従来どおり動く。
--   (UPDATE 側は 0134 が同じ「table revoke → 列 GRANT」を実装済。これはその SELECT 版。)
--
-- ◆ 列リストは動的取得 (information_schema) にしてある理由:
--   posts は 0001〜 多数の migration で列が増えており、手で列挙すると 1 つでも
--   取りこぼすとその列がフィード/検索で permission denied になり全 post 取得が壊れる。
--   information_schema.columns から「author_id 以外の現存全列」を引いて GRANT すれば
--   取りこぼし得ない (スキーマ drift にも追従)。author_id は posts/comments で唯一の
--   ユーザ identity 列 (→auth.users) で、他列は本文/メディア/カウンタ等の非識別情報。
--   従って「author_id 以外を全部 GRANT」は de-anon 目的に対して過不足ない。
--
-- ◆ 構造 (★SQL エディタの statement splitter 対策):
--   table ごとに「列リスト算出 → table SELECT revoke → 列 GRANT → 不変条件 assert」
--   を 1 つの do ブロック (= 単一ステートメント) に閉じ込めてある。assert が破れると
--   その do ブロックの revoke/grant ごと rollback される (statement 単位の原子性)。
--   これで editor が `;` で分割して各文を別送しても「revoke だけ通って grant 前に
--   中断 → フィード全死」のような中途半端な状態が残らない。
--   (plpgsql は文と文の間で command counter を上げるので、GRANT 直後の
--    information_schema 参照はその GRANT を反映した状態を見る。)
--
-- ◆ 非対象 (触らない):
--   - INSERT/UPDATE 権限 (createPost/createComment が author_id を書く)。RLS で保護済。
--   - service_role (列権限 bypass)。明示はしないが影響を受けない。
--   - SECURITY DEFINER RPC (get_home_feed / get_feed_page / get_community_feed /
--     get_post_comments / get_my_posts / get_my_comments / admin_* / delete_account 等)。
--     owner 権限で動くため列 SELECT 権限の影響外。これらが author_id を server 側で
--     マスクして供給する正経路。
--   - realtime payload (useFeed/useUserChannel の posts/comments 変更購読) は
--     ★この REVOKE では塞がらない (Realtime は列 SELECT 権限を尊重せず WAL の全列を
--     配信する)。realtime の author_id 漏れは client 側 allowlist pick で別途対応する
--     (このファイルの責務外。de-anon Phase2 の realtime 項目)。逆に言えば REVOKE で
--     realtime が壊れることも無い。
--
-- ============================================================
-- ★★★ 適用前提 (すべて満たすまで適用しないこと。打つと下記が壊れる) ★★★
-- ------------------------------------------------------------
--   (1) ★未対応の既知ブロッカー★ lib/api/account.ts の exportUserData (GDPR
--       データエクスポート) が `supabase.from('posts'|'comments').select('*')
--       .eq('author_id', uid)` で自分の投稿/コメントを引いている。これは常時・
--       認証経路・RPC primary 無しなので、本 REVOKE 後は permission denied で
--       catch され「自分の posts/comments がエクスポートから黙って欠落」する
--       (クラッシュではないが GDPR 開示の欠落 = 退行)。先に exportUserData を
--       auth.uid() ベース (get_my_posts / get_my_comments RPC 等) に直してから
--       適用すること。deleteAccount の REST フォールバック (delete().eq('author_id'))
--       も同様だが、delete_account RPC (0077) が primary なら通常は到達しない。
--   (2) author_id を REST で読む経路がすべて SECURITY DEFINER RPC primary に
--       なっており、その RPC が prod に適用済みであること。RPC 未適用だと
--       author_id を読む REST フォールバックに落ちて permission denied で壊れる:
--         - comments 表示:   get_post_comments        (0125)  ← tier0
--         - 自分のコメント:  get_my_comments          (0130)
--         - 自分の投稿:      get_my_posts             (0117 / 0131)
--         - コミュニティ:    get_community_feed       (0042 / 0112)
--         - admin 各種:      admin_* RPC 群           (0128)
--         - 退会:            delete_account           (0077)
--   (3) author_id を一切 select しない client が web + native(OTA) に行き渡って
--       いること (= 旧バイナリが posts/comments の author_id を直 select しない)。
--       feed/post 詳細/my-posts は対応済 (POSTS_SELECT_COLS に author_id 無し)。
--       ※ 適用順: 「author_id-free client を先に deploy → 後で本 REVOKE 適用」。
--         逆順だと旧 client の直 select が PostgREST 400 になる。
--
-- ◆ デプロイ(本番反映)はユーザ明示指示時のみ。本番は Supabase SQL エディタで
--   手動適用 (他 migration と同様)。適用後は下記「検証 SQL」を必ず流すこと。
-- ◆ 冪等: revoke / grant / do ブロックは重複実行で error にならない。何度流しても同じ最終状態。
-- ============================================================

-- ----------------------------------------------------------------
-- 1) posts: 列リスト算出 → table SELECT revoke → author_id 以外を列 GRANT → assert
-- ----------------------------------------------------------------
do $$
declare
  cols    text;
  leaked  text;
  missing text;
begin
  -- author_id を除く現存全列を ', ' 連結 (識別子は quote_ident で安全化)
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'posts'
    and column_name <> 'author_id';
  if cols is null then
    raise exception 'abort 0138: public.posts の列が取得できませんでした (table 不在?)';
  end if;

  -- table 全体 SELECT を revoke してから、author_id 以外の全列を列 GRANT
  revoke select on public.posts from authenticated, anon;
  execute format('grant select (%s) on public.posts to authenticated, anon', cols);

  -- (A) security: author_id が anon/authenticated に SELECT 可能なまま残っていないか
  select string_agg(distinct grantee, ', ')
    into leaked
  from information_schema.role_column_grants
  where table_schema = 'public' and table_name = 'posts'
    and column_name = 'author_id' and privilege_type = 'SELECT'
    and grantee in ('anon', 'authenticated');
  if leaked is not null then
    raise exception 'abort 0138/posts (A): author_id が % にまだ SELECT 可能 = de-anon backstop が効いていません', leaked;
  end if;

  -- (B) availability: author_id 以外の全列が authenticated に GRANT 済か (anon も同一文で GRANT)
  select string_agg(c.column_name, ', ')
    into missing
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'posts'
    and c.column_name <> 'author_id'
    and not exists (
      select 1 from information_schema.role_column_grants g
      where g.table_schema = 'public' and g.table_name = 'posts'
        and g.column_name = c.column_name
        and g.grantee = 'authenticated' and g.privilege_type = 'SELECT'
    );
  if missing is not null then
    raise exception 'abort 0138/posts (B): 次の列が authenticated に GRANT されていません = フィード/検索が壊れます: %', missing;
  end if;

  raise notice '0138 posts: SELECT granted (author_id を除く全列): %', cols;
end $$;

-- ----------------------------------------------------------------
-- 2) comments: 同様 (author_id 以外の全列を列 GRANT)
-- ----------------------------------------------------------------
do $$
declare
  cols    text;
  leaked  text;
  missing text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'comments'
    and column_name <> 'author_id';
  if cols is null then
    raise exception 'abort 0138: public.comments の列が取得できませんでした (table 不在?)';
  end if;

  revoke select on public.comments from authenticated, anon;
  execute format('grant select (%s) on public.comments to authenticated, anon', cols);

  select string_agg(distinct grantee, ', ')
    into leaked
  from information_schema.role_column_grants
  where table_schema = 'public' and table_name = 'comments'
    and column_name = 'author_id' and privilege_type = 'SELECT'
    and grantee in ('anon', 'authenticated');
  if leaked is not null then
    raise exception 'abort 0138/comments (A): author_id が % にまだ SELECT 可能 = de-anon backstop が効いていません', leaked;
  end if;

  select string_agg(c.column_name, ', ')
    into missing
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'comments'
    and c.column_name <> 'author_id'
    and not exists (
      select 1 from information_schema.role_column_grants g
      where g.table_schema = 'public' and g.table_name = 'comments'
        and g.column_name = c.column_name
        and g.grantee = 'authenticated' and g.privilege_type = 'SELECT'
    );
  if missing is not null then
    raise exception 'abort 0138/comments (B): 次の列が authenticated に GRANT されていません = コメントが壊れます: %', missing;
  end if;

  raise notice '0138 comments: SELECT granted (author_id を除く全列): %', cols;
end $$;

-- ============================================================
-- 検証 SQL (適用後に Supabase SQL エディタで実行)
-- ============================================================
-- (1) table 全体 SELECT が anon/authenticated から消えているか
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name in ('posts','comments')
--     and grantee in ('authenticated','anon') and privilege_type='SELECT';
--   → 期待: 0 行 (table 全体 SELECT は revoke 済。列単位は (2) 側にだけ出る)
--
-- (2) author_id が anon/authenticated の SELECT 列権限に *無い* こと
--   select grantee, table_name, column_name
--   from information_schema.role_column_grants
--   where table_schema='public' and table_name in ('posts','comments')
--     and column_name='author_id' and privilege_type='SELECT'
--     and grantee in ('authenticated','anon');
--   → 期待: 0 行 (author_id は誰にも列 GRANT していない)
--
-- (3) author_id 以外の列は GRANT されていること (列数で確認)
--   select grantee, table_name, count(*) as granted_cols
--   from information_schema.role_column_grants
--   where table_schema='public' and table_name in ('posts','comments')
--     and privilege_type='SELECT' and grantee in ('authenticated','anon')
--   group by grantee, table_name order by table_name, grantee;
--   → 期待: 各 table とも (全列数 - 1) 件ずつ (authenticated / anon)。
--
-- (4) 認証ロールでの直読み再現 (author_id だけが弾かれることを確認)
--   begin;
--     set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
--     set local role authenticated;
--     select id, content from public.posts limit 1;     -- ✅ 読める (権限あり)
--     select author_id   from public.posts limit 1;     -- ❌ ERROR 42501 permission denied for column author_id
--   rollback;
--   (comments も同様: select author_id from public.comments → 42501)
--
-- ============================================================
-- 実機での振る舞い確認 (★ 本番反映前にローカル/preview で必須)
-- ============================================================
--   (a) フィード (hot/new/top/for-you/rising) が従来どおり全件描画される
--       (= author_id 以外の列 GRANT 漏れが無い = permission denied が出ない)。
--   (b) 投稿詳細 / コメント表示 / 自分の投稿(mypage) / 自分のコメント /
--       コミュニティタブ / 検索 hydrate が壊れない (= RPC primary が効いている)。
--   (c) GDPR エクスポート (exportUserData) で自分の posts/comments が
--       含まれている (= 適用前提(1) の exportUserData 改修が済んでいる)。
--   (d) 退会 (deleteAccount) で自分の posts/comments が実際に削除される
--       (= delete_account RPC が効いている / REST フォールバックに落ちていない)。
--
-- rollback (壊れたら即戻す — 元の「table 全体 SELECT」状態に復帰):
--   grant select on public.posts    to authenticated, anon;
--   grant select on public.comments to authenticated, anon;
--   -- ↑ これで author_id も再び読めるようになる (= 0129 適用前の状態)。列 GRANT は
--   --   table GRANT に覆われるので別途 revoke 不要 (冪等)。
-- ============================================================

select '0138 完了 — posts/comments の table 全体 SELECT を anon/authenticated から revoke し、author_id を除く全列を列 GRANT。0129 の no-op を是正し author_id 直 REST 読み取りを封じた (de-anon backstop)。★適用前提: exportUserData の author_id 非依存化 + 各 de-anon RPC の prod 適用 + author_id-free client deploy。' as note;
