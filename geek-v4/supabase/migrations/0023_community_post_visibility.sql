-- ============================================================
-- 0023: コミュニティ投稿可視性 + マルチ所属 + 聖地 / カレンダー
-- ============================================================
-- 目的:
--   1) posts に 4-way visibility (private / public / community_only / community_public)
--   2) posts <-> communities の M:N (post_communities 中間テーブル)
--   3) bbs_threads に community_id + 2-way visibility (public / community_only)
--   4) community_spots テーブル (聖地マップ — メンバー全員作成可)
--   5) community_events テーブル (カレンダー — メンバー全員作成可)
--   6) can_view_post() ヘルパー関数 (将来 RLS 拡張 / クライアントフィルタ用)
--
-- 既存フロー (posts / bbs_threads / communities) は破壊しない:
--   - posts.is_public カラムはそのまま残す (visibility はその上にレイヤーする)
--   - 既存 posts は default 'public' に backfill
--   - 既存 bbs_threads は default 'public' / community_id=null
-- ============================================================

-- ============================================================
-- 1) posts.visibility カラム追加
-- ============================================================
-- 4-way:
--   private          : 自分だけ (下書き / メモ)
--   public           : 既存挙動 (誰でも、ホームに出る)
--   community_only   : attach された community のメンバーだけ
--   community_public : 誰でも見える + community にも掲載 (cross-post)
alter table public.posts add column if not exists visibility text not null default 'public'
  check (visibility in ('private', 'public', 'community_only', 'community_public'));

create index if not exists posts_visibility_idx on public.posts(visibility);

-- ============================================================
-- 2) post_communities (posts <-> communities 中間テーブル)
-- ============================================================
-- 1 つの post を複数の community に attach 出来る (cross-post)
create table if not exists public.post_communities (
  post_id uuid not null references public.posts(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, community_id)
);

-- community 詳細画面のタイムライン用 (新しい順)
create index if not exists post_communities_community_idx
  on public.post_communities(community_id, created_at desc);

-- post 単体取得時の attached communities 逆引き用
create index if not exists post_communities_post_idx on public.post_communities(post_id);

alter table public.post_communities enable row level security;

-- SELECT: 誰でも参照可 (実際の閲覧可否は posts 側 RLS と client フィルタで担保)
drop policy if exists "post_communities_select" on public.post_communities;
create policy "post_communities_select" on public.post_communities for select using (true);

-- INSERT: 投稿の author 本人だけが自分の post に community を attach できる
drop policy if exists "post_communities_insert" on public.post_communities;
create policy "post_communities_insert" on public.post_communities for insert with check (
  exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

-- DELETE: 投稿の author 本人だけが detach できる
drop policy if exists "post_communities_delete" on public.post_communities;
create policy "post_communities_delete" on public.post_communities for delete using (
  exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

-- ============================================================
-- 3) bbs_threads に community_id + visibility 追加
-- ============================================================
-- BBS スレッドはコミュニティ専用にも出来る:
--   community_id = null    : 通常の全体 BBS スレッド
--   community_id = <uuid>  : そのコミュニティ専用 (5 タブのうち BBS タブで表示)
--
-- visibility:
--   public         : ホーム BBS フィードにも出る (community_id 有無問わず)
--   community_only : community_id のメンバーだけが見える
alter table public.bbs_threads
  add column if not exists community_id uuid references public.communities(id) on delete set null;

alter table public.bbs_threads add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'community_only'));

-- community 詳細の BBS タブ用 (community_id でフィルタ → 新しい順)
create index if not exists bbs_threads_community_idx
  on public.bbs_threads(community_id, created_at desc) where community_id is not null;

create index if not exists bbs_threads_visibility_idx on public.bbs_threads(visibility);

-- ============================================================
-- 4) community_spots (聖地 — 地図ベース・スポット)
-- ============================================================
-- 5 タブ目「聖地」用 — 緯度経度付きの場所マーカー (例: 撮影スポット, 関連地)
create table if not exists public.community_spots (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  description text default '' check (length(description) <= 500),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  photo_url text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists community_spots_community_idx
  on public.community_spots(community_id, created_at desc);

-- 地図 viewport クエリ用 (lat/lon 範囲フィルタ)
create index if not exists community_spots_geo_idx on public.community_spots(lat, lon);

alter table public.community_spots enable row level security;

-- SELECT: open community は誰でも、それ以外は member のみ
drop policy if exists "community_spots_select" on public.community_spots;
create policy "community_spots_select" on public.community_spots for select using (
  community_id in (select id from public.communities where visibility = 'open')
  or public.is_community_member(community_id)
);

-- INSERT: member のみ + 自分名義
drop policy if exists "community_spots_insert" on public.community_spots;
create policy "community_spots_insert" on public.community_spots for insert with check (
  created_by = auth.uid() and public.is_community_member(community_id)
);

-- DELETE: 作成者 or community owner
drop policy if exists "community_spots_delete" on public.community_spots;
create policy "community_spots_delete" on public.community_spots for delete using (
  created_by = auth.uid() or public.is_community_owner(community_id)
);

-- ============================================================
-- 5) community_events (カレンダー — メンバー全員が作成可)
-- ============================================================
-- 5 タブ目「カレンダー」用 — オフ会 / イベント / 配信予定など
create table if not exists public.community_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title text not null check (length(title) between 1 and 100),
  description text default '' check (length(description) <= 1000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location_text text,
  photo_url text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- カレンダー画面の並び順 (community 単位、開始日時降順)
create index if not exists community_events_community_starts_idx
  on public.community_events(community_id, starts_at desc);

alter table public.community_events enable row level security;

-- SELECT: open community は誰でも、それ以外は member のみ
drop policy if exists "community_events_select" on public.community_events;
create policy "community_events_select" on public.community_events for select using (
  community_id in (select id from public.communities where visibility = 'open')
  or public.is_community_member(community_id)
);

-- INSERT: member のみ + 自分名義
drop policy if exists "community_events_insert" on public.community_events;
create policy "community_events_insert" on public.community_events for insert with check (
  created_by = auth.uid() and public.is_community_member(community_id)
);

-- UPDATE: 作成者 or community owner (時間変更 / キャンセル等)
drop policy if exists "community_events_update" on public.community_events;
create policy "community_events_update" on public.community_events for update using (
  created_by = auth.uid() or public.is_community_owner(community_id)
);

-- DELETE: 作成者 or community owner
drop policy if exists "community_events_delete" on public.community_events;
create policy "community_events_delete" on public.community_events for delete using (
  created_by = auth.uid() or public.is_community_owner(community_id)
);

-- ============================================================
-- 6) can_view_post: 投稿の可視性チェックヘルパー
-- ============================================================
-- RLS の SELECT で post の visibility に応じて閲覧可否を判定。
-- 現状は posts の SELECT policy を直接書き換えると既存フロー (is_public) に
-- 影響するため、本関数は client / 将来の RLS 拡張のための補助として用意する。
-- 既存 posts SELECT policy は変更しない (互換性維持) — client が必要に応じて
-- この関数を SELECT 1 from public.can_view_post('uuid') で呼んで個別判定する。
create or replace function public.can_view_post(p_post_id uuid)
returns boolean language sql stable security definer as $$
  select case
    -- private: 自分だけ
    when p.visibility = 'private' then p.author_id = auth.uid()
    -- public: 誰でも
    when p.visibility = 'public' then true
    -- community_only: attach されたいずれかの community の member であれば見える
    when p.visibility = 'community_only' then exists (
      select 1 from public.post_communities pc
      where pc.post_id = p.id and public.is_community_member(pc.community_id)
    )
    -- community_public: 誰でも見える + community にも掲載
    when p.visibility = 'community_public' then true
    else false
  end
  from public.posts p where p.id = p_post_id;
$$;
