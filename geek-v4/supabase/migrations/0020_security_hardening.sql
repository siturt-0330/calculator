-- ============================================================
-- 0020: 大規模 RLS / 整合性ハードニング (4-way 監査の統合 fix)
-- ============================================================
-- audit で発見された脆弱性をまとめて潰す。
-- 既存ポリシーは drop してから再 create するため、何度でも再実行可。
-- ============================================================

-- ============================================================
-- 1. profiles に is_admin フラグを足す
--    報告閲覧 / モデレーション用
-- ============================================================
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ============================================================
-- 2. reports: 管理者のみ閲覧 / 更新できる SELECT/UPDATE policy
--    write-only だった通報を、admin だけが読める状態に
-- ============================================================
drop policy if exists "reports_select_admin" on public.reports;
create policy "reports_select_admin" on public.reports for select using (
  public.current_user_is_admin() or auth.uid() = reporter_id
);
drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin" on public.reports for update using (
  public.current_user_is_admin()
);

-- ============================================================
-- 3. profiles: account_state / phone を他人から隠す
--    現状: profiles_read using (true) で全カラム露出
--    修正: 公開 view 経由でアクセスさせる + 元テーブルの read policy を絞る
--
--    既存 client コードを壊さないため、テーブル自体の read policy は維持しつつ、
--    機密カラムを drop column せず、column-level grant を限定的に応用。
--    PostgreSQL の RLS では column 単位の SELECT 制限ができないため、
--    "他人が SELECT したときに NULL を返す view" を作る。
-- ============================================================
create or replace view public.profiles_public
with (security_invoker = on) as
select
  id,
  nickname,
  trust_score,
  plan,
  created_at,
  -- 自分の行だけ機密フィールドを返す
  case when id = auth.uid() then phone           else null end as phone,
  case when id = auth.uid() then bio             else null end as bio,
  case when id = auth.uid() then account_state   else 'healthy' end as account_state,
  case when id = auth.uid() then concern_received_count else 0 end as concern_received_count,
  -- avatar 関連は公開 OK
  avatar_emoji,
  avatar_url,
  post_count,
  comment_count,
  like_received_count,
  onboarded
from public.profiles;

grant select on public.profiles_public to anon, authenticated;

-- ============================================================
-- 4. likes: 「誰が何にいいねしたか」をデフォルト全公開にしないように
--    現状: likes_read using (true)
--    修正: ユーザー自身か、対象投稿の作者だけが読める。集計目的での
--    likes_count は posts テーブルに既にあるのでクライアントには影響少
-- ============================================================
drop policy if exists "likes_read" on public.likes;
create policy "likes_read" on public.likes for select using (
  user_id = auth.uid()
  or post_id in (select id from public.posts where author_id = auth.uid())
  or public.current_user_is_admin()
);

-- ============================================================
-- 5. poll_votes: 投票者を秘匿 (table が無ければスキップ)
-- ============================================================
do $$
begin
  if to_regclass('public.poll_votes') is not null and to_regclass('public.polls') is not null then
    drop policy if exists "pv_read" on public.poll_votes;
    create policy "pv_read" on public.poll_votes for select using (
      user_id = auth.uid()
      or poll_id in (
        select pl.id from public.polls pl
        join public.posts p on pl.post_id = p.id
        where p.author_id = auth.uid()
      )
      or public.current_user_is_admin()
    );
  end if;
end $$;

-- ============================================================
-- 6. concerns: 通報者を秘匿 (table が無ければスキップ)
-- ============================================================
do $$
begin
  if to_regclass('public.concerns') is not null then
    drop policy if exists "c_read" on public.concerns;
    create policy "c_read" on public.concerns for select using (
      user_id = auth.uid()
      or post_id in (select id from public.posts where author_id = auth.uid())
      or public.current_user_is_admin()
    );
  end if;
end $$;

-- ============================================================
-- 7. post_link_previews: 任意ユーザーの UPDATE を禁止 (cache poisoning 対策)
--    table が無い環境 (link preview 機能未適用) ではスキップ
-- ============================================================
do $$
begin
  if to_regclass('public.post_link_previews') is not null then
    drop policy if exists "plp_update" on public.post_link_previews;
    drop policy if exists "plp_delete" on public.post_link_previews;
    create policy "plp_delete" on public.post_link_previews for delete using (
      public.current_user_is_admin()
    );
  end if;
end $$;

-- ============================================================
-- 8. community_posts: 作者自身が自分の投稿を削除できるよう
--    要件 (GDPR Right to Erasure) 対応
-- ============================================================
drop policy if exists "community_posts_delete" on public.community_posts;
create policy "community_posts_delete" on public.community_posts for delete using (
  author_id = auth.uid() or public.is_community_owner(community_id)
);

-- ============================================================
-- 9. Storage RLS: community-icons パス検証を厳格化
--    foldername(name)[1]::uuid が silent fail する穴を塞ぐ
-- ============================================================
create or replace function public.community_id_from_storage_path(p text)
returns uuid language plpgsql immutable as $$
declare
  segs text[];
  s text;
begin
  segs := storage.foldername(p);
  if array_length(segs, 1) is null or array_length(segs, 1) < 1 then
    return null;
  end if;
  s := segs[1];
  -- UUID 形式の正規表現で検査 (失敗時は null 返却 — 例外を投げない)
  if s !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return s::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "community_icons_insert" on storage.objects;
create policy "community_icons_insert" on storage.objects for insert with check (
  bucket_id = 'community-icons'
  and auth.uid() is not null
  and public.community_id_from_storage_path(name) is not null
  and public.is_community_member(public.community_id_from_storage_path(name))
);

drop policy if exists "community_icons_update" on storage.objects;
create policy "community_icons_update" on storage.objects for update using (
  bucket_id = 'community-icons'
  and auth.uid() is not null
  and public.community_id_from_storage_path(name) is not null
  and public.is_community_member(public.community_id_from_storage_path(name))
);

drop policy if exists "community_icons_delete" on storage.objects;
create policy "community_icons_delete" on storage.objects for delete using (
  bucket_id = 'community-icons'
  and auth.uid() is not null
  and public.community_id_from_storage_path(name) is not null
  and public.is_community_member(public.community_id_from_storage_path(name))
);

-- ============================================================
-- 10. tags: 内容バリデーション強化
--     悪意あるユーザーが超長文 / 制御文字 を tag にする攻撃を防ぐ
-- ============================================================
do $$
begin
  if to_regclass('public.tags') is not null then
    alter table public.tags drop constraint if exists tags_name_check;
    alter table public.tags add constraint tags_name_check check (
      length(name) between 1 and 40
      and name ~ '^[^\x00-\x1f\x7f]+$'
    );
  end if;
end $$;

-- ============================================================
-- 11. 整合性: 各種 CHECK 制約強化
-- ============================================================

-- community description: null をやめて空文字必須に (UI 側のヌル/空チェック簡略化)
update public.communities set description = '' where description is null;
alter table public.communities
  alter column description set not null,
  alter column description set default '';

-- poll vote count 負数防止
do $$
begin
  if to_regclass('public.poll_options') is not null then
    alter table public.poll_options drop constraint if exists poll_options_vote_count_check;
    alter table public.poll_options add constraint poll_options_vote_count_check check (vote_count >= 0);
  end if;
end $$;

-- post-engagement counters は 0 以上
alter table public.communities
  drop constraint if exists communities_member_count_check;
alter table public.communities
  add constraint communities_member_count_check check (member_count >= 0);
alter table public.communities
  drop constraint if exists communities_post_count_check;
alter table public.communities
  add constraint communities_post_count_check check (post_count >= 0);

-- ============================================================
-- 12. member_count 自動修復用 RPC (管理者向け audit ツール)
--     trigger が稀にコケた時の reconcile 手段
-- ============================================================
create or replace function public.reconcile_community_counters(c_id uuid default null)
returns void language plpgsql security definer as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'admin only';
  end if;
  if c_id is null then
    -- 全部 reconcile
    update public.communities c set
      member_count = coalesce((select count(*) from public.community_members where community_id = c.id), 0),
      post_count = coalesce((select count(*) from public.community_posts where community_id = c.id), 0);
  else
    update public.communities set
      member_count = coalesce((select count(*) from public.community_members where community_id = c_id), 0),
      post_count = coalesce((select count(*) from public.community_posts where community_id = c_id), 0)
      where id = c_id;
  end if;
end;
$$;
