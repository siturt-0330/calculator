-- ============================================================
-- seed_admin_console.sql — Admin Console 動作確認用ダミーデータ
-- ============================================================
-- 運営管理ダッシュボード(通報キュー/広告/流入元)を画面で確認するための
-- ダミーデータを投入する。
--
-- 【実行方法】Supabase SQL editor に貼り付けて実行(手動)。
-- 【前提】先に migration 0118〜0121 を適用済みであること。
--         既存の posts / profiles(ダミーユーザー・投稿)があること
--         (無ければ scripts/seed_dummy_v2.sql 等を先に流す)。
-- 【冪等】複数回実行しても重複しない(where not exists / on conflict do nothing)。
--
-- 投入内容:
--   1) ads: house / network / sponsorship を各種 priority・流入元ターゲティングで
--   2) reports: 既存投稿に複数 reporter × 複数 reason
--      → reports INSERT トリガ(0118)で report_cases が自動集約され、
--         さらに report_cases INSERT トリガ(0121)で admin_notifications が自動投入される
--   3) user_acquisition: 既存ユーザー数人に google_ads / app_store / organic
-- ============================================================
do $$
declare
  v_admin   uuid;
  v_post    uuid;
  v_reason  text;
  v_i       int;
begin
  -- admin (広告の created_by 用)
  select id into v_admin from public.profiles where is_admin = true limit 1;
  if v_admin is null then
    select id into v_admin from public.profiles limit 1;  -- admin が無くても any user で代用
  end if;
  if v_admin is null then
    raise notice 'seed_admin_console: profiles が空のため中断 (先にユーザー seed を流してください)';
    return;
  end if;

  -- --------------------------------------------------------
  -- 1) ads — house / network / sponsorship
  -- --------------------------------------------------------
  insert into public.ads
    (advertiser_name, headline, body, image_url, click_url, cta_label,
     target_tags, exclude_tags, status, starts_at, ends_at, daily_budget_yen,
     source_type, priority, target_traffic_sources, created_by)
  select v.* from (values
    ('Geek公式', 'Geekプレミアムで広告非表示',          '月額480円。限定スタンプも。', null, 'https://example.com/premium', '詳しく見る',
       array['premium']::text[], array[]::text[], 'active'::text, null::timestamptz, null::timestamptz, 0,
       'house'::text, 16, array[]::text[]),
    ('AdMob Network', '外部ネットワーク広告(mediation)',  'house在庫が無い時のフォールバック。', null, 'https://example.com/admob', '見る',
       array[]::text[], array[]::text[], 'active', null, null, 1000,
       'network', 12, array[]::text[]),
    ('スポンサーA(Google広告流入向け)', 'Google広告から来た方へ特典', 'google_ads流入ユーザー限定。', null, 'https://example.com/sp-ga', '今すぐ',
       array['anime']::text[], array[]::text[], 'active', null, null, 5000,
       'sponsorship', 4, array['google_ads']::text[]),
    ('スポンサーB(App Store流入向け)', 'iOSユーザー向けキャンペーン', 'app_store流入ユーザー限定。', null, 'https://example.com/sp-ios', 'インストール',
       array[]::text[], array[]::text[], 'active', null, null, 5000,
       'sponsorship', 4, array['app_store']::text[])
  ) as v(advertiser_name, headline, body, image_url, click_url, cta_label,
         target_tags, exclude_tags, status, starts_at, ends_at, daily_budget_yen,
         source_type, priority, target_traffic_sources)
  where not exists (select 1 from public.ads a where a.headline = v.headline);

  -- created_by は values で subquery を使えないため、未設定分をまとめて埋める
  update public.ads set created_by = v_admin where created_by is null;

  -- --------------------------------------------------------
  -- 2) reports — 既存投稿(直近3件)に複数 reporter × 複数 reason
  --    → report_cases / admin_notifications がトリガで自動生成される
  -- --------------------------------------------------------
  for v_post in (select id from public.posts order by created_at desc limit 3) loop
    v_i := 0;
    for v_reason in (select unnest(array['spam','harassment','misinfo','inappropriate'])) loop
      v_i := v_i + 1;
      insert into public.reports (reporter_id, post_id, reason)
      select pr.id, v_post, v_reason
      from public.profiles pr
      where pr.id <> (select author_id from public.posts where id = v_post)
      order by pr.created_at
      offset v_i limit 1
      on conflict do nothing;  -- (reporter_id, post_id) の重複は無視
    end loop;
  end loop;

  -- --------------------------------------------------------
  -- 3) user_acquisition — 既存ユーザー数人に流入元
  -- --------------------------------------------------------
  insert into public.user_acquisition (user_id, traffic_source, utm_source)
  select
    p.id,
    (array['google_ads','app_store','organic','referral'])[1 + (row_number() over (order by p.created_at)) % 4],
    (array['google','apple','direct','partner'])[1 + (row_number() over (order by p.created_at)) % 4]
  from public.profiles p
  limit 8
  on conflict (user_id) do nothing;

  raise notice 'seed_admin_console: 完了 (ads 4種 + reports + user_acquisition)。report_cases/admin_notifications はトリガで自動生成。';
end $$;

-- 確認クエリ(任意):
--   select status, source_type, priority, target_traffic_sources from public.ads order by priority;
--   select target_type, status, severity, report_count, reasons from public.report_cases order by last_reported_at desc;
--   select kind, title, severity, created_at from public.admin_notifications order by created_at desc;
--   select traffic_source, count(*) from public.user_acquisition group by traffic_source;
