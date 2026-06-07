-- ============================================================
-- 0127_revoke_profiles_public.sql — de-anon Phase2 / Stage 3
-- ------------------------------------------------------------
-- profiles_public(view, 0081)は (id, nickname, avatar_url, avatar_emoji) を
-- anon/authenticated に公開しており、「投稿の avatar_url → profiles_public で照合 →
-- nickname 特定」という、擬似ハンドルを実名に逆引きできる oracle になっていた。
--
-- 調査結果: client は profiles_public を一切読んでいない (0 箇所。直の base table /
-- マスク RPC 経由のみ)。したがって SELECT を REVOKE しても client は壊れない
-- (旧バイナリ含む)。→ native OTA を待つ必要はなく、いつでも単独適用してよい。
--
-- view 本体は DROP せず残す (将来 admin/server 用途で narrow に grant し直せるように)。
-- ★ 不変条件: profiles_public に pseudonym_id を絶対に足さない (0116 の警告)。足すと
--   token→nickname の逆引きが復活する。
-- 冪等: REVOKE は重複実行で error にならない。
-- ============================================================

revoke select on public.profiles_public from anon;
revoke select on public.profiles_public from authenticated;

select '0127 完了 — profiles_public の anon/authenticated SELECT を REVOKE (avatar→nickname の逆引き oracle を遮断)。client は未使用なので無破壊。' as note;
