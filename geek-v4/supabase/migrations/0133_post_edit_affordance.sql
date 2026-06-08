-- ============================================================
-- 0133_post_edit_affordance.sql — 投稿の後編集機能 (著者が自分の投稿を編集)
-- ------------------------------------------------------------
-- 目的:
--   (1) posts.edited_at を追加 — 「本文/メディアが実際に編集された時刻」専用。
--       既存 updated_at は posts_touch_trg (0014) が like/comment 等あらゆる UPDATE
--       で now() にするため「編集済み」判定には使えない。content/media/video が
--       実変化した時だけ edited_at を BEFORE トリガでスタンプする。
--       ★ AFTER トリガでは NEW 書き換えが列に反映されないため必ず BEFORE。
--   (2) posts_update RLS に with check を追加 — 現状 using のみで、編集経路から
--       author_id を他人に書き換える所有権移転/なりすましが可能だった。
--   (3) ★セキュリティ硬化: 編集経路(直 REST 含む)で「作成後どの正規経路でも更新
--       しない・かつ改竄されると重大な列」を BEFORE トリガで OLD に固定する。
--          - author_id          (なりすまし/所有権移転)
--          - is_anonymous       (過去の匿名投稿の実名化 = de-anon)
--          - trust_score_at_post(信用ティア表示の捏造)
--          - created_at         (時系列偽装)
--       これらは作成時のみ設定され、counter トリガ等も触らないため OLD 固定で
--       副作用ゼロ。like 集計など正規 UPDATE には影響しない。
--
--   ⚠ 申し送り (別対応): likes_count / comments_count / concern_count / score /
--      hot_score / visibility / is_public の改竄封じは、ここでは行わない。
--      カウンタ列は update_likes_count 等 (0001/0006/0010, いずれも SECURITY
--      INVOKER) が UPDATE するため、列を凍結 or 列 GRANT で revoke すると like を
--      押した瞬間に権限エラー/集計停止で壊れる。正しくはカウンタトリガを
--      SECURITY DEFINER 化した上で列 GRANT する別 migration が必要 (要テスト)。
--      これは編集機能が無くても元から存在する穴 (posts_update は元々列無制限)。
--
-- 匿名性: 本 migration は author_id を一切 SELECT/RETURN しない。edited_at は
--   author を露出しない。フィード RPC は今回触らない (de-anon マスク回帰回避)。
--
-- 冪等: add column if not exists / create or replace / drop trigger if exists →
--   create / drop policy if exists → create。
--   ★本番は Supabase SQL エディタで手動適用が必要 (他 migration と同様)。
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) edited_at カラム (NULL = 一度も編集されていない = バッジ非表示)
-- ----------------------------------------------------------------
alter table public.posts add column if not exists edited_at timestamptz;

-- ----------------------------------------------------------------
-- 2)+3) BEFORE UPDATE トリガ: 保護列を OLD 固定 + content/media/video 変化時に
--        edited_at をスタンプ。★全 UPDATE で発火させる (列限定にすると
--        is_anonymous だけを撃つ攻撃でトリガが走らず凍結が効かないため)。
-- ----------------------------------------------------------------
create or replace function public.stamp_post_edited_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- 作成後どの正規経路でも更新しない・改竄されると重大な列を OLD に固定。
  -- (counter 列 likes_count 等はここでは固定しない = 集計を壊さない)
  NEW.author_id           := OLD.author_id;
  NEW.is_anonymous        := OLD.is_anonymous;
  NEW.trust_score_at_post := OLD.trust_score_at_post;
  NEW.created_at          := OLD.created_at;

  -- 本文 / 画像 / 動画 が実際に変わった時だけ「編集済み」をスタンプ。
  -- (media だけ差し替える無痕跡 bait-and-switch を防ぐため media/video も対象)
  if NEW.content is distinct from OLD.content
     or NEW.media_urls is distinct from OLD.media_urls
     or NEW.video_urls is distinct from OLD.video_urls then
    NEW.edited_at := now();
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_stamp_post_edited_at on public.posts;
create trigger trg_stamp_post_edited_at
  before update on public.posts
  for each row execute function public.stamp_post_edited_at();

-- ----------------------------------------------------------------
-- 4) posts_update に with check を追加 (author_id 改竄の二重防御)
--    元 (0001) は `for update using (auth.uid() = author_id)` のみ。
-- ----------------------------------------------------------------
drop policy if exists "posts_update" on public.posts;
create policy "posts_update" on public.posts
  for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

select '0133 完了 — posts.edited_at 追加 + BEFORE トリガ(保護列OLD固定: author_id/is_anonymous/trust_score_at_post/created_at, content/media/video変化でedited_atスタンプ) + posts_update に with check' as note;
