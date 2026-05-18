-- ============================================================
-- 0015: アカウント完全削除 + データエクスポート権限
-- ============================================================
-- GDPR Right to Erasure / 個人情報保護法の利用停止・消去請求への対応
--
-- 設計:
--   - 過去 migration が順不同で適用される可能性に備え、
--     各テーブルが存在するか確認してから RLS ポリシーを貼る
--   - delete_account() RPC も同じく to_regclass で存在チェック
--   - 存在しないテーブルは silently skip するので何度でも安全に再実行可能
-- ============================================================

-- ============================================================
-- ヘルパー: テーブルが存在する時だけ DELETE ポリシーを貼る
-- ============================================================
do $$
declare
  rec record;
  -- 対象テーブルと、本人レコードを判定する列名のペア
  targets text[] := array[
    'profiles=id',
    'likes=user_id',
    'post_reactions=user_id',
    'bbs_reply_reactions=user_id',
    'saves=user_id',
    'bookmark_collections=user_id',
    'tag_subscriptions=user_id',
    'user_liked_tags=user_id',
    'user_blocked_tags=user_id',
    'user_stamps=user_id',
    'saved_searches=user_id',
    'notifications=user_id',
    'concerns=user_id'
  ];
  pair text;
  tbl text;
  col text;
  pol_name text;
begin
  foreach pair in array targets loop
    tbl := split_part(pair, '=', 1);
    col := split_part(pair, '=', 2);
    -- そのテーブルが実在するか
    if to_regclass('public.' || tbl) is not null then
      pol_name := tbl || ' delete own';
      execute format('drop policy if exists %I on public.%I', pol_name, tbl);
      execute format(
        'create policy %I on public.%I for delete using (auth.uid() = %I)',
        pol_name, tbl, col
      );
    end if;
  end loop;
end
$$;

-- ============================================================
-- 2) RPC: delete_account()
-- ============================================================
-- 本人レコードを全テーブルからまとめて削除する。
-- to_regclass で存在チェックして、無いテーブルは skip。
-- ============================================================
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pair text;
  tbl text;
  col text;
  targets text[] := array[
    'likes=user_id',
    'post_reactions=user_id',
    'bbs_reply_reactions=user_id',
    'concerns=user_id',
    'saves=user_id',
    'bookmark_collections=user_id',
    'saved_searches=user_id',
    'tag_subscriptions=user_id',
    'user_liked_tags=user_id',
    'user_blocked_tags=user_id',
    'user_stamps=user_id',
    'notifications=user_id',
    'comments=author_id',
    'bbs_replies=author_id',
    'posts=author_id',
    'bbs_threads=author_id',
    'profiles=id'
  ];
begin
  if uid is null then
    raise exception 'unauthenticated';
  end if;

  foreach pair in array targets loop
    tbl := split_part(pair, '=', 1);
    col := split_part(pair, '=', 2);
    if to_regclass('public.' || tbl) is not null then
      execute format('delete from public.%I where %I = $1', tbl, col) using uid;
    end if;
  end loop;
end;
$$;

revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;

-- ============================================================
-- 3) 監査用: deletion_log
-- ============================================================
create table if not exists public.deletion_log (
  id bigserial primary key,
  user_id_hash text not null,  -- 元 UUID を sha256 した hash のみ (再特定不可)
  deleted_at timestamptz not null default now()
);
alter table public.deletion_log enable row level security;
revoke all on public.deletion_log from public;
