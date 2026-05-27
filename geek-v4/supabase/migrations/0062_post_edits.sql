-- 0062: 投稿の編集履歴 (post_edits) — Reddit ガイド 2.11 章
-- ============================================================
-- ジャーナリズム的価値 + 事後改変による誤情報拡散の抑制のため、
-- 投稿 UPDATE 時に過去版の content を post_edits に保持する。
--
-- 仕様:
--   - 最新 3 版だけ keep (古いものは trigger で自動削除)
--   - SELECT は「投稿が見える人なら誰でも見える」 (透明性のため)
--   - INSERT は trigger 経由 (SECURITY DEFINER) のみ — クライアントから
--     直接 insert/update/delete はできない (RLS で deny default)
--
-- 設計判断:
--   - prev_content のみ保持 (媒体は対象外) — 媒体差し替えはほぼ無く、
--     誤情報拡散の主因はテキストの書き換えなので、本機能のスコープは
--     content に絞る。
--   - posts.content の UPDATE trigger は OF content で発火条件を絞り、
--     他カラム更新時 (like_count 等) には走らないようにする。
--   - 3 件超え時の DELETE は同 trigger 内で行い、別バッチを不要にする。
-- ============================================================

set local statement_timeout = '5min';

-- ----------------------------------------------------------------
-- 1) post_edits テーブル本体
-- ----------------------------------------------------------------
create table if not exists public.post_edits (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  prev_content text not null,
  edited_at timestamptz not null default now()
);

-- 「post_id でグルーピング、edited_at 降順で並べる」検索専用 index。
-- fetchPostEditHistory が "where post_id = $1 order by edited_at desc"
-- なので index 1 本でカバー。
create index if not exists post_edits_post_idx
  on public.post_edits(post_id, edited_at desc);

-- ----------------------------------------------------------------
-- 2) RLS
-- ----------------------------------------------------------------
alter table public.post_edits enable row level security;

-- SELECT: 投稿が見える人なら誰でも編集履歴も見える (透明性のため)。
-- posts 側の RLS をパススルー — posts に SELECT 権限があれば
-- exists() が true になり、編集履歴も読める。
drop policy if exists "post_edits_read" on public.post_edits;
create policy "post_edits_read" on public.post_edits
  for select using (
    exists (
      select 1 from public.posts p
      where p.id = post_edits.post_id
      -- posts の RLS は省略 (SELECT 可能なら edit も見えるという defer)
    )
  );

-- INSERT/UPDATE/DELETE policy は意図的に作らない (= deny by default)。
-- 後述の trigger が SECURITY DEFINER で挿入を行うため、クライアントから
-- 直接いじる経路は完全に閉じる。

-- ----------------------------------------------------------------
-- 3) trigger function — content UPDATE 時に過去版を保存
-- ----------------------------------------------------------------
-- security definer で実行することで RLS をバイパスして insert/delete
-- できる。search_path は public, pg_catalog に固定 (security hardening
-- 0053 と同じ流儀) して、検索パスハイジャック攻撃を防ぐ。
create or replace function public.save_post_edit_history()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  edit_count int;
begin
  -- 「content が実際に変わったときだけ保存」
  -- is distinct from は NULL 安全な比較 (= だと NULL=NULL が NULL になる)。
  -- posts.content は NOT NULL だが、将来の schema 変更に備えて防御的に書く。
  if NEW.content is distinct from OLD.content then
    insert into public.post_edits (post_id, prev_content)
    values (NEW.id, OLD.content);

    -- 3 件超え → 古いものから削除して 3 件に切り詰める
    -- 過去版が増え続けると storage が爆発するので、Reddit ガイド指定の
    -- 「最新 3 版」cap を trigger 内で enforce。
    select count(*) into edit_count from public.post_edits where post_id = NEW.id;
    if edit_count > 3 then
      delete from public.post_edits
      where id in (
        select id from public.post_edits
        where post_id = NEW.id
        order by edited_at asc
        limit edit_count - 3
      );
    end if;
  end if;
  return NEW;
end;
$$;

-- ----------------------------------------------------------------
-- 4) trigger 本体
-- ----------------------------------------------------------------
-- UPDATE OF content で発火条件を絞る — likes_count 等の UPDATE では
-- 走らないので、無駄な比較・挿入を avoid。
drop trigger if exists trg_save_post_edit on public.posts;
create trigger trg_save_post_edit
  after update of content on public.posts
  for each row execute function public.save_post_edit_history();
