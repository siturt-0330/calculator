-- ============================================================
-- cleanup_seed_and_orphans.sql
-- ============================================================
-- 目的: ダミー seed データ + コミュニティ未所属(public)投稿を一掃し、
--       コミュニティ所属投稿(community_public)と実ユーザーだけ残す
--       「クリーンスレート」化。
--
-- ⚠️ 不可逆。本番DBで実行する前に必ずバックアップを取ること:
--    Supabase Dashboard → Database → Backups (または pg_dump)。
--
-- 実行場所: Supabase SQL Editor (service role 権限で RLS をバイパス)。
-- 実行手順: STEP 1 を実行して件数を確認 → STEP 2 を実行 →
--           最後の残数 SELECT を見て、想定どおりなら COMMIT、
--           おかしければ ROLLBACK (打ち間違い・想定外を巻き戻せる)。
--
-- 削除対象:
--   A) ダミー seed ユーザー  = auth.users.email LIKE '%@geek-seed.example'
--      → FK ON DELETE CASCADE で その投稿/コメント/BBS/リアクション/profiles も連動削除
--   B) コミュニティ未所属の投稿 = post_communities に1行も無い posts
--      → 〃 で comments/reactions/post_communities 等も連動削除
-- 残るもの: コミュニティ所属(community_public)投稿 + 非ダミー実ユーザー。
-- 注意: 検索ベンチ(search_bench_*)や 0033 公式コミュニティ(Geek公式)は対象外(残す)。
-- ============================================================


-- ============================================================
-- STEP 1: 事前確認 (これだけ先に実行して数字を見る。何も消えない)
-- ============================================================
SELECT 'ダミーseedユーザー'              AS label, count(*) AS cnt
  FROM auth.users WHERE email LIKE '%@geek-seed.example'
UNION ALL
SELECT 'ダミーユーザーの投稿(参考)',        count(*)
  FROM posts
 WHERE author_id IN (SELECT id FROM auth.users WHERE email LIKE '%@geek-seed.example')
UNION ALL
SELECT 'コミュニティ未所属(orphan)投稿',    count(*)
  FROM posts p
 WHERE NOT EXISTS (SELECT 1 FROM post_communities pc WHERE pc.post_id = p.id)
UNION ALL
SELECT '残る予定: コミュニティ所属投稿',     count(*)
  FROM posts p
 WHERE EXISTS (SELECT 1 FROM post_communities pc WHERE pc.post_id = p.id)
UNION ALL
SELECT '投稿 総数(現在)',                  count(*) FROM posts;
-- 期待値の目安: orphan投稿 ≒ 1265 / 残る所属投稿 ≒ 51 / 総数 ≒ 1316


-- ============================================================
-- STEP 2: 削除 (トランザクション。最後の残数を見てから COMMIT する)
-- ============================================================
BEGIN;

-- A) ダミー seed ユーザーと全関連データ (CASCADE)
DELETE FROM auth.users
 WHERE email LIKE '%@geek-seed.example';

-- B) コミュニティ未所属の投稿 (A で消えた分を除いた残りの orphan)
DELETE FROM posts p
 WHERE NOT EXISTS (SELECT 1 FROM post_communities pc WHERE pc.post_id = p.id);

-- 残数確認 (COMMIT 前に必ず目視)
SELECT 'remaining_posts(=所属投稿のみのはず)' AS label, count(*) AS cnt FROM posts
UNION ALL
SELECT 'remaining_orphan(=0のはず)',
       count(*) FROM posts p
       WHERE NOT EXISTS (SELECT 1 FROM post_communities pc WHERE pc.post_id = p.id)
UNION ALL
SELECT 'remaining_dummy_users(=0のはず)',
       count(*) FROM auth.users WHERE email LIKE '%@geek-seed.example';

-- ↑ remaining_posts ≒ 51 / remaining_orphan = 0 / remaining_dummy_users = 0 なら:
COMMIT;
-- ↑ 数字がおかしい・想定外なら、COMMIT の代わりに次を実行して全部巻き戻す:
-- ROLLBACK;
