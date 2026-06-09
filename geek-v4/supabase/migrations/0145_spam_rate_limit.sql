-- ============================================================
-- 0145_spam_rate_limit.sql — スパム・レートリミット
-- ============================================================
-- 投稿作成時のレートリミットとスパム検出基盤。
-- post_rate_log: 直近の投稿タイムスタンプを記録し、
--   短時間に大量投稿するアカウントを検出する。
-- check_post_rate_limit(): 投稿前に呼ぶ。違反なら例外を raise。
-- ============================================================

-- 投稿レートログ: ユーザーごとの直近投稿時刻を保持
create table if not exists public.post_rate_log (
  user_id    uuid references auth.users(id) on delete cascade not null,
  posted_at  timestamptz not null default now()
);

alter table public.post_rate_log enable row level security;
-- サービス側のみ書き込み (SECURITY DEFINER 関数経由)
create policy "rate_log_insert_self" on public.post_rate_log
  for insert with check (auth.uid() = user_id);

create index if not exists idx_rate_log_user_time
  on public.post_rate_log (user_id, posted_at desc);

-- レートリミットチェック + ログ記録
-- 制限: 10分以内に 5投稿まで / 1時間以内に 20投稿まで
create or replace function public.check_and_log_post_rate()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_count_10m  int;
  v_count_1h   int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select count(*) into v_count_10m
  from public.post_rate_log
  where user_id = v_uid
    and posted_at > now() - interval '10 minutes';

  if v_count_10m >= 5 then
    raise exception '投稿が多すぎます。10分後に再試行してください。'
      using errcode = '53400';
  end if;

  select count(*) into v_count_1h
  from public.post_rate_log
  where user_id = v_uid
    and posted_at > now() - interval '1 hour';

  if v_count_1h >= 20 then
    raise exception '1時間の投稿上限に達しました。しばらくお待ちください。'
      using errcode = '53400';
  end if;

  insert into public.post_rate_log (user_id) values (v_uid);

  -- 古いログを自動削除 (1日以上前)
  delete from public.post_rate_log
  where user_id = v_uid
    and posted_at < now() - interval '1 day';
end;
$$;

grant execute on function public.check_and_log_post_rate() to authenticated;

-- スパムスコアリング: 重複コンテンツ検出
-- 同一ユーザーが24h以内に同じハッシュの投稿をしていないか確認
create or replace function public.check_duplicate_content(p_content_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  -- posts テーブルに content_hash カラムがあれば使う (なければ false 返す)
  select exists(
    select 1 from public.posts
    where author_id = auth.uid()
      and md5(content) = p_content_hash
      and created_at > now() - interval '24 hours'
  ) into v_exists;
  return v_exists;
end;
$$;

grant execute on function public.check_duplicate_content(text) to authenticated;

select '0145_spam_rate_limit 完了 — レートリミット + 重複コンテンツ検出' as note;
