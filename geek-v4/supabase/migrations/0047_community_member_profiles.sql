-- ============================================================
-- 0047_community_member_profiles.sql
-- ------------------------------------------------------------
-- コミュニティ内マイプロフィール (oshi 系コミュ向け)
-- 1 user × 1 community = 1 行。匿名性 (anonymous post) はそのままに、
-- コミュ内で「自分が何を推しているか」を共有する。
--
-- 設計:
--   - composite PK (community_id, user_id) — 重複を DB レベルで阻止
--   - top_oshi: 自由テキスト (例: '湊あくあ', '声優・花澤香菜', 'Vaundy')
--   - oshi_since: date — '推し歴 N 年' を計算
--   - attended_count: int — 参戦数 (ライブ・イベント)
--   - my_setlist: text[] — 思い出のセトリ・楽曲・イベント (最大 50, 各 200 字)
--   - extra: jsonb — 将来拡張用 (好きな色 / メンバー位置等)
-- ============================================================

create table if not exists public.community_member_profiles (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  top_oshi     text default '' check (length(top_oshi) <= 100),
  oshi_since   date,
  attended_count integer not null default 0 check (attended_count >= 0 and attended_count <= 9999),
  my_setlist   text[] not null default '{}'
    check (
      array_length(my_setlist, 1) is null
      or array_length(my_setlist, 1) <= 50
    ),
  extra        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);

-- 個別要素の長さチェックは text[] の check では難しいので trigger で
create or replace function public.validate_member_profile()
returns trigger
language plpgsql
as $$
declare
  v_item text;
begin
  if new.my_setlist is not null then
    foreach v_item in array new.my_setlist loop
      if length(v_item) > 200 then
        raise exception 'SETLIST_ITEM_TOO_LONG' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_validate_member_profile on public.community_member_profiles;
create trigger tr_validate_member_profile
  before insert or update on public.community_member_profiles
  for each row execute function public.validate_member_profile();

create index if not exists community_member_profiles_user_idx
  on public.community_member_profiles (user_id);

-- ============================================================
-- RLS — 同コミュニティのメンバー間で閲覧可、編集は自分のみ
-- ============================================================
alter table public.community_member_profiles enable row level security;

-- SELECT: open community は誰でも、それ以外は同コミュ member のみ
drop policy if exists "cmp_select" on public.community_member_profiles;
create policy "cmp_select" on public.community_member_profiles for select using (
  community_id in (select id from public.communities where visibility = 'open')
  or public.is_community_member(community_id)
);

-- INSERT: 自分のレコードのみ、かつ同コミュ member のみ
drop policy if exists "cmp_insert" on public.community_member_profiles;
create policy "cmp_insert" on public.community_member_profiles for insert with check (
  user_id = auth.uid()
  and public.is_community_member(community_id)
);

-- UPDATE: 自分のレコードのみ
drop policy if exists "cmp_update" on public.community_member_profiles;
create policy "cmp_update" on public.community_member_profiles for update using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);

-- DELETE: 自分のレコードのみ
drop policy if exists "cmp_delete" on public.community_member_profiles;
create policy "cmp_delete" on public.community_member_profiles for delete using (
  user_id = auth.uid()
);

-- ============================================================
-- 確認
-- ============================================================
-- select * from information_schema.columns where table_name='community_member_profiles';
