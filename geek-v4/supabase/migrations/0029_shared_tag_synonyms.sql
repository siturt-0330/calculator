-- ============================================================
-- 0029_shared_tag_synonyms.sql
-- ============================================================
-- ユーザーが「タグ A と B は同じ意味」と宣言すると、その投票が
-- tag_synonym_votes に記録される。
-- 投票数 >= 1 で全ユーザーの related-tag 候補に出るが、
-- 投票数 >= 3 で「confirmed」として強い weight が付く。
-- 同じ user が同じ pair を 2 回投票することは PK で防止。
-- 自動 co-occurrence と組み合わせて、人力 + 機械の双方で synonym graph を育てる。
-- ============================================================

-- ----------------------------------------------------------------
-- 1) 投票テーブル (user × pair で unique)
-- ----------------------------------------------------------------
create table if not exists public.tag_synonym_votes (
  -- 同じペアでも tag_a と tag_b を sort して保存 (a < b 制約) — A=B と B=A を重複させない
  tag_a text not null check (length(tag_a) between 1 and 40),
  tag_b text not null check (length(tag_b) between 1 and 40 and tag_b > tag_a),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tag_a, tag_b, user_id)
);

create index if not exists tag_synonym_votes_a_idx on public.tag_synonym_votes (tag_a);
create index if not exists tag_synonym_votes_b_idx on public.tag_synonym_votes (tag_b);

alter table public.tag_synonym_votes enable row level security;

-- SELECT: 集計用に誰でも読める (個別の user_id は取らない方が anonymity 安全だが
-- aggregate に必要なので read 許可。client 側では COUNT のみ使う)
drop policy if exists "tag_synonym_votes_select" on public.tag_synonym_votes;
create policy "tag_synonym_votes_select" on public.tag_synonym_votes for select using (true);

-- INSERT: 自分の投票のみ
drop policy if exists "tag_synonym_votes_insert" on public.tag_synonym_votes;
create policy "tag_synonym_votes_insert" on public.tag_synonym_votes for insert
  with check (user_id = auth.uid());

-- DELETE: 自分の投票を取り消せる
drop policy if exists "tag_synonym_votes_delete" on public.tag_synonym_votes;
create policy "tag_synonym_votes_delete" on public.tag_synonym_votes for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- 2) Materialized view: 集計済み synonym グラフ
-- ----------------------------------------------------------------
create materialized view if not exists public.mv_tag_synonyms as
select
  tag_a,
  tag_b,
  count(*)::int as vote_count,
  count(*) >= 3 as is_confirmed,
  max(created_at) as last_voted_at
from public.tag_synonym_votes
group by tag_a, tag_b;

create unique index if not exists mv_tag_synonyms_pair_idx on public.mv_tag_synonyms (tag_a, tag_b);
create index if not exists mv_tag_synonyms_a_idx on public.mv_tag_synonyms (tag_a);
create index if not exists mv_tag_synonyms_b_idx on public.mv_tag_synonyms (tag_b);

-- 集計は遅延で OK (10 分間隔とか) — pg_cron 設定例 (Supabase pro+ で利用可):
-- select cron.schedule('refresh-tag-synonyms', '*/10 * * * *',
--   'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_tag_synonyms;');

-- ----------------------------------------------------------------
-- 3) helper RPC: 「あるタグの synonym 一覧」 を返す
-- ----------------------------------------------------------------
create or replace function public.get_tag_synonyms(p_tag text)
returns table(synonym text, vote_count int, is_confirmed boolean)
language sql stable as $$
  select
    case when tag_a = p_tag then tag_b else tag_a end as synonym,
    vote_count,
    is_confirmed
  from public.mv_tag_synonyms
  where tag_a = p_tag or tag_b = p_tag
  order by vote_count desc, last_voted_at desc;
$$;

grant execute on function public.get_tag_synonyms(text) to anon, authenticated;

-- ----------------------------------------------------------------
-- 4) helper RPC: 「タグ a と b は synonym」 を投票
-- ----------------------------------------------------------------
create or replace function public.vote_tag_synonym(p_a text, p_b text)
returns void language plpgsql security definer as $$
declare
  norm_a text;
  norm_b text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  -- a と b を sort
  if p_a < p_b then
    norm_a := p_a;
    norm_b := p_b;
  elsif p_a > p_b then
    norm_a := p_b;
    norm_b := p_a;
  else
    return; -- 同じタグは投票無意味
  end if;

  insert into public.tag_synonym_votes (tag_a, tag_b, user_id)
  values (norm_a, norm_b, auth.uid())
  on conflict (tag_a, tag_b, user_id) do nothing;
end;
$$;

grant execute on function public.vote_tag_synonym(text, text) to authenticated;
