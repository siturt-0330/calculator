-- ============================================================
-- 0022_account_state_grace_period.sql
-- ============================================================
-- 目的: refresh_account_state の閾値を緩和する。
--
-- 背景:
--   現行 (migration 0006) では concern_received_count / post_count の ratio が
--   1.0 以上で account_state='restricted' となり、authStore.checkAccountState が
--   ログインを完全ブロックしていた。
--   新規 1 投稿のみのユーザーが 1 件の通報を受けただけで ratio=1.0 → 即 restricted
--   という誤発火が多発し、本来のユーザー (siturt0330@gmail.com 等) が締め出される
--   事故が発生。
--
-- 対策:
--   1) min_posts_for_action = 5 のグレース期間導入。pcount < 5 のアカウントは
--      ratio に関係なく必ず 'healthy' とする。新規ユーザーは荒らされても
--      初期段階で締め出されない。
--   2) 閾値を全体的に緩める。
--        ratio >= 3.0 → 'warned'         (旧 1.5)
--        ratio >= 2.0 → 'restricted'     (旧 1.0)
--        ratio >= 1.0 → 'caution'        (旧 0.5)
--        else         → 'healthy'
--   3) 既存 restricted/warned アカウントを 'caution' に格下げして救済 (一回限り)。
--      siturt0330@gmail.com 等のロックアウト解除も兼ねる。
--
-- 適用: Supabase Studio → SQL Editor で全文を貼り付けて RUN
-- ============================================================

-- ----------------------------------------------------------------
-- 1) function 差し替え
-- ----------------------------------------------------------------
create or replace function public.refresh_account_state(p_user uuid)
returns void language plpgsql as $$
declare
  pcount int;
  ccount int;
  ratio  float;
  state  text;
  min_posts_for_action constant int := 5;
begin
  select post_count, concern_received_count into pcount, ccount
  from public.profiles where id = p_user;

  if pcount is null then pcount := 0; end if;
  if ccount is null then ccount := 0; end if;

  -- グレース期間: 投稿 5 件未満は ratio 無視で必ず healthy
  if pcount < min_posts_for_action then
    update public.profiles set account_state = 'healthy' where id = p_user;
    return;
  end if;

  ratio := ccount::float / pcount::float;

  if ratio >= 3.0 then state := 'warned';
  elsif ratio >= 2.0 then state := 'restricted';
  elsif ratio >= 1.0 then state := 'caution';
  else state := 'healthy';
  end if;

  update public.profiles set account_state = state where id = p_user;
end;
$$;

-- ----------------------------------------------------------------
-- 2) 既存 restricted / warned アカウントの一回限り救済
--    今回の policy 緩和後は同じ閾値での lockout は再発しない。
-- ----------------------------------------------------------------
update public.profiles
set account_state = 'healthy'
where account_state in ('restricted', 'warned');

-- ----------------------------------------------------------------
-- 3) 念のため再計算 (全プロファイル) — 救済適用後に新閾値で recompute
-- ----------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.profiles loop
    perform public.refresh_account_state(r.id);
  end loop;
end;
$$;
