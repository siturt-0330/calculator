-- ============================================================
-- 0110: コミュニティ ピン留め投稿 (community_pinned_posts)
-- ============================================================
-- 目的:
--   コミュ管理人 (mod = owner / admin) が、そのコミュニティの ホーム フィード
--   先頭に「ピン留め」できる投稿を管理する中間テーブルを追加する。
--
-- 設計:
--   - posts は community_id 列を持たない (post_communities 中間テーブル 0023)。
--     ピン留めも同様に (community_id, post_id) の中間テーブルで表現する。
--   - 並びは pinned_at desc (最後にピン留めしたものが上)。
--   - mod 判定は 0068 で導入済みの public.is_community_mod(community_id) を再利用。
--   - 1 コミュニティあたりのピン留め上限は 5 件 (BEFORE INSERT trigger で enforce)。
--
-- 既存フローは破壊しない:
--   - posts / post_communities / communities には一切 alter を掛けない。
--   - 全 statement は idempotent
--     (create table if not exists / drop policy if exists then create /
--      create or replace function / drop trigger if exists then create)。
-- ============================================================

set local statement_timeout = '5min';

-- ============================================================
-- 1) community_pinned_posts テーブル
-- ============================================================
create table if not exists public.community_pinned_posts (
  community_id uuid not null references public.communities(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  pinned_by uuid not null references auth.users(id),
  pinned_at timestamptz not null default now(),
  primary key (community_id, post_id)
);

-- コミュ詳細フィードのピン留め取得用 (新しくピン留めした順)
create index if not exists community_pinned_posts_community_idx
  on public.community_pinned_posts(community_id, pinned_at desc);

-- post 削除時の逆引き / cascade 補助
create index if not exists community_pinned_posts_post_idx
  on public.community_pinned_posts(post_id);

alter table public.community_pinned_posts enable row level security;

-- ============================================================
-- 2) RLS
-- ============================================================
-- SELECT: 認証済みなら誰でも参照可 (実際の投稿閲覧可否は posts 側 RLS で担保)。
--   anon (未ログイン) には見せない — community フィードは認証前提。
drop policy if exists "community_pinned_posts_select" on public.community_pinned_posts;
create policy "community_pinned_posts_select" on public.community_pinned_posts
  for select to authenticated using (true);

-- INSERT: 対象コミュの mod (owner / admin) のみ。pinned_by は本人に限定。
drop policy if exists "community_pinned_posts_insert" on public.community_pinned_posts;
create policy "community_pinned_posts_insert" on public.community_pinned_posts
  for insert to authenticated with check (
    pinned_by = auth.uid()
    and public.is_community_mod(community_id)
  );

-- DELETE: 対象コミュの mod (owner / admin) のみ (= 解除)。
drop policy if exists "community_pinned_posts_delete" on public.community_pinned_posts;
create policy "community_pinned_posts_delete" on public.community_pinned_posts
  for delete to authenticated using (
    public.is_community_mod(community_id)
  );

-- ============================================================
-- 3) ピン留め上限 (1 コミュニティ 5 件) を enforce する trigger
-- ============================================================
-- BEFORE INSERT で現在のピン数を数え、5 件以上なら例外。
-- (race で僅かに超過する可能性はあるが、UI 体験上の上限なので許容。
--  厳密一意制約ではなく soft cap。)
create or replace function public.enforce_pinned_posts_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  pin_count integer;
begin
  select count(*) into pin_count
  from public.community_pinned_posts
  where community_id = new.community_id;

  if pin_count >= 5 then
    raise exception 'pinned_posts_cap_exceeded'
      using hint = 'このコミュニティでピン留めできる投稿は最大 5 件です。';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_pinned_posts_cap on public.community_pinned_posts;
create trigger trg_enforce_pinned_posts_cap
  before insert on public.community_pinned_posts
  for each row
  execute function public.enforce_pinned_posts_cap();

select '0110_community_pinned_posts 完了: community_pinned_posts + cap trigger' as result;
